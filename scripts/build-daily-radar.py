#!/usr/bin/env python3
"""Build a daily, auditable B3 strength/pressure radar.

The model is deliberately deterministic. News only adjusts the mathematical
score when a recent headline is available; a network failure remains neutral.
"""

from __future__ import annotations

import json
import math
import os
import re
import statistics
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else None
OUTPUT = ROOT / "data/daily-radar.json"

POSITIVE = {"alta", "lucro", "cresce", "crescimento", "recorde", "avança", "supera", "dividendo", "contrato", "aprova", "expansão", "upgrade", "profit", "growth", "beats", "record"}
NEGATIVE = {"queda", "prejuízo", "cai", "recua", "dívida", "investigação", "fraude", "rebaixa", "crise", "perda", "loss", "falls", "debt", "downgrade", "probe"}


def clamp(value: float, low: float = 0, high: float = 100) -> float:
    return max(low, min(high, value))


def number(value, fallback=50) -> float:
    return float(value) if isinstance(value, (int, float)) and math.isfinite(value) else fallback


def price_history(folder: Path | None) -> dict[str, list[dict]]:
    history: dict[str, list[dict]] = {}
    if not folder:
        return history
    paths = sorted(folder.glob("COTAHIST_A*.ZIP"))
    if not paths:
        return history
    with zipfile.ZipFile(paths[-1]) as archive:
        text = archive.read(archive.namelist()[0]).decode("latin1")
    for line in text.splitlines():
        if len(line) < 245 or line[:2] != "01" or line[10:12] != "02" or line[24:27] != "010":
            continue
        ticker = line[12:24].strip()
        specification = line[39:49].strip().upper()
        if not re.fullmatch(r"[A-Z]{4}[0-9]{1,2}", ticker) or not specification.startswith(("ON", "PN", "UNT")):
            continue
        history.setdefault(ticker, []).append({
            "date": f"{line[2:6]}-{line[6:8]}-{line[8:10]}",
            "high": int(line[69:82]) / 100,
            "low": int(line[82:95]) / 100,
            "close": int(line[108:121]) / 100,
        })
    for rows in history.values():
        rows.sort(key=lambda row: row["date"])
    return history


def technical(rows: list[dict], asset: dict) -> dict:
    closes = [row["close"] for row in rows if row["close"] > 0]
    if len(closes) < 20:
        change = number(asset.get("changepct"), 0)
        return {"score": round(clamp(50 + change * 2)), "return20": None, "return60": None,
                "support": number(asset.get("low"), asset["price"] * .97),
                "resistance": number(asset.get("high"), asset["price"] * 1.03), "sessions": len(closes)}
    last = closes[-1]
    ma20 = statistics.fmean(closes[-20:])
    ma60 = statistics.fmean(closes[-60:]) if len(closes) >= 60 else statistics.fmean(closes)
    r20 = (last / closes[-20] - 1) * 100
    r60 = (last / closes[-60] - 1) * 100 if len(closes) >= 60 else None
    trend = 72 if last > ma20 > ma60 else 28 if last < ma20 < ma60 else 50
    score = .4 * clamp(50 + r20 * 2) + .3 * clamp(50 + number(r60, r20)) + .3 * trend
    recent = rows[-20:]
    return {"score": round(clamp(score)), "return20": round(r20, 2), "return60": round(r60, 2) if r60 is not None else None,
            "support": round(min(row["low"] for row in recent), 2), "resistance": round(max(row["high"] for row in recent), 2), "sessions": len(closes)}


def fair_value(asset: dict) -> tuple[float, str]:
    f = asset["fundamentals"]
    anchors = []
    eps, bvps = number(f.get("eps"), 0), number(f.get("bookValuePerShare"), 0)
    roe, growth = number(f.get("roe"), 0), number(f.get("revenueGrowth"), 0)
    if eps > 0:
        target_pe = clamp(8 + max(0, roe) * .35 + clamp(growth, -5, 15) * .15, 7, 18)
        anchors.append(eps * target_pe)
    if bvps > 0:
        target_pb = clamp(.65 + max(0, roe) / 20, .65, 2)
        anchors.append(bvps * target_pb)
    if anchors:
        return statistics.fmean(anchors), "LPA×P/L-alvo + VPA×P/VP-alvo"
    overall = number(f.get("scores", {}).get("overall"))
    return asset["price"] * (.8 + overall / 250), "preço ajustado pelo score fundamental"


def headline_score(title: str) -> int:
    words = set(re.findall(r"[a-zà-ÿ]+", title.lower()))
    balance = len(words & POSITIVE) - len(words & NEGATIVE)
    return round(clamp(50 + balance * 12))


def fetch_google_news(query: str) -> dict:
    params = urllib.parse.urlencode({"q": query, "hl": "pt-BR", "gl": "BR", "ceid": "BR:pt-419"})
    url = f"https://news.google.com/rss/search?{params}"
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; B3ScoreRadar/1.0)"})
        with urllib.request.urlopen(request, timeout=10) as response:
            root = ET.fromstring(response.read())
        items = []
        for item in root.findall("./channel/item")[:12]:
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            source = item.find("source")
            if title and link:
                items.append({"title": title[:180], "url": link, "domain": source.text if source is not None else "Google Notícias", "seenDate": item.findtext("pubDate")})
        score = round(statistics.fmean(headline_score(row["title"]) for row in items)) if items else 50
        return {"score": score, "coverage": len(items), "headlines": items[:3]}
    except Exception:
        return {"score": 50, "coverage": 0, "headlines": []}


def fetch_news(asset: dict, query_override: str | None = None) -> dict:
    if os.environ.get("RADAR_SKIP_NEWS") == "1":
        return {"score": 50, "coverage": 0, "headlines": []}
    company = asset["fundamentals"].get("companyName") or asset.get("name") or asset["ticker"]
    query = query_override or f'("{asset["ticker"]}" OR "{company[:55]}")'
    params = urllib.parse.urlencode({"query": query, "mode": "artlist", "maxrecords": 12, "timespan": "7d", "format": "json", "sort": "datedesc"})
    url = f"https://api.gdeltproject.org/api/v2/doc/doc?{params}"
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "B3ScoreRadar/1.0"})
        with urllib.request.urlopen(request, timeout=6) as response:
            articles = json.load(response).get("articles", [])[:8]
        items = [{"title": row.get("title", "")[:180], "url": row.get("url", ""), "domain": row.get("domain", ""), "seenDate": row.get("seendate")}
                 for row in articles if row.get("title") and row.get("url")]
        score = round(statistics.fmean(headline_score(row["title"]) for row in items)) if items else 50
        result = {"score": score, "coverage": len(items), "headlines": items[:3]}
        return result if result["coverage"] else fetch_google_news(query)
    except Exception:
        return fetch_google_news(query)


def base_row(asset: dict, history: dict[str, list[dict]]) -> dict:
    f, scores = asset["fundamentals"], asset["fundamentals"].get("scores", {})
    values = [number(scores.get(key)) for key in ("quality", "price", "debt", "growth", "dividends") if scores.get(key) is not None]
    fundamental = statistics.fmean(values) if values else number(scores.get("overall"))
    tech = technical(history.get(asset["ticker"], []), asset)
    confidence = number(scores.get("confidence"), 0)
    liquidity = clamp(20 + math.log10(max(number(asset.get("volume"), 1), 1)) * 11)
    pre_score = .48 * fundamental + .34 * tech["score"] + .10 * liquidity + .08 * confidence
    return {"asset": asset, "fundamental": round(fundamental), "technical": tech, "confidence": round(confidence), "liquidity": round(liquidity), "preScore": pre_score}


def finish(row: dict, news: dict, direction: str) -> dict:
    asset, tech = row["asset"], row["technical"]
    fair, method = fair_value(asset)
    price = asset["price"]
    strength = .42 * row["fundamental"] + .32 * tech["score"] + .14 * news["score"] + .07 * row["liquidity"] + .05 * row["confidence"]
    pressure = .42 * (100 - row["fundamental"]) + .32 * (100 - tech["score"]) + .14 * (100 - news["score"]) + .07 * (100 - row["liquidity"]) + .05 * (100 - row["confidence"])
    if direction == "strength":
        entry_low = min(price * .98, tech["support"] * 1.01)
        entry_high = max(entry_low, min(price * 1.01, fair * .92))
        upside = .05 + .30 * math.tanh(max(0, fair / price - 1) * 1.2)
        target = min(max(entry_high * 1.03, price * (1 + upside), tech["resistance"]), price * 1.40)
        defensive = min(entry_low * .96, tech["support"] * .98)
        score = strength
    else:
        downside = .03 + .27 * math.tanh(max(0, 1 - fair / price) * 1.2)
        target = max(min(price * (1 - downside), tech["support"]), price * .65)
        entry_low, entry_high = target * .98, target * 1.02
        defensive = tech["support"] * .98
        score = pressure
    potential = (target / price - 1) * 100
    return {
        "ticker": asset["ticker"], "name": asset.get("name"), "price": round(price, 2), "quoteDate": asset.get("date"),
        "score": round(clamp(score)), "fundamentalScore": row["fundamental"], "technicalScore": tech["score"],
        "newsScore": news["score"], "confidence": row["confidence"], "newsCoverage": news["coverage"],
        "return20": tech["return20"], "return60": tech["return60"], "historySessions": tech["sessions"],
        "entryLow": round(max(.01, entry_low), 2), "entryHigh": round(max(.01, entry_high), 2),
        "target": round(max(.01, target), 2), "defensiveExit": round(max(.01, defensive), 2), "potentialPct": round(potential, 2),
        "fairValue": round(fair, 2), "fairValueMethod": method, "headlines": news["headlines"],
    }


def build() -> dict:
    assets = json.loads((ROOT / "data/b3-fundamentals.json").read_text(encoding="utf-8"))
    history = price_history(SOURCE)
    eligible = [a for a in assets if a.get("kind") in {"stock", "unit"} and a.get("price", 0) > 0 and a.get("fundamentals") and a.get("volume", 0) >= 100_000]
    base = [base_row(asset, history) for asset in eligible]
    candidates = sorted(base, key=lambda row: row["preScore"], reverse=True)[:18] + sorted(base, key=lambda row: row["preScore"])[:18]
    unique = {row["asset"]["ticker"]: row for row in candidates}
    with ThreadPoolExecutor(max_workers=4) as pool:
        news_rows = dict(zip(unique, pool.map(fetch_news, [row["asset"] for row in unique.values()])))
    market_news = fetch_news(
        {"ticker": "IBOV", "fundamentals": {"companyName": "mercado brasileiro"}},
        '(Ibovespa OR "bolsa brasileira" OR "Brazil stock market")',
    )
    for ticker, company_news in news_rows.items():
        if not market_news["coverage"]:
            continue
        if company_news["coverage"]:
            company_news["score"] = round(company_news["score"] * .7 + market_news["score"] * .3)
            company_news["coverage"] += market_news["coverage"]
            company_news["headlines"] = (company_news["headlines"][:2] + market_news["headlines"][:1])
        else:
            news_rows[ticker] = {**market_news, "headlines": market_news["headlines"][:3]}
    completed = {ticker: (finish(row, news_rows[ticker], "strength"), finish(row, news_rows[ticker], "pressure")) for ticker, row in unique.items()}
    strength = sorted((pair[0] for pair in completed.values()), key=lambda row: (row["score"], row["potentialPct"]), reverse=True)[:10]
    pressure = sorted((pair[1] for pair in completed.values()), key=lambda row: (row["score"], -row["potentialPct"]), reverse=True)[:10]
    return {
        "generatedAt": datetime.now(UTC).isoformat(), "quoteDate": max((a.get("date") or "" for a in eligible), default=None),
        "modelVersion": "1.0.0", "universe": len(eligible),
        "weights": {"fundamentals": 42, "technical": 32, "news": 14, "liquidity": 7, "dataConfidence": 5},
        "methodology": "Ranking determinístico; score não é probabilidade. Notícia ausente recebe 50/100 neutro. Alvos extremos são suavizados matematicamente.",
        "sources": ["B3 COTAHIST", "CVM DFP/ITR/FCA", "GDELT DOC 2.0", "Google Notícias RSS (fallback)"], "strength": strength, "pressure": pressure,
    }


if __name__ == "__main__":
    OUTPUT.write_text(json.dumps(build(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {OUTPUT}.")
