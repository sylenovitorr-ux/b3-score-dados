#!/usr/bin/env python3
"""Fetch structured cash distributions from the official B3 listed-company API."""

from __future__ import annotations

import base64
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dividend_engine import deduplicate_events, normalize_event

CATALOG = Path(sys.argv[1])
OUTPUT = Path(sys.argv[2])
ENDPOINT = "https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetListedCashDividends"


def request_page(trading_name, page):
    params = {
        "tradingName": trading_name,
        "language": "pt-br",
        "pageNumber": page,
        "pageSize": 100,
    }
    encoded = base64.b64encode(json.dumps(params, ensure_ascii=False).encode("utf-8")).decode("ascii")
    request = urllib.request.Request(
        f"{ENDPOINT}/{encoded}",
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; B3ScoreGratuito/3.1)",
            "Accept": "application/json",
            "Referer": "https://sistemaswebb3-listados.b3.com.br/",
        },
    )
    with urllib.request.urlopen(request, timeout=35) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_company(trading_name):
    events = []
    try:
        first = request_page(trading_name, 1)
        pages = max(1, int((first.get("page") or {}).get("totalPages") or 1))
        payloads = [first]
        for page in range(2, min(pages, 20) + 1):
            time.sleep(0.12)
            payloads.append(request_page(trading_name, page))
        for payload in payloads:
            for raw in payload.get("results") or []:
                event = normalize_event(raw, trading_name)
                if event:
                    events.append(event)
    except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError):
        return trading_name, []
    return trading_name, deduplicate_events(events)


catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
names = sorted({str(row.get("name") or "").strip().upper() for row in catalog if row.get("name")})
result = {}
with ThreadPoolExecutor(max_workers=6) as executor:
    futures = {executor.submit(fetch_company, name): name for name in names}
    for future in as_completed(futures):
        name, events = future.result()
        if events:
            result[name] = events

OUTPUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
print(f"Fetched {sum(map(len, result.values()))} B3 cash events for {len(result)}/{len(names)} trading names.")
