#!/usr/bin/env python3
"""Build the official stock/unit snapshot from two B3 COTAHIST sessions."""

from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/b3-data")


def cotahist(path: Path):
    result = {}
    with zipfile.ZipFile(path) as archive:
        text = archive.read(archive.namelist()[0]).decode("latin1")
    for line in text.splitlines():
        if len(line) < 245 or line[:2] != "01" or line[10:12] != "02" or line[24:27] != "010":
            continue
        ticker = line[12:24].strip()
        specification = line[39:49].strip().upper()
        if not re.fullmatch(r"[A-Z]{4}[0-9]{1,2}", ticker):
            continue
        if specification.startswith("UNT"):
            kind = "unit"
        elif specification.startswith("ON") or specification.startswith("PN"):
            kind = "stock"
        else:
            continue
        result[ticker] = {
            "ticker": ticker,
            "name": line[27:39].strip().title(),
            "kind": kind,
            "date": f"{line[2:6]}-{line[6:8]}-{line[8:10]}",
            "priceopen": int(line[56:69]) / 100,
            "high": int(line[69:82]) / 100,
            "low": int(line[82:95]) / 100,
            "price": int(line[108:121]) / 100,
            "trades": int(line[147:152]),
            "quantity": int(line[152:170]),
            "volume": int(line[170:188]) / 100,
        }
    return result


sessions = []
for path in SOURCE.glob("COTAHIST_D*.ZIP"):
    rows = cotahist(path)
    if rows:
        sessions.append((max(row["date"] for row in rows.values()), rows))
sessions.sort(key=lambda item: item[0], reverse=True)
if len(sessions) < 2:
    raise SystemExit("Two valid B3 sessions are required")

current_date, current = sessions[0]
previous = sessions[1][1]
existing_path = (ROOT / "data/b3-catalog.json") if (ROOT / "data/b3-catalog.json").exists() else (ROOT / "app/data/b3-catalog.json")
existing = {row["ticker"]: row for row in json.loads(existing_path.read_text(encoding="utf-8"))} if existing_path.exists() else {}
output = []
for ticker, quote in sorted(current.items()):
    prior = previous.get(ticker, {}).get("price")
    change = quote["price"] - prior if prior else None
    output.append({
        **quote,
        "closeyest": prior,
        "change": change,
        "changepct": change / prior * 100 if change is not None and prior else None,
    })

# Some valid shares do not trade every day. Keep their last official quote
# instead of making them disappear from the searchable universe.
for ticker, quote in sorted(existing.items()):
    if ticker not in current and quote.get("kind") in {"stock", "unit"}:
        output.append(quote)
output.sort(key=lambda row: row["ticker"])

paths = [ROOT / "data/b3-catalog.json"] if (ROOT / "data").exists() else [ROOT / "app/data/b3-catalog.json", ROOT / "public/b3-catalog.json"]
for path in paths:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
print(f"Generated {len(output)} stocks/units from B3 close {current_date}.")
