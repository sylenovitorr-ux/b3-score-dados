#!/usr/bin/env python3
"""Build transparent price/volume anomaly indicators from B3 COTAHIST.

The output is a statistical screening tool. It cannot establish manipulation,
fraud, intent or wrongdoing; those conclusions require contextual evidence and
an investigation by the competent authorities.
"""

from __future__ import annotations

import json
import math
import statistics
import sys
import zipfile
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else None
OUTPUT = ROOT / "data/market-anomalies.json"
HISTORY_SESSIONS = 2520


def clamp(value: float, low: float = 0, high: float = 100) -> float:
    return max(low, min(high, value))


def z_score(value: float, sample: list[float]) -> float | None:
    if len(sample) < 20:
        return None
    deviation = statistics.stdev(sample)
    if deviation <= 1e-12:
        return 0.0 if abs(value - statistics.fmean(sample)) <= 1e-12 else (10.0 if value > sample[0] else -10.0)
    return (value - statistics.fmean(sample)) / deviation


def read_history(folder: Path | None, universe: set[str]) -> dict[str, list[dict]]:
    history: dict[str, dict[str, dict]] = {}
    if not folder:
        return {}
    paths = sorted({*folder.glob("COTAHIST_A*.ZIP"), *folder.glob("COTAHIST_D*.ZIP")})
    if not paths:
        return {}
    for path in paths:
        with zipfile.ZipFile(path) as archive:
            text = archive.read(archive.namelist()[0]).decode("latin1")
        for line in text.splitlines():
            if len(line) < 245 or line[:2] != "01" or line[10:12] != "02" or line[24:27] != "010":
                continue
            ticker = line[12:24].strip()
            if ticker not in universe:
                continue
            try:
                open_price = int(line[56:69]) / 100
                high = int(line[69:82]) / 100
                low = int(line[82:95]) / 100
                close = int(line[108:121]) / 100
                volume = int(line[170:188]) / 100
            except ValueError:
                continue
            if close <= 0:
                continue
            date_value = f"{line[2:6]}-{line[6:8]}-{line[8:10]}"
            history.setdefault(ticker, {})[date_value] = {
                "date": date_value,
                "open": open_price,
                "high": high,
                "low": low,
                "close": close,
                "volume": max(0, volume),
            }
    return {ticker: sorted(rows.values(), key=lambda row: row["date"]) for ticker, rows in history.items()}


def classify(score: int) -> dict:
    if score >= 80:
        return {"label": "Anomalia extrema", "tone": "critical"}
    if score >= 60:
        return {"label": "Forte anomalia", "tone": "high"}
    if score >= 40:
        return {"label": "Atenção", "tone": "medium"}
    if score >= 20:
        return {"label": "Observar", "tone": "watch"}
    return {"label": "Sem sinal estatístico relevante", "tone": "normal"}


def analyse(ticker: str, rows: list[dict]) -> dict | None:
    if len(rows) < 30:
        return None
    returns = [(rows[i]["close"] / rows[i - 1]["close"] - 1) * 100 for i in range(1, len(rows))]
    log_volumes = [math.log1p(row["volume"]) for row in rows]
    latest_return = returns[-1]
    return_reference = returns[max(0, len(returns) - 61):-1]
    volume_reference = log_volumes[max(0, len(log_volumes) - 61):-1]
    return_z = z_score(latest_return, return_reference)
    volume_z = z_score(log_volumes[-1], volume_reference)
    recent_returns = returns[-20:]
    reference = returns[max(0, len(returns) - 80):-20] or return_reference
    reference_mean = statistics.fmean(reference) if reference else 0
    reference_sd = statistics.stdev(reference) if len(reference) >= 2 else 0
    extreme_days = sum(1 for value in recent_returns if abs(value) >= 5 and reference_sd and abs((value - reference_mean) / reference_sd) >= 3)
    reversal = len(returns) >= 2 and abs(returns[-2]) >= 6 and returns[-2] * returns[-1] < 0 and abs(returns[-1]) >= abs(returns[-2]) * .5
    median_volume = statistics.median(row["volume"] for row in rows[-20:])
    previous_volume_window = [row["volume"] for row in rows[-21:-1]]
    average_volume20 = statistics.fmean(previous_volume_window) if previous_volume_window else None
    volume_vs_average20 = (rows[-1]["volume"] / average_volume20 - 1) * 100 if average_volume20 and average_volume20 > 0 else None
    low_liquidity = median_volume < 100_000
    possible_event = any(abs(value) >= 30 for value in recent_returns)
    daily_vol = statistics.stdev(returns[-60:]) if len(returns) >= 20 else 0
    annual_vol = daily_vol * math.sqrt(252)
    return5 = (rows[-1]["close"] / rows[-6]["close"] - 1) * 100 if len(rows) > 5 else None
    return20 = (rows[-1]["close"] / rows[-21]["close"] - 1) * 100 if len(rows) > 20 else None
    previous5 = (rows[-6]["close"] / rows[-11]["close"] - 1) * 100 if len(rows) > 10 else None
    acceleration = return5 - previous5 if return5 is not None and previous5 is not None else None
    latest_open = rows[-1].get("open")
    gap = (latest_open / rows[-2]["close"] - 1) * 100 if latest_open and rows[-2]["close"] > 0 else None
    high20 = max(row.get("high", row["close"]) for row in rows[-20:])
    low20 = min(row.get("low", row["close"]) for row in rows[-20:])
    return_points = min(35, max(0, (abs(return_z or 0) - 1.5) * 14))
    volume_points = min(25, max(0, ((volume_z or 0) - 1.5) * 10))
    cluster_points = min(20, extreme_days * 7)
    score = round(clamp(return_points + volume_points + cluster_points + (10 if reversal else 0) + (10 if low_liquidity else 0)))
    flags = []
    if abs(return_z or 0) >= 3:
        flags.append({"code": "return", "label": "Retorno fora do padrão", "severity": "high", "explanation": f"Retorno diário a {abs(return_z):.1f} desvios-padrão do histórico recente."})
    if (volume_z or 0) >= 3:
        flags.append({"code": "volume", "label": "Volume fora do padrão", "severity": "high", "explanation": f"Volume a {volume_z:.1f} desvios-padrão da janela recente."})
    if extreme_days >= 2:
        flags.append({"code": "cluster", "label": "Anomalias repetidas", "severity": "medium", "explanation": f"{extreme_days} pregões extremos nos últimos 20."})
    if reversal:
        flags.append({"code": "reversal", "label": "Reversão brusca", "severity": "medium", "explanation": "Movimento forte seguido de retorno relevante no sentido oposto."})
    if low_liquidity:
        flags.append({"code": "liquidity", "label": "Baixa liquidez", "severity": "context", "explanation": "Pouco volume pode ampliar oscilações sem irregularidade."})
    if possible_event:
        flags.append({"code": "event", "label": "Verificar evento corporativo", "severity": "context", "explanation": "Oscilação muito ampla pode refletir grupamento, desdobramento, provento ou outro evento."})
    if gap is not None and abs(gap) >= 4:
        flags.append({"code": "gap", "label": "Gap relevante", "severity": "medium", "explanation": f"Abertura a {gap:+.1f}% do fechamento anterior."})
    recent = rows[-HISTORY_SESSIONS:]
    start_index = len(rows) - len(recent)
    result = {
        "ticker": ticker,
        "score": score,
        "classification": classify(score),
        "latestReturnPct": round(latest_return, 2),
        "returnZ": round(return_z, 2) if return_z is not None else None,
        "volumeZ": round(volume_z, 2) if volume_z is not None else None,
        "return5Pct": round(return5, 2) if return5 is not None else None,
        "return20Pct": round(return20, 2) if return20 is not None else None,
        "acceleration5Pct": round(acceleration, 2) if acceleration is not None else None,
        "gapPct": round(gap, 2) if gap is not None else None,
        "dailyVolatilityPct": round(daily_vol, 2),
        "annualizedVolatilityPct": round(annual_vol, 2),
        "medianVolume20": round(median_volume, 2),
        "averageVolume20": round(average_volume20, 2) if average_volume20 is not None else None,
        "volumeVsAverage20Pct": round(volume_vs_average20, 2) if volume_vs_average20 is not None else None,
        "high20": round(high20, 2),
        "low20": round(low20, 2),
        "extremeDays20": extreme_days,
        "flags": flags,
        "sessions": len(rows),
        "lastDate": rows[-1]["date"],
        "series": [{**row, "returnPct": round(returns[index - 1], 2) if index > 0 else None} for index, row in enumerate(recent, start=start_index)],
    }
    return result


def build() -> dict:
    stocks = json.loads((ROOT / "data/b3-fundamentals.json").read_text(encoding="utf-8"))
    fiis = json.loads((ROOT / "data/fii-catalog.json").read_text(encoding="utf-8"))
    universe = {row["ticker"] for row in stocks + fiis if row.get("ticker")}
    history = read_history(SOURCE, universe)
    assets = {}
    for ticker, rows in history.items():
        result = analyse(ticker, rows)
        if result:
            assets[ticker] = result
    return {
        "generatedAt": datetime.now(UTC).isoformat(),
        "quoteDate": max((row["lastDate"] for row in assets.values()), default=None),
        "modelVersion": "3.2.0",
        "universe": len(universe),
        "analysed": len(assets),
        "methodology": "Retornos de 1, 5 e 20 pregões, z-scores de retorno e log-volume, volume contra média de 20 pregões, gaps, aceleração, repetição de extremos, reversão e contexto de liquidez. Usa arquivos anuais COTAHIST quando disponíveis e completa com pregões diários oficiais; série auditável de até 2.520 pregões.",
        "disclaimer": "Anomalia estatística não comprova fraude, manipulação, intenção ou irregularidade. Verifique eventos corporativos, fatos relevantes e notícias antes de interpretar o movimento.",
        "sources": ["B3 COTAHIST", "CVM Resolução 62", "CVM documentos periódicos e eventuais"],
        "assets": assets,
    }


if __name__ == "__main__":
    payload = build()
    if len(payload["assets"]) < 50:
        raise SystemExit(f"Historical build refused: only {len(payload['assets'])} assets have 30+ sessions")
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(payload['assets'])} anomaly analyses to {OUTPUT}")
