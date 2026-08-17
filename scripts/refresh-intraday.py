"""Atualiza uma fotografia intradiária somente a partir de fonte configurada.

O endpoint é fornecido por segredo do GitHub Actions e deve retornar JSON com:
source, updatedAt, delayMinutes e quotes[{ticker, price, changePct?, volume?, asOf?}].
Falhas ou campos inválidos não sobrescrevem o último arquivo válido.
"""
import json
import os
import sys
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "intraday.json"

def numeric(value):
    try:
        value = float(value)
        return value if value == value and value not in (float("inf"), float("-inf")) else None
    except (TypeError, ValueError):
        return None

def normalize(payload):
    rows = []
    for row in payload.get("quotes", []):
        ticker = str(row.get("ticker") or "").strip().upper()
        price = numeric(row.get("price"))
        if ticker and price is not None and price > 0:
            rows.append({"ticker": ticker, "price": price, "changePct": numeric(row.get("changePct")), "volume": numeric(row.get("volume")), "asOf": row.get("asOf")})
    if not rows:
        raise ValueError("A fonte não forneceu nenhuma cotação válida.")
    return {"status": "ATUALIZADO", "generatedAt": datetime.now(UTC).isoformat(), "updatedAt": payload.get("updatedAt") or datetime.now(UTC).isoformat(), "delayMinutes": numeric(payload.get("delayMinutes")), "source": str(payload.get("source") or "Fonte intradiária configurada"), "quotes": rows}

def main():
    url = os.environ.get("INTRADAY_SOURCE_URL")
    if not url:
        print("INTRADAY_SOURCE_URL ausente: mantendo última fotografia válida.")
        return 0
    request = urllib.request.Request(url, headers={"User-Agent": "B3ScoreIntraday/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    data = normalize(payload)
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{len(data['quotes'])} cotações intradiárias válidas.")

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Falha intradiária: {error}", file=sys.stderr)
        raise
