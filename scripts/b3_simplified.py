#!/usr/bin/env python3
"""Download BVBG.186.01 and expose it as COTAHIST-compatible daily files.

The official simplified B3 report is used only for equities/FIIs already known
by the audited local universe. It complements, but does not rewrite, history.
"""

from __future__ import annotations

import http.cookiejar
import io
import json
import os
import urllib.request
import zipfile
from datetime import date
from pathlib import Path
from xml.etree import ElementTree

PAGE = "https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/historico/boletins-diarios/pesquisa-por-pregao/pesquisa-por-pregao/"
DEFAULT_TEMPLATE = "https://www.b3.com.br/pesquisapregao/download?filelist=SPRE{date}.zip"
USER_AGENT = "Mozilla/5.0 (compatible; B3ScoreGratuito/3.0; +https://github.com/sylenovitorr-ux/b3-score-dados)"


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def first_text(node, names: tuple[str, ...]) -> str | None:
    for child in node.iter():
        if local_name(child.tag) in names and child.text and child.text.strip():
            return child.text.strip()
    return None


def number(node, names: tuple[str, ...], default: float = 0) -> float:
    value = first_text(node, names)
    try:
        return float(value) if value is not None else default
    except ValueError:
        return default


def known_universe(root: Path) -> dict[str, dict]:
    result: dict[str, dict] = {}
    paths = [(root / "data/b3-catalog.json", None), (root / "data/fii-catalog.json", "fii")]
    for path, forced_kind in paths:
        if not path.exists():
            continue
        for row in json.loads(path.read_text(encoding="utf-8")):
            ticker = str(row.get("ticker") or "").strip().upper()
            if ticker:
                result[ticker] = {"name": row.get("name") or ticker, "kind": forced_kind or row.get("kind") or "stock", "isin": row.get("isin") or ""}
    return result


def _field(line: list[str], start: int, end: int, value, align: str = "left") -> None:
    width = end - start
    text = str(value or "")[:width]
    text = text.rjust(width, "0" if align == "zero" else " ") if align != "left" else text.ljust(width)
    line[start:end] = text


def cotahist_record(reference: str, ticker: str, meta: dict, quote: dict) -> str:
    line = [" "] * 245
    kind = meta.get("kind")
    _field(line, 0, 2, "01")
    _field(line, 2, 10, reference.replace("-", ""))
    _field(line, 10, 12, "12" if kind == "fii" else "02")
    _field(line, 12, 24, ticker)
    _field(line, 24, 27, "010")
    _field(line, 27, 39, str(meta.get("name") or ticker).upper())
    _field(line, 39, 49, "CI" if kind == "fii" else "UNT" if kind == "unit" else "ON")
    _field(line, 49, 52, "R$")
    for start, key in ((56, "open"), (69, "high"), (82, "low"), (95, "average"), (108, "close"), (121, "close"), (134, "close")):
        _field(line, start, start + 13, round(max(0, quote.get(key) or quote.get("close") or 0) * 100), "zero")
    _field(line, 147, 152, round(max(0, quote.get("trades") or 0)), "zero")
    _field(line, 152, 170, round(max(0, quote.get("quantity") or 0)), "zero")
    _field(line, 170, 188, round(max(0, quote.get("volume") or 0) * 100), "zero")
    _field(line, 210, 217, "1", "zero")
    _field(line, 230, 242, meta.get("isin") or "")
    return "".join(line)


def xml_payloads(payload: bytes) -> list[bytes]:
    pending = [payload]
    result = []
    while pending:
        item = pending.pop()
        if zipfile.is_zipfile(io.BytesIO(item)):
            with zipfile.ZipFile(io.BytesIO(item)) as archive:
                pending.extend(archive.read(name) for name in archive.namelist() if not name.endswith("/"))
        elif item.lstrip().startswith(b"<"):
            result.append(item)
    return result


def parse_report(payload: bytes, universe: dict[str, dict]) -> dict[str, dict[str, dict]]:
    sessions: dict[str, dict[str, dict]] = {}
    for xml in xml_payloads(payload):
        tree = ElementTree.fromstring(xml)
        for node in tree.iter():
            if local_name(node.tag) != "PricRpt":
                continue
            ticker = (first_text(node, ("TckrSymb",)) or "").upper()
            reference = first_text(node, ("Dt",))
            close = number(node, ("LastPric",), -1)
            if ticker not in universe or not reference or close <= 0:
                continue
            sessions.setdefault(reference[:10], {})[ticker] = {
                "open": number(node, ("FrstPric",), close), "high": number(node, ("MaxPric",), close),
                "low": number(node, ("MinPric",), close), "average": number(node, ("TradAvrgPric",), close), "close": close,
                "trades": number(node, ("RglrTxsQty", "TradQty")), "quantity": number(node, ("FinInstrmQty", "TradgQty")),
                "volume": number(node, ("NtlFinVol", "FinVol")),
            }
    return sessions


def materialize(payload: bytes, work: Path, universe: dict[str, dict]) -> int:
    created = 0
    for reference, quotes in parse_report(payload, universe).items():
        if not quotes:
            continue
        parsed = date.fromisoformat(reference)
        name = f"COTAHIST_D{parsed.strftime('%d%m%Y')}.ZIP"
        records = [cotahist_record(reference, ticker, universe[ticker], quote) for ticker, quote in sorted(quotes.items())]
        with zipfile.ZipFile(work / name, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(name.replace(".ZIP", ".TXT"), "\n".join(records) + "\n")
        created += 1
    return created


def download_report(reference: date) -> bytes | None:
    template = os.environ.get("B3_PRICE_REPORT_URL_TEMPLATE", DEFAULT_TEMPLATE)
    url = template.format(date=reference.strftime("%y%m%d"), date8=reference.strftime("%Y%m%d"))
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    opener.addheaders = [("User-Agent", USER_AGENT), ("Accept", "application/zip,application/octet-stream,*/*"), ("Referer", PAGE), ("Accept-Language", "pt-BR,pt;q=0.9")]
    try:
        try:
            opener.open(PAGE, timeout=20).read(1)
        except Exception:
            pass
        payload = opener.open(url, timeout=60).read()
        return payload if len(payload) > 100 and zipfile.is_zipfile(io.BytesIO(payload)) else None
    except Exception as error:
        print(f"B3 BVBG.186 unavailable for {reference}: {type(error).__name__}")
        return None


def download_simplified_session(reference: date, work: Path, universe: dict[str, dict]) -> int:
    payload = download_report(reference)
    return materialize(payload, work, universe) if payload else 0
