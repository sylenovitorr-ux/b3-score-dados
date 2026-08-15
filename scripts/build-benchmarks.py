#!/usr/bin/env python3
"""Build auditable benchmark series from official B3 COTAHIST and BCB SGS.

The builder never fills missing observations. Each series is normalized to 100
only after its first valid observation, preserving source and reference date.
"""

from __future__ import annotations

import json
import base64
import sys
import urllib.parse
import urllib.request
import zipfile
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else None
OUTPUT = ROOT / "data/benchmarks.json"
HISTORY_SESSIONS = 2520
HISTORY_DAYS = 3654
INDEXES = {
    "IBOV": "Ibovespa",
    "IFNC": "Índice Financeiro",
    "IMAT": "Índice de Materiais Básicos",
    "ICON": "Índice de Consumo",
    "IEEX": "Índice de Energia Elétrica",
    "IDIV": "Índice Dividendos",
    "SMLL": "Índice Small Cap",
}


def read_b3_indexes(folder: Path | None) -> dict[str, list[dict]]:
    result = {ticker: [] for ticker in INDEXES}
    if not folder:
        return result
    for path in sorted(folder.glob("COTAHIST_A*.ZIP")):
        with zipfile.ZipFile(path) as archive:
            with archive.open(archive.namelist()[0]) as source:
                for raw in source:
                    line = raw.decode("latin1")
                    if len(line) < 121 or line[:2] != "01":
                        continue
                    ticker = line[12:24].strip()
                    if ticker not in result:
                        continue
                    try:
                        close = int(line[108:121]) / 100
                    except ValueError:
                        continue
                    if close > 0:
                        result[ticker].append({"date": f"{line[2:6]}-{line[6:8]}-{line[8:10]}", "value": close})
    for rows in result.values():
        rows.sort(key=lambda row: row["date"])
    return result


def parse_ptbr_number(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(str(value).replace(".", "").replace(",", "."))
    except ValueError:
        return None


def parse_b3_daily(payload: dict, year: int) -> list[dict]:
    rows = []
    for item in payload.get("results", []):
        day = item.get("day")
        if not isinstance(day, int):
            continue
        for month in range(1, 13):
            value = parse_ptbr_number(item.get(f"rateValue{month}"))
            if value is None or value <= 0:
                continue
            try:
                reference = date(year, month, day).isoformat()
            except ValueError:
                continue
            rows.append({"date": reference, "value": value})
    return sorted(rows, key=lambda row: row["date"])


def fetch_b3_index(ticker: str, years: list[int]) -> list[dict]:
    backend_ticker = "IBOVESPA" if ticker == "IBOV" else ticker
    rows = []
    for year in years:
        encoded = base64.b64encode(json.dumps({"index": backend_ticker, "language": "pt-br", "year": str(year)}, separators=(",", ":")).encode()).decode()
        url = f"https://sistemaswebb3-listados.b3.com.br/indexStatisticsProxy/IndexCall/GetPortfolioDay/{encoded}"
        request = urllib.request.Request(url, headers={"User-Agent": "B3ScoreGratuito/1.0", "Accept": "application/json"})
        with urllib.request.urlopen(request, timeout=45) as response:
            rows.extend(parse_b3_daily(json.load(response), year))
    return sorted({row["date"]: row for row in rows}.values(), key=lambda row: row["date"])


def normalized(rows: list[dict]) -> list[dict]:
    if not rows or not rows[0].get("value"):
        return []
    base = rows[0]["value"]
    return [{**row, "base100": round(row["value"] / base * 100, 6)} for row in rows]


def compound_daily_percent(rows: list[dict]) -> list[dict]:
    level = 100.0
    output = []
    for row in rows:
        value = float(row["value"])
        level *= 1 + value / 100
        output.append({**row, "base100": round(level, 6)})
    return output


def compound_annualized_rate(rows: list[dict]) -> list[dict]:
    """Build a transparent Selic accumulation from the official annualized rate."""
    level = 100.0
    output = []
    for row in rows:
        value = float(row["value"])
        level *= (1 + value / 100) ** (1 / 252)
        output.append({**row, "base100": round(level, 6)})
    return output


def fetch_sgs(series_id: int, start: date, end: date) -> list[dict]:
    query = urllib.parse.urlencode({
        "formato": "json",
        "dataInicial": start.strftime("%d/%m/%Y"),
        "dataFinal": end.strftime("%d/%m/%Y"),
    })
    request = urllib.request.Request(
        f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{series_id}/dados?{query}",
        headers={"User-Agent": "B3ScoreGratuito/1.0"},
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        payload = json.load(response)
    rows = []
    for item in payload:
        try:
            reference = datetime.strptime(item["data"], "%d/%m/%Y").date().isoformat()
            value = float(str(item["valor"]).replace(",", "."))
        except (KeyError, TypeError, ValueError):
            continue
        rows.append({"date": reference, "value": value})
    return rows


def unavailable(identifier: str, name: str, source: str, reason: str) -> dict:
    return {"id": identifier, "name": name, "status": "INDISPONÍVEL", "source": source, "referenceDate": None, "series": [], "limitation": reason}


def build() -> dict:
    now = datetime.now(UTC)
    end = now.date()
    start = end - timedelta(days=HISTORY_DAYS)
    b3_fallback = read_b3_indexes(SOURCE)
    series = {}
    for ticker, name in INDEXES.items():
        source = "B3 Estatísticas de Índices — GetPortfolioDay"
        try:
            official_rows = fetch_b3_index(ticker, list(range(end.year - 9, end.year + 1)))
        except (OSError, ValueError, json.JSONDecodeError):
            official_rows = b3_fallback[ticker]
            source = "B3 COTAHIST — fallback"
        rows = normalized(official_rows[-HISTORY_SESSIONS:])
        series[ticker] = ({
            "id": ticker, "name": name, "status": "ATUALIZADO", "source": source,
            "referenceDate": rows[-1]["date"], "updatedAt": now.isoformat(), "normalization": "primeira observação = 100", "series": rows,
        } if rows else unavailable(ticker, name, source, "A consulta oficial e o fallback não retornaram observações deste índice."))
    try:
        cdi_rows = compound_daily_percent(fetch_sgs(12, start, end))[-HISTORY_SESSIONS:]
        series["CDI"] = {
            "id": "CDI", "name": "CDI acumulado", "status": "ATUALIZADO" if cdi_rows else "INDISPONÍVEL",
            "source": "Banco Central do Brasil — SGS 12", "referenceDate": cdi_rows[-1]["date"] if cdi_rows else None,
            "updatedAt": now.isoformat(), "normalization": "100 × produto(1 + taxa diária/100)", "series": cdi_rows,
            "limitation": None if cdi_rows else "A série SGS não retornou observações.",
        }
    except (OSError, ValueError, json.JSONDecodeError) as error:
        series["CDI"] = unavailable("CDI", "CDI acumulado", "Banco Central do Brasil — SGS 12", f"Falha de atualização: {type(error).__name__}.")
    try:
        selic_rows = compound_annualized_rate(fetch_sgs(1178, start, end))[-HISTORY_SESSIONS:]
        series["SELIC"] = {
            "id": "SELIC", "name": "Selic acumulada", "status": "ATUALIZADO" if selic_rows else "INDISPONÍVEL",
            "source": "Banco Central do Brasil — SGS 1178", "referenceDate": selic_rows[-1]["date"] if selic_rows else None,
            "updatedAt": now.isoformat(), "normalization": "100 × produto((1 + Selic anual/100)^(1/252))", "series": selic_rows,
            "limitation": "Acumulação teórica da taxa Selic anualizada; CDI é a taxa efetiva interbancária.",
        }
    except (OSError, ValueError, json.JSONDecodeError) as error:
        series["SELIC"] = unavailable("SELIC", "Selic acumulada", "Banco Central do Brasil — SGS 1178", f"Falha de atualização: {type(error).__name__}.")
    return {
        "generatedAt": now.isoformat(), "modelVersion": "1.1.0", "series": series,
        "methodology": "Séries de até 2.520 pregões (aproximadamente 10 anos). Índices: evolução diária oficial B3 normalizada pela primeira observação, com COTAHIST como fallback. CDI: composição das taxas diárias oficiais SGS 12. Selic: acumulação teórica da série anualizada SGS 1178 em base 252.",
    }


if __name__ == "__main__":
    payload = build()
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {sum(bool(item['series']) for item in payload['series'].values())} benchmark series to {OUTPUT}")
