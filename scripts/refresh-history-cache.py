#!/usr/bin/env python3
"""Build a zero-cost daily OHLCV cache for the B3 Score app using brapi.dev.

The API token is read only in GitHub Actions through BRAPI_TOKEN and is never
published. Each ticker is stored under data/history/<TICKER>.json so the app
reads GitHub Raw instead of consuming the provider quota on every device.
"""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUTPUT = DATA / "history"
MAX_STOCKS = int(os.environ.get("HISTORY_MAX_STOCKS", "250"))
MAX_FIIS = int(os.environ.get("HISTORY_MAX_FIIS", "100"))
TOKEN = (os.environ.get("BRAPI_TOKEN") or "").strip()


def number(value):
    if value is None or value == "":
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result == result and result not in (float("inf"), float("-inf")) else None


def load_rows(path: Path) -> list[dict]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return payload if isinstance(payload, list) else []


def ticker(row: dict) -> str:
    return str(row.get("ticker") or row.get("symbol") or "").strip().upper()


def volume(row: dict) -> float:
    value = number(row.get("volume"))
    return value if value is not None else -1.0


def choose_universe() -> list[str]:
    stocks = load_rows(DATA / "b3-fundamentals.json")
    fiis = load_rows(DATA / "fii-catalog.json")
    stock_tickers = [ticker(row) for row in sorted(stocks, key=volume, reverse=True) if ticker(row)][:MAX_STOCKS]
    fii_tickers = [ticker(row) for row in sorted(fiis, key=volume, reverse=True) if ticker(row)][:MAX_FIIS]
    # Keep core test/liquid assets in the universe even if source volume is missing.
    priority = ["PETR4", "VALE3", "ITUB4", "BBDC4", "BBAS3", "B3SA3", "ABEV3", "WEGE3"]
    seen = set()
    result = []
    for item in priority + stock_tickers + fii_tickers:
        if item and item not in seen:
            seen.add(item)
            result.append(item)
    return result


def fetch_history(symbol: str) -> dict:
    query = urllib.parse.urlencode({"range": "1y", "interval": "1d"})
    url = f"https://brapi.dev/api/quote/{urllib.parse.quote(symbol)}?{query}"
    headers = {"Accept": "application/json", "User-Agent": "B3ScoreHistoryCache/1.0"}
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=40) as response:
        return json.load(response)


def normalize(symbol: str, payload: dict) -> list[dict]:
    result = (payload.get("results") or [{}])[0]
    rows = result.get("historicalDataPrice") or []
    normalized = []
    for row in rows:
        raw_date = row.get("date")
        try:
            stamp = int(raw_date)
            day = datetime.fromtimestamp(stamp, UTC).date().isoformat()
        except (TypeError, ValueError, OSError, OverflowError):
            day = str(raw_date or "")[:10]
        close = number(row.get("close") if row.get("close") is not None else row.get("adjustedClose"))
        if not day or close is None or close <= 0:
            continue
        normalized.append({
            "date": day,
            "open": number(row.get("open")),
            "high": number(row.get("high")),
            "low": number(row.get("low")),
            "close": close,
            "volume": number(row.get("volume")),
        })
    unique = {row["date"]: row for row in normalized}
    return [unique[key] for key in sorted(unique)]


def main() -> None:
    if not TOKEN:
        raise SystemExit("BRAPI_TOKEN is required for the production history cache")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    universe = choose_universe()
    ok = 0
    failed = []
    latest = None
    for index, symbol in enumerate(universe, start=1):
        try:
            payload = fetch_history(symbol)
            rows = normalize(symbol, payload)
            if len(rows) < 20:
                raise ValueError(f"only {len(rows)} valid rows")
            document = {
                "ticker": symbol,
                "source": "brapi.dev",
                "interval": "1d",
                "range": "1y",
                "generatedAt": datetime.now(UTC).isoformat(),
                "series": rows,
            }
            (OUTPUT / f"{symbol}.json").write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
            ok += 1
            latest = max(latest or rows[-1]["date"], rows[-1]["date"])
            print(f"[{index}/{len(universe)}] {symbol}: {len(rows)} candles")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as error:
            failed.append({"ticker": symbol, "error": str(error)[:180]})
            print(f"[{index}/{len(universe)}] {symbol}: FAILED {error}")
        time.sleep(0.08)

    status = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "source": "brapi.dev",
        "range": "1y",
        "interval": "1d",
        "requested": len(universe),
        "updated": ok,
        "failed": len(failed),
        "latestDate": latest,
        "failures": failed[:50],
    }
    (OUTPUT / "status.json").write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if ok < max(20, int(len(universe) * 0.7)):
        raise SystemExit(f"history cache unhealthy: {ok}/{len(universe)} assets updated")
    print(f"History cache OK: {ok}/{len(universe)} assets; latest={latest}")


if __name__ == "__main__":
    main()
