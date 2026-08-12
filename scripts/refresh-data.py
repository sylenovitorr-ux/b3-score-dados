#!/usr/bin/env python3
"""Refresh stocks, units, FIIs and fundamentals from official B3/CVM files."""

from __future__ import annotations

import json
import http.client
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def download(url: str, target: Path) -> bool:
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; B3ScoreGratuito/1.0)", "Accept": "application/zip,application/octet-stream,*/*"})
            with urllib.request.urlopen(request, timeout=90) as response:
                target.write_bytes(response.read())
            if zipfile.is_zipfile(target):
                return True
            target.unlink(missing_ok=True)
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException):
            target.unlink(missing_ok=True)
        if attempt < 2:
            time.sleep(2 ** attempt)
    return False


def newest_bulk(work: Path, kind: str, years: range) -> int:
    urls = {
        "dfp": "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_{year}.zip",
        "itr": "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/ITR/DADOS/itr_cia_aberta_{year}.zip",
        "fca": "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/FCA/DADOS/fca_cia_aberta_{year}.zip",
    }
    for year in years:
        if download(urls[kind].format(year=year), work / f"{kind}{year}.zip"):
            return year
    raise SystemExit(f"No current CVM {kind.upper()} bulk file available")


def download_history(work: Path, kind: str, years: range) -> list[int]:
    """Download every available DFP/ITR bulk file without failing on future years."""
    templates = {
        "dfp": "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_{year}.zip",
        "itr": "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/ITR/DADOS/itr_cia_aberta_{year}.zip",
    }
    template = templates[kind]
    available = []
    for report_year in years:
        if download(template.format(year=report_year), work / f"{kind}{report_year}.zip"):
            available.append(report_year)
    if not available:
        raise SystemExit(f"No CVM {kind.upper()} history file available")
    return available


with tempfile.TemporaryDirectory(prefix="b3-score-data-") as folder:
    work = Path(folder)
    year = date.today().year

    for report_year in (year - 1, year):
        name = f"inf_mensal_fii_{report_year}.zip"
        if not download(f"https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/{name}", work / name):
            raise SystemExit(f"CVM monthly FII file unavailable: {report_year}")
    quarterly_ok = False
    for report_year in (year - 1, year):
        name = f"inf_trimestral_fii_{report_year}.zip"
        quarterly_ok = download(f"https://dados.cvm.gov.br/dados/FII/DOC/INF_TRIMESTRAL/DADOS/{name}", work / name) or quarterly_ok
    if not quarterly_ok:
        raise SystemExit("No CVM quarterly FII file available")

    sessions = 0
    cursor = date.today()
    for _ in range(12):
        name = f"COTAHIST_D{cursor.strftime('%d%m%Y')}.ZIP"
        if download(f"https://bvmf.bmfbovespa.com.br/InstDados/SerHist/{name}", work / name):
            sessions += 1
            if sessions == 2:
                break
        cursor -= timedelta(days=1)
    if sessions < 2:
        raise SystemExit("Could not obtain two recent B3 trading sessions")

    annual_name = f"COTAHIST_A{year}.ZIP"
    if not download(f"https://bvmf.bmfbovespa.com.br/InstDados/SerHist/{annual_name}", work / annual_name):
        print("Current-year B3 history unavailable; radar will use the latest session only.")

    dfp_years = download_history(work, "dfp", range(year, year - 11, -1))
    dfp_year = max(dfp_years)
    itr_years = download_history(work, "itr", range(year, year - 6, -1))
    itr_year = max(itr_years)
    fca_year = newest_bulk(work, "fca", range(year, year - 3, -1))

    subprocess.run([sys.executable, str(ROOT / "scripts/build-stocks.py"), str(work)], check=True)
    subprocess.run([
        sys.executable,
        str(ROOT / "scripts/fetch-dividends.py"),
        str(ROOT / "data/b3-catalog.json"),
        str(work / "b3-dividends.json"),
    ], check=True)
    subprocess.run([sys.executable, str(ROOT / "scripts/build-fundamentals.py"), str(work), str(dfp_year), str(itr_year), str(fca_year)], check=True)
    subprocess.run([sys.executable, str(ROOT / "scripts/build-fiis.py"), str(work)], check=True)
    subprocess.run([sys.executable, str(ROOT / "scripts/build-daily-radar.py"), str(work)], check=True)

    stock_data = json.loads((ROOT / "data/b3-fundamentals.json").read_text(encoding="utf-8"))
    fii_data = json.loads((ROOT / "data/fii-catalog.json").read_text(encoding="utf-8"))
    status = {
        "ok": True,
        "updatedAt": datetime.now(UTC).isoformat(),
        "stockQuoteDate": max((row.get("date") or "" for row in stock_data), default=None),
        "fiiQuoteDate": max((row.get("date") or "" for row in fii_data), default=None),
        "stockCount": len(stock_data),
        "stockCvmCount": sum(bool(row.get("fundamentals")) for row in stock_data),
        "fiiCount": len(fii_data),
        "dfpYears": sorted(dfp_years),
        "itrYears": sorted(itr_years),
        "historyPolicy": {"annualYears": 10, "quarterlyYears": 5},
        "sources": ["B3 COTAHIST", "B3 Proventos", "CVM DFP", "CVM ITR", "CVM FCA", "CVM Informes FII"],
    }
    (ROOT / "data/status.json").write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
