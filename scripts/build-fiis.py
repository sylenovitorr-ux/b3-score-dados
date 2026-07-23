#!/usr/bin/env python3
"""Create the FII snapshot from official B3 COTAHIST and CVM reports.

Usage: python3 scripts/build-fiis.py /path/to/downloads

Expected files: COTAHIST_D<DDMMYYYY>.ZIP (at least two sessions),
inf_mensal_fii_<ANO>.zip e inf_trimestral_fii_<ANO>.zip. Missing fields remain null.
"""

from __future__ import annotations

import csv
import io
import json
import math
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/b3-fii")


def number(value):
    if value in (None, ""):
        return None
    try:
        result = float(str(value).replace(",", "."))
        return result if math.isfinite(result) else None
    except ValueError:
        return None


def csv_rows(zip_path: Path, member_contains: str):
    with zipfile.ZipFile(zip_path) as archive:
        member = next(name for name in archive.namelist() if member_contains in name)
        payload = archive.read(member)
    for encoding in ("utf-8-sig", "latin1"):
        try:
            text = payload.decode(encoding)
            yield from csv.DictReader(io.StringIO(text), delimiter=";")
            return
        except UnicodeDecodeError:
            continue


def latest_rows(source_rows):
    result = {}
    for row in source_rows:
        cnpj = row.get("CNPJ_Fundo_Classe")
        key = (row.get("Data_Referencia", ""), int(row.get("Versao") or 0))
        if cnpj and key > result.get(cnpj, {}).get("_key", ("", -1)):
            result[cnpj] = {**row, "_key": key}
    return result


def cotahist(path: Path):
    result = {}
    with zipfile.ZipFile(path) as archive:
        text = archive.read(archive.namelist()[0]).decode("latin1")
    for line in text.splitlines():
        if len(line) < 245 or line[:2] != "01" or line[10:12] != "12" or line[24:27] != "010":
            continue
        ticker = line[12:24].strip()
        if not re.fullmatch(r"[A-Z0-9]{4,12}", ticker):
            continue
        result[ticker] = {
            "ticker": ticker,
            "name": line[27:39].strip().replace("FII ", "").title(),
            "isin": line[230:242].strip(),
            "date": f"{line[2:6]}-{line[6:8]}-{line[8:10]}",
            "priceopen": int(line[56:69]) / 100,
            "high": int(line[69:82]) / 100,
            "low": int(line[82:95]) / 100,
            "price": int(line[108:121]) / 100,
            "trades": int(line[147:152]),
            "quantity": int(line[152:170]),
            "volume": int(line[170:188]) / 100,
        }
    return result


def average(values, weights=None):
    pairs = [(value, 1 if weights is None else weights[index]) for index, value in enumerate(values) if value is not None]
    total_weight = sum(weight for _, weight in pairs)
    return sum(value * weight for value, weight in pairs) / total_weight if total_weight else None


def score_high(value, bands):
    if value is None:
        return None
    for minimum, points in bands:
        if value >= minimum:
            return points
    return bands[-1][1]


def score_low(value, bands):
    if value is None:
        return None
    for maximum, points in bands:
        if value <= maximum:
            return points
    return bands[-1][1]


def rounded_average(values):
    available = [value for value in values if value is not None]
    return round(sum(available) / len(available)) if available else None


# Use the two most recent B3 sessions found in the source folder.
sessions = []
for path in SOURCE.glob("COTAHIST_D*.ZIP"):
    rows = cotahist(path)
    if rows:
        sessions.append((max(row["date"] for row in rows.values()), rows))
sessions.sort(key=lambda item: item[0], reverse=True)
if not sessions:
    raise SystemExit("No valid B3 COTAHIST session found")
current_date, current = sessions[0]
previous = sessions[1][1] if len(sessions) > 1 else {}

monthly_files = sorted(SOURCE.glob("inf_mensal_fii_*.zip"))
monthly_general_rows = []
monthly_complement_rows = []
monthly_assets_rows = []
for path in monthly_files:
    monthly_general_rows.extend(csv_rows(path, "_geral_"))
    monthly_complement_rows.extend(csv_rows(path, "_complemento_"))
    monthly_assets_rows.extend(csv_rows(path, "_ativo_passivo_"))

latest_general = latest_rows(monthly_general_rows)
latest_complement = latest_rows(monthly_complement_rows)
latest_assets = latest_rows(monthly_assets_rows)

# ISIN is the safest public key connecting B3 ticker and CVM fund class.
cnpj_by_isin = {}
for cnpj, row in latest_general.items():
    isin = (row.get("Codigo_ISIN") or "").strip()
    if isin:
        cnpj_by_isin[isin] = cnpj

monthly_dy = defaultdict(dict)
for row in monthly_complement_rows:
    cnpj = row.get("CNPJ_Fundo_Classe")
    date = row.get("Data_Referencia")
    value = number(row.get("Percentual_Dividend_Yield_Mes"))
    if cnpj and date and value is not None:
        key = (date, int(row.get("Versao") or 0))
        old = monthly_dy[cnpj].get(date)
        if not old or key > old[0]:
            monthly_dy[cnpj][date] = (key, value * 100)

quarter_files = sorted(SOURCE.glob("inf_trimestral_fii_*.zip"))
if not quarter_files:
    raise SystemExit("No CVM quarterly FII file found")
quarter_path = quarter_files[-1]
quarter_general = latest_rows(csv_rows(quarter_path, "_geral_"))
quarter_properties = list(csv_rows(quarter_path, "_imovel_"))
quarter_tenants = list(csv_rows(quarter_path, "_inquilino_"))

property_stats = defaultdict(lambda: {"count": 0, "vacancy": [], "vacancy_weights": [], "default": [], "default_weights": []})
for row in quarter_properties:
    cnpj = row.get("CNPJ_Fundo_Classe")
    latest = quarter_general.get(cnpj)
    if not latest or (row.get("Data_Referencia", ""), int(row.get("Versao") or 0)) != latest["_key"]:
        continue
    stat = property_stats[cnpj]
    stat["count"] += 1
    weight = number(row.get("Percentual_Receitas_FII")) or 1
    vacancy = number(row.get("Percentual_Vacancia"))
    default = number(row.get("Percentual_Inadimplencia"))
    if vacancy is not None:
        stat["vacancy"].append(vacancy * 100); stat["vacancy_weights"].append(weight)
    if default is not None:
        stat["default"].append(default * 100); stat["default_weights"].append(weight)

tenant_concentration = defaultdict(list)
for row in quarter_tenants:
    cnpj = row.get("CNPJ_Fundo_Classe")
    latest = quarter_general.get(cnpj)
    if not latest or (row.get("Data_Referencia", ""), int(row.get("Versao") or 0)) != latest["_key"]:
        continue
    share = number(row.get("Percentual_Receitas_FII"))
    if share is not None:
        tenant_concentration[cnpj].append(share * 100)

output = []
for ticker, quote in sorted(current.items()):
    cnpj = cnpj_by_isin.get(quote["isin"])
    general = latest_general.get(cnpj, {})
    complement = latest_complement.get(cnpj, {})
    assets = latest_assets.get(cnpj, {})
    quarter = quarter_general.get(cnpj, {})
    prior_price = previous.get(ticker, {}).get("price")
    change = quote["price"] - prior_price if prior_price else None
    change_pct = (change / prior_price * 100) if change is not None and prior_price else None
    nav = number(complement.get("Patrimonio_Liquido"))
    quota_count = number(complement.get("Cotas_Emitidas")) or number(general.get("Quantidade_Cotas_Emitidas"))
    nav_per_share = number(complement.get("Valor_Patrimonial_Cotas")) or (nav / quota_count if nav and quota_count else None)
    pb = quote["price"] / nav_per_share if nav_per_share else None
    dy_history = sorted((date, item[1]) for date, item in monthly_dy.get(cnpj, {}).items())[-12:]
    dy12 = sum(value for _, value in dy_history) if dy_history else None
    dy_month = dy_history[-1][1] if dy_history else None
    total_assets = number(complement.get("Valor_Ativo"))
    total_liabilities = number(assets.get("Total_Passivo"))
    leverage = total_liabilities / nav * 100 if total_liabilities is not None and nav else None
    stats = property_stats.get(cnpj, {})
    vacancy = average(stats.get("vacancy", []), stats.get("vacancy_weights", []))
    default_rate = average(stats.get("default", []), stats.get("default_weights", []))
    properties = stats.get("count") or None
    max_tenant = max(tenant_concentration.get(cnpj, []), default=None)

    if pb is None:
        price_score = None
    elif pb < .55:
        price_score = 45
    elif pb <= .8:
        price_score = 88
    elif pb <= 1:
        price_score = 82
    elif pb <= 1.15:
        price_score = 68
    elif pb <= 1.35:
        price_score = 48
    else:
        price_score = 28
    income_score = score_high(dy12, [(12, 94), (10, 84), (8, 72), (6, 58), (4, 42), (-1e9, 25)])
    quality_score = rounded_average([
        score_low(vacancy, [(3, 94), (7, 82), (12, 66), (20, 45), (1e9, 25)]),
        score_high(properties, [(15, 92), (8, 80), (4, 65), (2, 52), (-1e9, 38)]),
        score_low(max_tenant, [(10, 92), (20, 78), (35, 60), (50, 42), (1e9, 25)]),
    ])
    risk_score = rounded_average([
        score_low(leverage, [(5, 94), (15, 82), (30, 65), (50, 45), (1e9, 22)]),
        score_low(default_rate, [(2, 92), (5, 78), (10, 60), (20, 40), (1e9, 22)]),
    ])
    liquidity_score = score_high(quote["volume"], [(10e6, 95), (3e6, 84), (1e6, 72), (300e3, 58), (50e3, 42), (-1, 25)])
    categories = [price_score, income_score, quality_score, risk_score, liquidity_score]
    overall = rounded_average(categories) or 50
    confidence = round(sum(value is not None for value in [pb, dy12, vacancy, properties, max_tenant, leverage, default_rate, quote["volume"]]) / 8 * 100)

    output.append({
        **quote,
        "kind": "fii",
        "closeyest": prior_price,
        "change": change,
        "changepct": change_pct,
        "fund": {
            "cnpj": cnpj,
            "name": general.get("Nome_Fundo_Classe") or quote["name"],
            "segment": general.get("Segmento_Atuacao") or quarter.get("Segmento_Atuacao") or None,
            "mandate": general.get("Mandato") or None,
            "managementType": general.get("Tipo_Gestao") or None,
            "targetAudience": general.get("Publico_Alvo") or None,
            "administrator": general.get("Nome_Administrador") or None,
            "referenceDate": general.get("Data_Referencia") or None,
            "deliveryDate": general.get("Data_Entrega") or None,
            "quarterDate": quarter.get("Data_Referencia") or None,
            "netAssets": nav,
            "totalAssets": total_assets,
            "quotaCount": quota_count,
            "navPerShare": nav_per_share,
            "holders": number(complement.get("Total_Numero_Cotistas")),
            "pb": pb,
            "dyMonth": dy_month,
            "dy12": dy12,
            "dyMonthsAvailable": len(dy_history),
            "totalLiabilities": total_liabilities,
            "leverage": leverage,
            "properties": properties,
            "vacancy": vacancy,
            "defaultRate": default_rate,
            "maxTenantConcentration": max_tenant,
            "portfolio": {
                "realEstate": number(assets.get("Direitos_Bens_Imoveis")),
                "cri": number(assets.get("CRI")) or number(assets.get("CRI_CRA")),
                "otherFiis": number(assets.get("FII")),
                "cash": sum(number(assets.get(key)) or 0 for key in ("Disponibilidades", "Titulos_Publicos", "Fundos_Renda_Fixa")),
            },
            "scores": {"price": price_score, "income": income_score, "quality": quality_score, "risk": risk_score, "liquidity": liquidity_score, "overall": overall, "confidence": confidence},
        },
    })

target = ROOT / "data/fii-catalog.json"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

covered = sum(bool(row["fund"]["cnpj"]) for row in output)
print(f"Generated {len(output)} FIIs from B3 close {current_date}; {covered} linked to CVM.")
