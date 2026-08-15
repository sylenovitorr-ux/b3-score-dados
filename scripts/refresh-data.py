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
    for attempt in range(6):
        try:
            offset = target.stat().st_size if target.exists() else 0
            headers = {"User-Agent": "Mozilla/5.0 (compatible; B3ScoreGratuito/1.0)", "Accept": "application/zip,application/octet-stream,*/*"}
            if offset:
                headers["Range"] = f"bytes={offset}-"
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=90) as response:
                resume = offset > 0 and getattr(response, "status", 200) == 206
                with target.open("ab" if resume else "wb") as output:
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk)
            if zipfile.is_zipfile(target):
                return True
            target.unlink(missing_ok=True)
        except urllib.error.HTTPError as error:
            if 400 <= error.code < 500 and error.code != 429:
                target.unlink(missing_ok=True)
                return False
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException):
            # Preserve the partial file. The next request resumes with Range.
            pass
        if attempt < 5:
            time.sleep(min(8, 2 ** attempt))
    target.unlink(missing_ok=True)
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


def materialize_daily_sessions_from_annual(work: Path, limit: int = 2) -> int:
    """Create daily COTAHIST ZIPs from the latest official annual archive sessions.

    B3's daily endpoint can be temporarily unavailable while the annual archive
    remains accessible. This fallback preserves the official source and never
    fabricates a quote.
    """
    sessions: dict[bytes, list[bytes]] = {}
    for annual_path in sorted(work.glob("COTAHIST_A*.ZIP")):
        with zipfile.ZipFile(annual_path) as archive:
            with archive.open(archive.namelist()[0]) as source:
                for line in source:
                    if len(line) < 10 or line[:2] != b"01":
                        continue
                    reference = line[2:10]
                    sessions.setdefault(reference, []).append(line)
                    if len(sessions) > limit:
                        sessions.pop(min(sessions))
    created = 0
    for reference, lines in sorted(sessions.items()):
        year, month, day = reference[:4].decode(), reference[4:6].decode(), reference[6:8].decode()
        name = f"COTAHIST_D{day}{month}{year}.ZIP"
        target = work / name
        if target.exists():
            continue
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(name.replace(".ZIP", ".TXT"), b"".join(lines))
        created += 1
    return created


with tempfile.TemporaryDirectory(prefix="b3-score-data-") as folder:
    work = Path(folder)
    year = date.today().year

    monthly_years = []
    for report_year in (year - 1, year):
        name = f"inf_mensal_fii_{report_year}.zip"
        if download(f"https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/{name}", work / name):
            monthly_years.append(report_year)
        else:
            print(f"CVM monthly FII file unavailable: {report_year}; continuing with available years.")
    if not monthly_years:
        raise SystemExit("No CVM monthly FII file available")
    quarterly_ok = False
    for report_year in (year - 1, year):
        name = f"inf_trimestral_fii_{report_year}.zip"
        quarterly_ok = download(f"https://dados.cvm.gov.br/dados/FII/DOC/INF_TRIMESTRAL/DADOS/{name}", work / name) or quarterly_ok
    if not quarterly_ok:
        raise SystemExit("No CVM quarterly FII file available")

    annual_history = []
    for history_year in (year - 1, year):
        annual_name = f"COTAHIST_A{history_year}.ZIP"
        if download(f"https://bvmf.bmfbovespa.com.br/InstDados/SerHist/{annual_name}", work / annual_name):
            annual_history.append(history_year)
        else:
            print(f"B3 annual history unavailable for {history_year}; continuing with available years.")

    sessions = 0
    cursor = date.today()
    for _ in range(12):
        name = f"COTAHIST_D{cursor.strftime('%d%m%Y')}.ZIP"
        if download(f"https://bvmf.bmfbovespa.com.br/InstDados/SerHist/{name}", work / name):
            sessions += 1
            if sessions == 2:
                break
        cursor -= timedelta(days=1)
    if sessions < 2 and annual_history:
        created = materialize_daily_sessions_from_annual(work)
        sessions = len(list(work.glob("COTAHIST_D*.ZIP")))
        print(f"B3 daily endpoint incomplete; recovered {created} official sessions from COTAHIST annual.")
    if sessions < 2:
        raise SystemExit("Could not obtain two recent B3 trading sessions")

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
    subprocess.run([sys.executable, str(ROOT / "scripts/build-options.py"), str(work)], check=True)
    subprocess.run([sys.executable, str(ROOT / "scripts/build-daily-radar.py"), str(work)], check=True)
    if annual_history:
        subprocess.run([sys.executable, str(ROOT / "scripts/build-market-anomalies.py"), str(work)], check=True)
        subprocess.run([sys.executable, str(ROOT / "scripts/build-benchmarks.py"), str(work)], check=True)
    else:
        print("Current-year B3 history unavailable; preserving the previous anomaly analysis.")
        print("Current-year B3 history unavailable; preserving the previous benchmark snapshot.")

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
        "historyPolicy": {"annualYears": 10, "quarterlyYears": 5, "marketSessions": 260, "b3HistoryYears": annual_history},
        "sources": ["B3 COTAHIST", "B3 Proventos", "CVM DFP", "CVM ITR", "CVM FCA", "CVM Informes FII", "BCB SGS 12", "BCB SGS 1178"],
    }
    (ROOT / "data/status.json").write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
