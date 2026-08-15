#!/usr/bin/env python3
"""Attach official B3 sector metadata to the generated fundamentals snapshot."""
from __future__ import annotations
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data/b3-fundamentals.json"
SECTORS = ROOT / "data/sector-classification.json"

def root(ticker):
    match = re.match(r"^([A-Z]{4})", str(ticker or "").upper())
    return match.group(1) if match else ""

if __name__ == "__main__":
    assets = json.loads(DATA.read_text(encoding="utf-8"))
    lookup = json.loads(SECTORS.read_text(encoding="utf-8")).get("groups", {})
    count = 0
    for asset in assets:
        f = asset.get("fundamentals")
        item = lookup.get(root(asset.get("ticker")))
        if not f or not item or item.get("ambiguous"):
            continue
        f.update({key: item.get(key) for key in ("sector", "subsector", "industrySegment")})
        f["sectorSource"] = item["source"]
        f["sectorReferenceDate"] = json.loads(SECTORS.read_text(encoding="utf-8")).get("generatedAt")
        count += 1
    DATA.write_text(json.dumps(assets, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Applied official B3 sector metadata to {count} assets")
