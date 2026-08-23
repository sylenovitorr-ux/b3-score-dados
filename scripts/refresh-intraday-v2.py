"""Atualiza fotografia intradiária e, opcionalmente, livro de ofertas L2.

Fontes:
- INTRADAY_SOURCE_URL: endpoint JSON próprio/autorizado no formato B3 Score.
- Sem INTRADAY_SOURCE_URL, usa brapi.dev como fonte atrasada. O endpoint público
  /api/quote/list é tentado sem token; BRAPI_TOKEN é usado quando configurado.
- BOOK_SOURCE_URL: endpoint L2 autorizado. Nunca é simulado quando ausente.

Saída: data/intraday.json
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "intraday.json"
BRAPI_LIST_URL = "https://brapi.dev/api/quote/list?limit=9999"
MARKET_TIMEZONE = ZoneInfo("America/Sao_Paulo")


def numeric(value):
    try:
        value = float(value)
        return value if value == value and value not in (float("inf"), float("-inf")) else None
    except (TypeError, ValueError):
        return None


def fetch_json(url, user_agent="B3ScoreIntraday/2.4", bearer_token=None):
    headers = {"User-Agent": user_agent, "Accept": "application/json"}
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=40) as response:
        return json.load(response)


def normalize_book_row(row):
    ticker = str(row.get("ticker") or row.get("symbol") or row.get("stock") or "").strip().upper()
    if not ticker:
        return None
    book = {
        "bestBid": numeric(row.get("bestBid") or row.get("bid")),
        "bestAsk": numeric(row.get("bestAsk") or row.get("ask")),
        "bidVolume": numeric(row.get("bidVolume") or row.get("totalBidVolume") or row.get("buyVolume")),
        "askVolume": numeric(row.get("askVolume") or row.get("totalAskVolume") or row.get("sellVolume")),
        "pressure": numeric(row.get("pressure") or row.get("imbalance") or row.get("bookPressure")),
        "support": numeric(row.get("support")),
        "resistance": numeric(row.get("resistance")),
        "asOf": row.get("asOf") or row.get("updatedAt"),
        "source": row.get("source"),
    }
    if all(book[key] is None for key in ("bestBid", "bestAsk", "bidVolume", "askVolume", "pressure")):
        return None
    return ticker, book


def fetch_books():
    url = os.environ.get("BOOK_SOURCE_URL")
    if not url:
        return {}, None
    payload = fetch_json(url, "B3ScoreOrderBook/1.0")
    rows = payload.get("books") or payload.get("orderbooks") or payload.get("quotes") or []
    books = {}
    for row in rows:
        normalized = normalize_book_row(row)
        if normalized:
            ticker, book = normalized
            books[ticker] = book
    if not books:
        raise ValueError("BOOK_SOURCE_URL não forneceu nenhum livro L2 válido.")
    return books, str(payload.get("source") or "Fonte L2 configurada")


def normalize_native(payload, books):
    rows = []
    for row in payload.get("quotes", []):
        ticker = str(row.get("ticker") or "").strip().upper()
        price = numeric(row.get("price"))
        if ticker and price is not None and price > 0:
            rows.append({"ticker": ticker, "price": price, "changePct": numeric(row.get("changePct")), "volume": numeric(row.get("volume")), "asOf": row.get("asOf"), "book": books.get(ticker)})
    if not rows:
        raise ValueError("A fonte não forneceu nenhuma cotação válida.")
    return {"status": "ATUALIZADO", "generatedAt": datetime.now(UTC).isoformat(), "updatedAt": payload.get("updatedAt") or datetime.now(UTC).isoformat(), "delayMinutes": numeric(payload.get("delayMinutes")), "source": str(payload.get("source") or "Fonte intradiária configurada"), "quotes": rows}


def normalize_brapi(payload, books, authenticated=False):
    requested_at = payload.get("requestedAt") or datetime.now(UTC).isoformat()
    rows = []
    for row in payload.get("stocks", []):
        ticker = str(row.get("stock") or "").strip().upper()
        price = numeric(row.get("close"))
        if ticker and price is not None and price > 0:
            rows.append({"ticker": ticker, "price": price, "changePct": numeric(row.get("change")), "volume": numeric(row.get("volume")), "asOf": requested_at, "book": books.get(ticker)})
    if not rows:
        raise ValueError("brapi.dev não forneceu cotações válidas.")
    source = "brapi.dev autenticada (cotação atrasada)" if authenticated else "brapi.dev pública (cotação atrasada)"
    return {"status": "ATUALIZADO", "generatedAt": datetime.now(UTC).isoformat(), "updatedAt": requested_at, "delayMinutes": 30, "source": source, "quotes": rows}


def market_day(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(MARKET_TIMEZONE).date().isoformat()
    except ValueError:
        return None


def merge_intraday_series(data, previous):
    previous_quotes = {str(row.get("ticker") or "").upper(): row for row in (previous or {}).get("quotes", [])}
    for quote in data.get("quotes", []):
        as_of = quote.get("asOf") or data.get("updatedAt")
        day = market_day(as_of)
        old = previous_quotes.get(quote["ticker"], {})
        series = [row for row in old.get("series", []) if market_day(row.get("asOf")) == day]
        point = {"asOf": as_of, "price": quote.get("price"), "volume": quote.get("volume")}
        by_time = {row.get("asOf"): row for row in [*series, point] if row.get("asOf") and numeric(row.get("price")) is not None}
        quote["series"] = sorted(by_time.values(), key=lambda row: row["asOf"])[-150:]
    return data


def main():
    try:
        previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        previous = {}
    books, book_source = fetch_books()
    intraday_url = os.environ.get("INTRADAY_SOURCE_URL")
    brapi_token = (os.environ.get("BRAPI_TOKEN") or "").strip()
    if intraday_url:
        payload = fetch_json(intraday_url)
        data = normalize_native(payload, books)
    else:
        try:
            payload = fetch_json(BRAPI_LIST_URL, "B3ScoreIntraday/2.4", brapi_token or None)
        except urllib.error.HTTPError as error:
            if error.code in (401, 403) and brapi_token:
                raise RuntimeError("BRAPI_TOKEN configurado, mas foi recusado pelo endpoint /api/quote/list.") from error
            if error.code in (401, 403):
                raise RuntimeError("Endpoint público /api/quote/list recusou a chamada sem token.") from error
            raise
        data = normalize_brapi(payload, books, authenticated=bool(brapi_token))
    data["bookSource"] = book_source
    data["bookStatus"] = "ATUALIZADO" if books else "INDISPONIVEL_SEM_FONTE_L2"
    data = merge_intraday_series(data, previous)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(data['quotes'])} cotações válidas; {len(books)} books L2 válidos.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Falha intradiária/L2: {error}", file=sys.stderr)
        raise
