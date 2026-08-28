#!/usr/bin/env python3
"""Build a daily, auditable equity-options chain from official B3 COTAHIST.

COTAHIST provides end-of-day series, expiration, strike, last premium and
trading activity. It does not provide the closing bid/ask book or open
interest; those fields deliberately remain null in the generated dataset.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
import zipfile
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/b3-data")


def integer(line: str, start: int, end: int) -> int | None:
    value = line[start:end].strip()
    return int(value) if value.isdigit() else None


def money(line: str, start: int, end: int) -> float | None:
    value = integer(line, start, end)
    return value / 100 if value is not None else None


def iso_date(value: str) -> str | None:
    if not re.fullmatch(r"\d{8}", value) or value == "99991231":
        return None
    try:
        return datetime.strptime(value, "%Y%m%d").date().isoformat()
    except ValueError:
        return None


def read_lines(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as archive:
        return archive.read(archive.namelist()[0]).decode("latin1").splitlines()


def session_date(lines: list[str]) -> str | None:
    dates = [iso_date(line[2:10]) for line in lines if len(line) >= 10 and line[:2] == "01"]
    return max((value for value in dates if value), default=None)


def underlying_map(lines: list[str]) -> dict[str, str]:
    by_root: dict[str, list[str]] = {}
    for line in lines:
        if len(line) < 245 or line[:2] != "01" or line[24:27] != "010":
            continue
        ticker = line[12:24].strip()
        specification = line[39:49].strip().upper()
        if not re.fullmatch(r"[A-Z]{4}\d{1,2}", ticker) or not (specification.startswith("ON") or specification.startswith("PN") or specification.startswith("UNT")):
            continue
        by_root.setdefault(ticker[:4], []).append(ticker)
    return {root: candidates[0] for root, candidates in by_root.items() if len(candidates) == 1}


def parse_options(lines: list[str]) -> list[dict]:
    mapping = underlying_map(lines)
    output = []
    for line in lines:
        if len(line) < 245 or line[:2] != "01" or line[24:27] not in {"070", "080"}:
            continue
        ticker = line[12:24].strip()
        underlying = mapping.get(ticker[:4])
        expiration = iso_date(line[202:210])
        strike = money(line, 188, 201)
        premium = money(line, 108, 121)
        if not underlying or not expiration or not re.fullmatch(r"[A-Z0-9]{5,12}", ticker) or not (strike and strike > 0) or premium is None:
            continue
        output.append({
            "ticker": ticker,
            "underlying": underlying,
            "type": "call" if line[24:27] == "070" else "put",
            "expiration": expiration,
            "strike": strike,
            "premium": premium,
            "open": money(line, 56, 69),
            "high": money(line, 69, 82),
            "low": money(line, 82, 95),
            "average": money(line, 95, 108),
            "trades": integer(line, 147, 152),
            "volume": integer(line, 152, 170),
            "financialVolume": money(line, 170, 188),
            "bid": None,
            "ask": None,
            "openInterest": None,
            "isin": line[230:242].strip() or None,
            "source": "B3 COTAHIST",
            "mappingQuality": "raiz do código aponta para um único ativo no pregão",
        })
    return sorted(output, key=lambda row: (row["underlying"], row["expiration"], row["type"], row["strike"], row["ticker"]))


def latest_selic() -> dict:
    url = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.1178/dados/ultimos/10?formato=json"
    request = urllib.request.Request(url, headers={"User-Agent": "B3ScoreGratuito/2.0"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            rows = json.load(response)
        valid = [(datetime.strptime(row["data"], "%d/%m/%Y").date(), float(str(row["valor"]).replace(",", "."))) for row in rows]
        reference, value = max(valid)
        return {"valuePct": value, "referenceDate": reference.isoformat(), "source": "Banco Central do Brasil SGS 1178"}
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        return {"valuePct": None, "referenceDate": None, "source": "Banco Central do Brasil SGS 1178", "status": "indisponível"}


def build(source: Path) -> dict:
    sessions = []
    for path in source.glob("COTAHIST_D*.ZIP"):
        lines = read_lines(path)
        date = session_date(lines)
        if date:
            sessions.append((date, lines))
    if not sessions:
        raise ValueError("Nenhuma sessão válida do COTAHIST foi encontrada.")
    sessions.sort(key=lambda item: item[0], reverse=True)
    latest_market_date = sessions[0][0]
    quote_date = None
    contracts = []
    for candidate_date, lines in sessions:
        candidate_contracts = parse_options(lines)
        if candidate_contracts:
            quote_date = candidate_date
            contracts = candidate_contracts
            break

    # The simplified B3 price report updates equities and FIIs, but may not
    # contain the derivatives segment. Options are therefore an independent,
    # non-critical dataset and must never freeze the main market snapshot.
    if not contracts:
        return {
            "schemaVersion": 1,
            "status": "INDISPONIVEL",
            "updatedAt": datetime.now(UTC).isoformat(),
            "quoteDate": latest_market_date,
            "source": "B3 COTAHIST",
            "referenceRate": latest_selic(),
            "contracts": [],
            "coverage": {
                "automatic": [],
                "unavailable": ["contratos", "bid", "ask", "open interest"],
            },
            "limitations": "Nenhuma sessão disponível continha contratos com vínculo inequívoco. O snapshot principal de ações e FIIs permanece independente e atualizado.",
        }
    return {
        "schemaVersion": 1,
        "status": "ATUALIZADO",
        "updatedAt": datetime.now(UTC).isoformat(),
        "quoteDate": quote_date,
        "source": "B3 COTAHIST",
        "referenceRate": latest_selic(),
        "contracts": contracts,
        "coverage": {
            "automatic": ["série", "tipo", "vencimento", "strike", "último prêmio", "negócios", "quantidade", "volume financeiro"],
            "unavailable": ["bid", "ask", "open interest"],
        },
        "limitations": "Dados de fechamento D-1. COTAHIST não contém bid/ask de fechamento nem posições em aberto. Contratos cujo ativo-objeto não possa ser vinculado inequivocamente são excluídos.",
    }


if __name__ == "__main__":
    payload = build(SOURCE)
    target = ROOT / "data/options-chain.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Generated {len(payload['contracts'])} options from B3 close {payload['quoteDate']} ({payload['status']}).")
