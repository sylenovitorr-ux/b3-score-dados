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
    history: dict[str, list[dict]] = {}
    paths = sorted(folder.glob("COTAHIST_A*.ZIP")) if folder else []
    if not paths:
        return history
    for path in paths[-2:]:
        with zipfile.ZipFile(path) as archive:
            text = archive.read(archive.namelist()[0]).decode("latin1")
        for line in text.splitlines():
            if len(line) < 245 or line[:2] != "01" or line[10:12] != "02" or line[24:27] != "010":
                continue
            ticker = line[12:24].strip()
            if ticker not in universe:
                continue
            try:
                close = int(line[108:121]) / 100
                volume = int(line[170:188]) / 100
            except ValueError:
                continue
            if close <= 0:
                continue
            history.setdefault(ticker, []).append({
                "date": f"{line[2:6]}-{line[6:8]}-{line[8:10]}",
                "close": close,
                "volume": max(0, volume),
            })
    for rows in history.values():
        rows.sort(key=lambda row: row["date"])
    return history


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
    low_liquidity = median_volume < 100_000
    possible_event = any(abs(value) >= 30 for value in recent_returns)
    daily_vol = statistics.stdev(returns[-60:]) if len(returns) >= 20 else 0
    annual_vol = daily_vol * math.sqrt(252)
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
    first_20 = rows[-20]["close"]
    result = {
        "ticker": ticker,
        "score": score,
        "classification": classify(score),
        "latestReturnPct": round(latest_return, 2),
        "returnZ": round(return_z, 2) if return_z is not None else None,
        "volumeZ": round(volume_z, 2) if volume_z is not None else None,
        "return20Pct": round((rows[-1]["close"] / first_20 - 1) * 100, 2),
        "dailyVolatilityPct": round(daily_vol, 2),
        "annualizedVolatilityPct": round(annual_vol, 2),
        "medianVolume20": round(median_volume, 2),
        "extremeDays20": extreme_days,
        "flags": flags,
        "sessions": len(rows),
        "lastDate": rows[-1]["date"],
        "series": [{**row, "returnPct": round(returns[index - 1], 2) if index > 0 else None} for index, row in enumerate(rows[-260:], start=len(rows) - len(rows[-260:]))],
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
        "modelVersion": "2.0.0",
        "universe": len(universe),
        "analysed": len(assets),
        "methodology": "Z-scores de retorno e log-volume, repetição de extremos, reversão e contexto de liquidez. Série auditável de até 260 pregões; os z-scores usam até 60 pregões anteriores.",
        "disclaimer": "Anomalia estatística não comprova fraude, manipulação, intenção ou irregularidade. Verifique eventos corporativos, fatos relevantes e notícias antes de interpretar o movimento.",
        "sources": ["B3 COTAHIST", "CVM Resolução 62", "CVM documentos periódicos e eventuais"],
        "assets": assets,
    }


if __name__ == "__main__":
    payload = build()
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(payload['assets'])} anomaly analyses to {OUTPUT}")
