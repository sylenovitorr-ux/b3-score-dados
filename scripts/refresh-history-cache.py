#!/usr/bin/env python3
"""Build a zero-cost rotating daily OHLCV cache for the whole B3 Score universe.

Every ticker present in the app is eligible. To stay comfortably inside the
free brapi.dev quota, each run updates only a bounded batch chosen by age:
missing caches first, then the stalest caches. Files live in data/history and
are served by GitHub Raw, so end-user devices do not consume provider quota.
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
TOKEN = (os.environ.get("BRAPI_TOKEN") or "").strip()
BATCH_SIZE = max(1, int(os.environ.get("HISTORY_BATCH_SIZE", "120")))
PRIORITY = ["PETR4", "VALE3", "ITUB4", "BBDC4", "BBAS3", "B3SA3", "ABEV3", "WEGE3"]


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


def choose_universe() -> list[str]:
    rows = load_rows(DATA / "b3-fundamentals.json") + load_rows(DATA / "fii-catalog.json")
    seen = set()
    universe = []
    for symbol in PRIORITY + [ticker(row) for row in rows]:
        if symbol and symbol not in seen:
            seen.add(symbol)
            universe.append(symbol)
    return universe


def cache_age_key(symbol: str):
    path = OUTPUT / f"{symbol}.json"
    if not path.exists():
        return (0, "")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        generated = str(payload.get("generatedAt") or "")
        latest = str((payload.get("series") or [{}])[-1].get("date") or "")
        return (1, generated or latest)
    except (OSError, json.JSONDecodeError, IndexError, AttributeError):
        return (0, "")


def choose_batch(universe: list[str]) -> list[str]:
    priority_rank = {symbol: index for index, symbol in enumerate(PRIORITY)}
    ordered = sorted(
        universe,
        key=lambda symbol: (
            cache_age_key(symbol),
            priority_rank.get(symbol, len(PRIORITY)),
            symbol,
        ),
    )
    return ordered[: min(BATCH_SIZE, len(ordered))]


def fetch_history(symbol: str) -> dict:
    query = urllib.parse.urlencode({"range": "1y", "interval": "1d"})
    url = f"https://brapi.dev/api/quote/{urllib.parse.quote(symbol)}?{query}"
    headers = {"Accept": "application/json", "User-Agent": "B3ScoreHistoryCache/2.0"}
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=40) as response:
        return json.load(response)


def normalize(payload: dict) -> list[dict]:
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


def existing_series(symbol: str) -> list[dict]:
    path = OUTPUT / f"{symbol}.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        series = payload.get("series") or []
        return series if isinstance(series, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def merge_series(old: list[dict], new: list[dict]) -> list[dict]:
    merged = {}
    for row in old + new:
        day = str(row.get("date") or "")
        close = number(row.get("close"))
        if day and close is not None and close > 0:
            merged[day] = {
                "date": day,
                "open": number(row.get("open")),
                "high": number(row.get("high")),
                "low": number(row.get("low")),
                "close": close,
                "volume": number(row.get("volume")),
            }
    rows = [merged[key] for key in sorted(merged)]
    return rows[-270:]


def cache_coverage(universe: list[str]) -> tuple[int, list[str]]:
    covered = []
    missing = []
    for symbol in universe:
        path = OUTPUT / f"{symbol}.json"
        if path.exists():
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                if len(payload.get("series") or []) >= 20:
                    covered.append(symbol)
                    continue
            except (OSError, json.JSONDecodeError):
                pass
        missing.append(symbol)
    return len(covered), missing


def main() -> None:
    if not TOKEN:
        raise SystemExit("BRAPI_TOKEN is required for the production history cache")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    universe = choose_universe()
    if not universe:
        raise SystemExit("No tickers found in app data files")
    batch = choose_batch(universe)
    ok = 0
    failed = []
    latest = None

    print(f"Universe={len(universe)}; batch={len(batch)}; policy=missing-first then oldest-cache")
    for index, symbol in enumerate(batch, start=1):
        try:
            payload = fetch_history(symbol)
            incoming = normalize(payload)
            if len(incoming) < 20:
                raise ValueError(f"only {len(incoming)} valid rows")
            rows = merge_series(existing_series(symbol), incoming)
            document = {
                "ticker": symbol,
                "source": "brapi.dev",
                "interval": "1d",
                "range": "1y",
                "generatedAt": datetime.now(UTC).isoformat(),
                "latestDate": rows[-1]["date"],
                "series": rows,
            }
            (OUTPUT / f"{symbol}.json").write_text(
                json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n",
                encoding="utf-8",
            )
            ok += 1
            latest = max(latest or rows[-1]["date"], rows[-1]["date"])
            print(f"[{index}/{len(batch)}] {symbol}: {len(rows)} candles; latest={rows[-1]['date']}")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as error:
            failed.append({"ticker": symbol, "error": str(error)[:180]})
            print(f"[{index}/{len(batch)}] {symbol}: FAILED {error}")
        time.sleep(0.08)

    covered, missing = cache_coverage(universe)
    status = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "source": "brapi.dev",
        "range": "1y",
        "interval": "1d",
        "policy": "full-universe rotating batch; missing first, then oldest cache",
        "universe": len(universe),
        "batchSize": len(batch),
        "updatedThisRun": ok,
        "failedThisRun": len(failed),
        "covered": covered,
        "missing": len(missing),
        "coveragePct": round(covered / len(universe) * 100, 2),
        "latestDate": latest,
        "nextMissing": missing[:50],
        "failures": failed[:50],
    }
    (OUTPUT / "status.json").write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    minimum_success = max(10, int(len(batch) * 0.6))
    if ok < minimum_success:
        raise SystemExit(f"history batch unhealthy: {ok}/{len(batch)} assets updated")
    print(f"History cache OK: run={ok}/{len(batch)}; coverage={covered}/{len(universe)} ({status['coveragePct']}%)")


if __name__ == "__main__":
    main()
