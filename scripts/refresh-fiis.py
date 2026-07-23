#!/usr/bin/env python3
"""Download the latest official FII inputs and rebuild the static snapshot.

Designed to run locally or from a future daily scheduler. If today's B3 file
is not published, it walks backwards and keeps the two newest valid sessions.
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


def download(url: str, target: Path) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            target.write_bytes(response.read())
        if not zipfile.is_zipfile(target):
            target.unlink(missing_ok=True)
            return False
        return True
    except (urllib.error.URLError, TimeoutError):
        target.unlink(missing_ok=True)
        return False


with tempfile.TemporaryDirectory(prefix="b3-score-fiis-") as folder:
    work = Path(folder)
    year = date.today().year
    for report_year in (year - 1, year):
        name = f"inf_mensal_fii_{report_year}.zip"
        url = f"https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/{name}"
        if not download(url, work / name):
            raise SystemExit(f"CVM monthly file unavailable: {report_year}")
    quarterly_ok = False
    for report_year in (year - 1, year):
        quarterly = f"inf_trimestral_fii_{report_year}.zip"
        if download(f"https://dados.cvm.gov.br/dados/FII/DOC/INF_TRIMESTRAL/DADOS/{quarterly}", work / quarterly):
            quarterly_ok = True
    if not quarterly_ok:
        raise SystemExit("No CVM quarterly FII file available")

    sessions = 0
    cursor = date.today()
    for _ in range(10):
        stamp = cursor.strftime("%d%m%Y")
        name = f"COTAHIST_D{stamp}.ZIP"
        url = f"https://bvmf.bmfbovespa.com.br/InstDados/SerHist/{name}"
        if download(url, work / name):
            sessions += 1
            if sessions == 2:
                break
        cursor -= timedelta(days=1)
    if sessions < 2:
        raise SystemExit("Could not obtain two recent B3 trading sessions")

    subprocess.run([sys.executable, str(ROOT / "scripts/build-fiis.py"), str(work)], check=True)

    catalog = json.loads((ROOT / "data/fii-catalog.json").read_text(encoding="utf-8"))
    quote_date = max((row.get("date") or "" for row in catalog), default=None)
    status = {
        "ok": True,
        "updatedAt": datetime.now(UTC).isoformat(),
        "quoteDate": quote_date,
        "fiiCount": len(catalog),
        "sources": ["B3 COTAHIST", "CVM Dados Abertos"],
    }
    (ROOT / "data/status.json").write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
