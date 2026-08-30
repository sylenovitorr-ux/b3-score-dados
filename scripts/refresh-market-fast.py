#!/usr/bin/env python3
"""Fast post-close refresh for B3 prices without waiting for the heavy CVM pipeline.

Updates the stock/unit quote layer, reuses the last validated fundamentals,
patches IBOV when present in COTAHIST and advances status.json. No price is
fabricated: if two official B3 sessions cannot be obtained, the script fails
and keeps the previous published snapshot untouched.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
UA = "Mozilla/5.0 (compatible; B3ScoreGratuito/4.0)"
QUOTE_KEYS = {
    "ticker", "name", "kind", "date", "priceopen", "high", "low", "price",
    "trades", "quantity", "volume", "closeyest", "change", "changepct",
}


def download_daily(reference: date, target: Path) -> bool:
    name = f"COTAHIST_D{reference.strftime('%d%m%Y')}.ZIP"
    url = f"https://bvmf.bmfbovespa.com.br/InstDados/SerHist/{name}"
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/zip,application/octet-stream,*/*"})
    try:
        with urllib.request.urlopen(request, timeout=18) as response:
            payload = response.read()
        if len(payload) < 100:
            return False
        target.write_bytes(payload)
        if zipfile.is_zipfile(target):
            return True
    except (urllib.error.URLError, TimeoutError, OSError):
        pass
    target.unlink(missing_ok=True)
    return False


def collect_recent_sessions(work: Path, required: int = 2) -> list[Path]:
    found: list[Path] = []
    cursor = date.today()
    for _ in range(16):
        if cursor.weekday() < 5:
            target = work / f"COTAHIST_D{cursor.strftime('%d%m%Y')}.ZIP"
            if download_daily(cursor, target):
                found.append(target)
                print(f"B3 COTAHIST obtido: {cursor.isoformat()}")
                if len(found) >= required:
                    break
        cursor -= timedelta(days=1)
    if len(found) < required:
        raise SystemExit(f"B3 rápida abortada: apenas {len(found)} pregão(ões) oficial(is) encontrado(s).")
    return found


def merge_quotes_into_fundamentals() -> tuple[str, int, int]:
    catalog = json.loads((DATA / "b3-catalog.json").read_text(encoding="utf-8"))
    fundamentals_path = DATA / "b3-fundamentals.json"
    existing = json.loads(fundamentals_path.read_text(encoding="utf-8"))
    old = {row.get("ticker"): row for row in existing if row.get("ticker")}
    result = []
    for quote in catalog:
        ticker = quote.get("ticker")
        previous = old.get(ticker, {})
        merged = {**previous}
        for key in QUOTE_KEYS:
            if key in quote:
                merged[key] = quote[key]
        result.append(merged)
    result.sort(key=lambda row: row.get("ticker") or "")
    fundamentals_path.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    quote_date = max((row.get("date") or "" for row in result), default="")
    cvm_count = sum(bool(row.get("fundamentals")) for row in result)
    return quote_date, len(result), cvm_count


def read_index_rows(paths: list[Path], ticker: str = "IBOV") -> list[dict]:
    by_date: dict[str, dict] = {}
    for path in paths:
        with zipfile.ZipFile(path) as archive:
            with archive.open(archive.namelist()[0]) as source:
                for raw in source:
                    if len(raw) < 121 or raw[:2] != b"01":
                        continue
                    line = raw.decode("latin1")
                    if line[12:24].strip() != ticker:
                        continue
                    try:
                        value = int(line[108:121]) / 100
                    except ValueError:
                        continue
                    if value > 0:
                        reference = f"{line[2:6]}-{line[6:8]}-{line[8:10]}"
                        by_date[reference] = {"date": reference, "value": value}
    return [by_date[key] for key in sorted(by_date)]


def patch_ibov(paths: list[Path]) -> None:
    path = DATA / "benchmarks.json"
    if not path.exists():
        return
    payload = json.loads(path.read_text(encoding="utf-8"))
    ibov = ((payload.get("series") or {}).get("IBOV") or {})
    recent = read_index_rows(paths, "IBOV")
    if not recent:
        print("IBOV não apareceu nos COTAHIST diários; benchmark anterior será preservado.")
        return
    merged = {row.get("date"): {"date": row.get("date"), "value": row.get("value")} for row in ibov.get("series", []) if row.get("date") and row.get("value") is not None}
    for row in recent:
        merged[row["date"]] = row
    rows = [merged[key] for key in sorted(merged)][-2520:]
    if not rows or not rows[0].get("value"):
        return
    base = rows[0]["value"]
    rows = [{**row, "base100": round(row["value"] / base * 100, 6)} for row in rows]
    ibov.update({
        "id": "IBOV",
        "name": ibov.get("name") or "Ibovespa",
        "status": "ATUALIZADO",
        "source": "B3 COTAHIST",
        "referenceDate": rows[-1]["date"],
        "updatedAt": datetime.now(UTC).isoformat(),
        "normalization": "primeira observação = 100",
        "series": rows,
    })
    payload.setdefault("series", {})["IBOV"] = ibov
    payload["generatedAt"] = datetime.now(UTC).isoformat()
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"IBOV atualizado até {rows[-1]['date']}.")


def update_status(quote_date: str, stock_count: int, cvm_count: int) -> None:
    path = DATA / "status.json"
    status = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    status.update({
        "ok": True,
        "updatedAt": datetime.now(UTC).isoformat(),
        "stockQuoteDate": quote_date,
        "stockCount": stock_count,
        "stockCvmCount": cvm_count,
        "universe": "acoes_units",
    })
    status.setdefault("sources", ["B3 COTAHIST", "CVM DFP", "CVM ITR", "CVM FCA"])
    path.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="b3-score-fast-") as folder:
        work = Path(folder)
        sessions = collect_recent_sessions(work, required=2)
        subprocess.run([sys.executable, str(ROOT / "scripts/build-stocks.py"), str(work)], check=True)
        quote_date, stock_count, cvm_count = merge_quotes_into_fundamentals()
        if not quote_date:
            raise SystemExit("Snapshot rápido não produziu data de cotação.")
        patch_ibov(sessions)
        update_status(quote_date, stock_count, cvm_count)
        print(f"Snapshot rápido concluído: pregão={quote_date}; ativos={stock_count}; CVM preservada={cvm_count}.")


if __name__ == "__main__":
    main()
