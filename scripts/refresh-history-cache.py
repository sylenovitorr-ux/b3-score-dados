#!/usr/bin/env python3
"""Build a zero-cost rotating daily OHLCV cache for the whole B3 Score universe.

First generation is seeded from the official B3 COTAHIST series already stored
in data/market-anomalies.json. brapi.dev then refreshes a bounded rotating batch
when BRAPI_TOKEN is available. End-user devices read GitHub Raw and do not
consume provider quota.
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


def load_json(path: Path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback


def load_rows(path: Path) -> list[dict]:
    payload = load_json(path, [])
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


def normalize_rows(rows: list[dict]) -> list[dict]:
    normalized = []
    for row in rows:
        day = str(row.get("date") or "")[:10]
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


def write_cache(symbol: str, rows: list[dict], source: str) -> None:
    rows = rows[-270:]
    document = {
        "ticker": symbol,
        "source": source,
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


def seed_from_official() -> int:
    payload = load_json(DATA / "market-anomalies.json", {})
    assets = payload.get("assets") if isinstance(payload, dict) else None
    if not isinstance(assets, dict):
        return 0
    seeded = 0
    for symbol, item in assets.items():
        symbol = str(symbol or "").upper()
        if not symbol or (OUTPUT / f"{symbol}.json").exists():
            continue
        rows = normalize_rows((item or {}).get("series") or [])
        if len(rows) < 20:
            continue
        write_cache(symbol, rows, "B3 COTAHIST seed")
        seeded += 1
    return seeded


def cache_age_key(symbol: str):
    path = OUTPUT / f"{symbol}.json"
    if not path.exists():
        return (0, "")
    payload = load_json(path, {})
    generated = str(payload.get("generatedAt") or "")
    series = payload.get("series") or []
    latest = str(series[-1].get("date") or "") if series else ""
    return (1, generated or latest)


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
    headers = {"Accept": "application/json", "User-Agent": "B3ScoreHistoryCache/3.0"}
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=40) as response:
        return json.load(response)


def normalize_remote(payload: dict) -> list[dict]:
    result = (payload.get("results") or [{}])[0]
    rows = result.get("historicalDataPrice") or []
    converted = []
    for row in rows:
        raw_date = row.get("date")
        try:
            stamp = int(raw_date)
            day = datetime.fromtimestamp(stamp, UTC).date().isoformat()
        except (TypeError, ValueError, OSError, OverflowError):
            day = str(raw_date or "")[:10]
        converted.append({**row, "date": day})
    return normalize_rows(converted)


def existing_series(symbol: str) -> list[dict]:
    payload = load_json(OUTPUT / f"{symbol}.json", {})
    series = payload.get("series") or []
    return normalize_rows(series) if isinstance(series, list) else []


def merge_series(old: list[dict], new: list[dict]) -> list[dict]:
    merged = {row["date"]: row for row in normalize_rows(old + new)}
    return [merged[key] for key in sorted(merged)][-270:]


def cache_coverage(universe: list[str]) -> tuple[int, list[str]]:
    covered = []
    missing = []
    for symbol in universe:
        payload = load_json(OUTPUT / f"{symbol}.json", {})
        if len(payload.get("series") or []) >= 20:
            covered.append(symbol)
        else:
            missing.append(symbol)
    return len(covered), missing


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    universe = choose_universe()
    if not universe:
        raise SystemExit("No tickers found in app data files")

    seeded = seed_from_official()
    batch = choose_batch(universe)
    remote_ok = 0
    failed = []
    latest = None

    print(f"Universe={len(universe)}; seeded={seeded}; batch={len(batch)}; token={'yes' if TOKEN else 'no'}")
    if TOKEN:
        for index, symbol in enumerate(batch, start=1):
            try:
                incoming = normalize_remote(fetch_history(symbol))
                if len(incoming) < 20:
                    raise ValueError(f"only {len(incoming)} valid rows")
                rows = merge_series(existing_series(symbol), incoming)
                write_cache(symbol, rows, "brapi.dev + B3 COTAHIST seed")
                remote_ok += 1
                latest = max(latest or rows[-1]["date"], rows[-1]["date"])
                print(f"[{index}/{len(batch)}] {symbol}: {len(rows)} candles; latest={rows[-1]['date']}")
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as error:
                failed.append({"ticker": symbol, "error": str(error)[:180]})
                print(f"[{index}/{len(batch)}] {symbol}: FAILED {error}")
            time.sleep(0.08)
    else:
        print("BRAPI_TOKEN unavailable; publishing official B3 seed now and leaving remote rotation for a later run.")

    covered, missing = cache_coverage(universe)
    updated_this_run = seeded + remote_ok
    status = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "source": "B3 COTAHIST seed + brapi.dev rotation",
        "range": "1y",
        "interval": "1d",
        "policy": "full-universe seed from official B3; rotating brapi batch missing-first then oldest-cache",
        "universe": len(universe),
        "batchSize": len(batch),
        "seededThisRun": seeded,
        "remoteUpdatedThisRun": remote_ok,
        "updatedThisRun": updated_this_run,
        "failedThisRun": len(failed),
        "covered": covered,
        "missing": len(missing),
        "coveragePct": round(covered / len(universe) * 100, 2),
        "latestDate": latest,
        "nextMissing": missing[:50],
        "failures": failed[:50],
    }
    (OUTPUT / "status.json").write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if updated_this_run < 10 and covered < 50:
        raise SystemExit(f"history cache unhealthy: updated={updated_this_run}; covered={covered}/{len(universe)}")
    print(f"History cache OK: updated={updated_this_run}; coverage={covered}/{len(universe)} ({status['coveragePct']}%)")


if __name__ == "__main__":
    main()
