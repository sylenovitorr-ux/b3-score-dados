#!/usr/bin/env python3
"""Build the static B3 + CVM fundamentals snapshot used by the PWA.

Inputs are the official B3 close catalog already in the project and the annual
DFP/current ITR/FCA bulk files published by CVM. Missing facts stay null.
"""

from __future__ import annotations

import csv
import io
import json
import math
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CVM = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/cvm-data")
DFP_YEAR = int(sys.argv[2]) if len(sys.argv) > 2 else 2025
ITR_YEAR = int(sys.argv[3]) if len(sys.argv) > 3 else 2026
FCA_YEAR = int(sys.argv[4]) if len(sys.argv) > 4 else 2026


def rows(zip_name: str, member: str):
    with zipfile.ZipFile(CVM / zip_name) as archive:
        with archive.open(member) as raw:
            yield from csv.DictReader(io.TextIOWrapper(raw, encoding="latin1"), delimiter=";")


def num(value):
    if value in (None, ""):
        return None
    try:
        result = float(str(value).replace(",", "."))
        return result if math.isfinite(result) else None
    except ValueError:
        return None


def money_value(row):
    value = num(row.get("VL_CONTA"))
    if value is None:
        return None
    return value * (1000 if row.get("ESCALA_MOEDA") == "MIL" else 1)


def latest_documents(source):
    latest = {}
    for row in source:
        cnpj = row.get("CNPJ_CIA")
        key = (row.get("DT_REFER", ""), int(row.get("VERSAO") or 0))
        if cnpj and key > latest.get(cnpj, ("", -1)):
            latest[cnpj] = key
    return latest


def statements(zip_name, member, document_keys):
    data = defaultdict(lambda: {"current": {}, "previous": {}})
    for row in rows(zip_name, member):
        cnpj = row.get("CNPJ_CIA")
        if not cnpj or (row.get("DT_REFER", ""), int(row.get("VERSAO") or 0)) != document_keys.get(cnpj):
            continue
        bucket = "current" if row.get("ORDEM_EXERC") == "ÚLTIMO" else "previous"
        code = row.get("CD_CONTA")
        value = money_value(row)
        if code and value is not None:
            data[cnpj][bucket][code] = value
    return data


def capital(zip_name, member, document_keys):
    data = {}
    for row in rows(zip_name, member):
        cnpj = row.get("CNPJ_CIA")
        if not cnpj or (row.get("DT_REFER", ""), int(row.get("VERSAO") or 0)) != document_keys.get(cnpj):
            continue
        ordinary = (num(row.get("QT_ACAO_ORDIN_CAP_INTEGR")) or 0) - (num(row.get("QT_ACAO_ORDIN_TESOURO")) or 0)
        preferred = (num(row.get("QT_ACAO_PREF_CAP_INTEGR")) or 0) - (num(row.get("QT_ACAO_PREF_TESOURO")) or 0)
        data[cnpj] = {"ordinary": ordinary, "preferred": preferred, "total": ordinary + preferred}
    return data


def account(values, *codes):
    for code in codes:
        if code in values:
            return values[code]
    return None


def safe_div(a, b, multiplier=1):
    if a is None or b in (None, 0):
        return None
    return a / b * multiplier


def ttm(code, annual, interim):
    fy = annual["current"].get(code)
    ytd = interim["current"].get(code)
    prior_ytd = interim["previous"].get(code)
    if fy is not None and ytd is not None and prior_ytd is not None:
        return fy + ytd - prior_ytd
    return fy


def score_low(value, bands):
    if value is None:
        return None
    for limit, points in bands:
        if value <= limit:
            return points
    return bands[-1][1]


def score_high(value, bands):
    if value is None:
        return None
    for limit, points in bands:
        if value >= limit:
            return points
    return bands[-1][1]


def average(values):
    valid = [value for value in values if value is not None]
    return round(sum(valid) / len(valid)) if valid else None


catalog_path = (ROOT / "data/b3-catalog.json") if (ROOT / "data").exists() else (ROOT / "app/data/b3-catalog.json")
catalog = json.loads(catalog_path.read_text())
by_ticker = {row["ticker"]: row for row in catalog}

# Latest FCA security row maps every ticker to its legal issuer.
security = {}
for row in rows(f"fca{FCA_YEAR}.zip", f"fca_cia_aberta_valor_mobiliario_{FCA_YEAR}.csv"):
    ticker = (row.get("Codigo_Negociacao") or "").strip().upper()
    if not ticker or ticker not in by_ticker or row.get("Data_Fim_Negociacao"):
        continue
    key = (row.get("Data_Referencia", ""), int(row.get("Versao") or 0))
    if key > security.get(ticker, {}).get("_key", ("", -1)):
        security[ticker] = {**row, "_key": key}

fca_docs = list(rows(f"fca{FCA_YEAR}.zip", f"fca_cia_aberta_{FCA_YEAR}.csv"))
cvm_codes = {}
for row in fca_docs:
    cnpj = row.get("CNPJ_CIA")
    key = (row.get("DT_REFER", ""), int(row.get("VERSAO") or 0))
    if cnpj and key >= cvm_codes.get(cnpj, (("", -1), ""))[0]:
        cvm_codes[cnpj] = (key, row.get("CD_CVM", ""))

dfp_index = latest_documents(rows(f"dfp{DFP_YEAR}.zip", f"dfp_cia_aberta_{DFP_YEAR}.csv"))
itr_index = latest_documents(rows(f"itr{ITR_YEAR}.zip", f"itr_cia_aberta_{ITR_YEAR}.csv"))

dfp_dre = statements(f"dfp{DFP_YEAR}.zip", f"dfp_cia_aberta_DRE_con_{DFP_YEAR}.csv", dfp_index)
dfp_bpa = statements(f"dfp{DFP_YEAR}.zip", f"dfp_cia_aberta_BPA_con_{DFP_YEAR}.csv", dfp_index)
dfp_bpp = statements(f"dfp{DFP_YEAR}.zip", f"dfp_cia_aberta_BPP_con_{DFP_YEAR}.csv", dfp_index)
itr_dre = statements(f"itr{ITR_YEAR}.zip", f"itr_cia_aberta_DRE_con_{ITR_YEAR}.csv", itr_index)
itr_bpa = statements(f"itr{ITR_YEAR}.zip", f"itr_cia_aberta_BPA_con_{ITR_YEAR}.csv", itr_index)
itr_bpp = statements(f"itr{ITR_YEAR}.zip", f"itr_cia_aberta_BPP_con_{ITR_YEAR}.csv", itr_index)

dfp_cap = capital(f"dfp{DFP_YEAR}.zip", f"dfp_cia_aberta_composicao_capital_{DFP_YEAR}.csv", dfp_index)
itr_cap = capital(f"itr{ITR_YEAR}.zip", f"itr_cia_aberta_composicao_capital_{ITR_YEAR}.csv", itr_index)

tickers_by_company = defaultdict(list)
for ticker, row in security.items():
    tickers_by_company[row["CNPJ_Companhia"]].append(ticker)

financial_roots = {"ABCB", "BBAS", "BBDC", "BEES", "BMGB", "BMIN", "BPAC", "BRSR", "BSLI", "ITUB", "MERC", "PINE", "SANB"}

company_fundamentals = {}
for cnpj, company_tickers in tickers_by_company.items():
    annual_dre = dfp_dre.get(cnpj, {"current": {}, "previous": {}})
    interim_dre = itr_dre.get(cnpj, {"current": {}, "previous": {}})
    latest_bpa = itr_bpa.get(cnpj) or dfp_bpa.get(cnpj) or {"current": {}, "previous": {}}
    latest_bpp = itr_bpp.get(cnpj) or dfp_bpp.get(cnpj) or {"current": {}, "previous": {}}
    cap = itr_cap.get(cnpj) or dfp_cap.get(cnpj) or {"ordinary": 0, "preferred": 0, "total": 0}

    revenue = ttm("3.01", annual_dre, interim_dre)
    gross_profit = ttm("3.03", annual_dre, interim_dre)
    ebit = ttm("3.05", annual_dre, interim_dre)
    net_income = ttm("3.11.01", annual_dre, interim_dre)
    if net_income is None:
        net_income = ttm("3.11", annual_dre, interim_dre)
    if net_income is None:
        net_income = ttm("3.09", annual_dre, interim_dre)

    bpa = latest_bpa["current"]
    bpp = latest_bpp["current"]
    root = company_tickers[0][:4]
    is_financial = root in financial_roots or any(word in security[company_tickers[0]].get("Nome_Empresarial", "").upper() for word in ("BANCO", "FINANCEIRA"))
    equity_total = account(bpp, "2.08", "2.07", "2.03") if is_financial else account(bpp, "2.03")
    minority = account(bpp, "2.03.09") or 0
    equity = equity_total - minority if equity_total is not None else None
    assets = account(bpa, "1")
    current_assets = account(bpa, "1.01")
    current_liabilities = account(bpp, "2.01")
    cash = account(bpa, "1.01.01") or 0
    investments = account(bpa, "1.01.02") or 0
    short_debt = account(bpp, "2.01.04") or 0
    long_debt = account(bpp, "2.02.01") or 0
    gross_debt = short_debt + long_debt
    net_debt = gross_debt - cash - investments

    # Value the legal issuer by share class. If only one class trades, use its
    # quote as a transparent proxy for the unquoted class.
    ordinary_prices = [by_ticker[t]["price"] for t in company_tickers if t.endswith("3") and by_ticker[t].get("price")]
    preferred_prices = [by_ticker[t]["price"] for t in company_tickers if t[-1:] in {"4", "5", "6", "7", "8"} and by_ticker[t].get("price")]
    proxy_price = (ordinary_prices or preferred_prices or [None])[0]
    ordinary_price = (ordinary_prices or [proxy_price])[0]
    preferred_price = (preferred_prices or [proxy_price])[0]
    market_cap = None
    market_cap_estimated = False
    if cap["total"] > 0 and proxy_price:
        # Some issuers fill the CVM share-composition table in thousands even
        # though the field has no scale column. Detect that only when the
        # implied book value is implausibly large compared with the quote.
        while equity and ((equity / cap["total"]) / proxy_price) > 50:
            cap = {key: value * 1000 for key, value in cap.items()}
        market_cap = cap["ordinary"] * ordinary_price + cap["preferred"] * preferred_price
        market_cap_estimated = (cap["ordinary"] > 0 and not ordinary_prices) or (cap["preferred"] > 0 and not preferred_prices)

    pe = safe_div(market_cap, net_income)
    pb = safe_div(market_cap, equity)
    roe = safe_div(net_income, equity, 100)
    roa = safe_div(net_income, assets, 100)
    gross_margin = safe_div(gross_profit, revenue, 100)
    ebit_margin = safe_div(ebit, revenue, 100)
    net_margin = safe_div(net_income, revenue, 100)
    net_debt_ebit = safe_div(net_debt, ebit)
    current_ratio = safe_div(current_assets, current_liabilities)
    ev_ebit = safe_div((market_cap + net_debt) if market_cap is not None else None, ebit)
    eps = safe_div(net_income, cap["total"])
    bvps = safe_div(equity, cap["total"])
    prior_revenue = annual_dre["previous"].get("3.01")
    prior_profit = annual_dre["previous"].get("3.11.01") or annual_dre["previous"].get("3.11") or annual_dre["previous"].get("3.09")
    revenue_growth = ((annual_dre["current"].get("3.01") / prior_revenue - 1) * 100) if prior_revenue else None
    current_profit = annual_dre["current"].get("3.11.01") or annual_dre["current"].get("3.11") or annual_dre["current"].get("3.09")
    profit_growth = ((current_profit / prior_profit - 1) * 100) if current_profit is not None and prior_profit and prior_profit > 0 else None

    price_score = average([
        score_low(pe if pe and pe > 0 else None, [(6, 95), (10, 85), (15, 70), (22, 55), (35, 35), (10**9, 20)]),
        score_low(pb if pb and pb > 0 else None, [(1, 92), (2, 76), (3, 62), (5, 42), (10**9, 22)]),
        None if is_financial else score_low(ev_ebit if ev_ebit and ev_ebit > 0 else None, [(6, 92), (10, 78), (15, 60), (25, 40), (10**9, 20)]),
    ])
    quality_score = average([
        score_high(roe, [(25, 95), (18, 85), (12, 70), (8, 55), (-10**9, 25)]),
        score_high(roa, [(12, 92), (8, 80), (5, 65), (2, 50), (-10**9, 25)]),
        None if is_financial else score_high(net_margin, [(20, 92), (12, 78), (7, 65), (3, 50), (-10**9, 25)]),
    ])
    debt_score = None if is_financial else average([
        score_low(net_debt_ebit, [(0, 96), (1, 85), (2, 72), (3, 56), (4, 40), (10**9, 20)]),
        score_high(current_ratio, [(1.5, 88), (1, 68), (.7, 48), (-10**9, 25)]),
    ])
    growth_score = average([
        score_high(revenue_growth, [(20, 92), (10, 78), (3, 64), (0, 52), (-10, 35), (-10**9, 18)]),
        score_high(profit_growth, [(20, 92), (10, 78), (3, 64), (0, 52), (-10, 35), (-10**9, 18)]),
    ])
    dividend_score = None  # proventos require a separate event-normalisation pipeline
    categories = [price_score, quality_score, debt_score, growth_score, dividend_score]
    overall = average(categories) or 50
    expected = 9 if is_financial else 11
    available_count = sum(value is not None for value in [pe, pb, None if is_financial else ev_ebit, roe, roa, None if is_financial else net_margin, None if is_financial else net_debt_ebit, None if is_financial else current_ratio, revenue_growth, profit_growth, None])

    issuer = security[company_tickers[0]]
    company_fundamentals[cnpj] = {
        "cnpj": cnpj,
        "cvmCode": cvm_codes.get(cnpj, (None, ""))[1],
        "companyName": issuer.get("Nome_Empresarial"),
        "segment": issuer.get("Segmento") or None,
        "referenceDate": (itr_index.get(cnpj) or dfp_index.get(cnpj) or (None,))[0],
        "filingType": "ITR + DFP (12 meses)" if cnpj in itr_dre else "DFP anual",
        "periodLabel": "12 meses até a última ITR" if cnpj in itr_dre else f"exercício de {DFP_YEAR}",
        "marketCapEstimated": market_cap_estimated,
        "financialCompany": is_financial,
        "revenueTTM": revenue, "grossProfitTTM": gross_profit, "ebitTTM": ebit, "netIncomeTTM": net_income,
        "equity": equity, "assets": assets, "grossDebt": gross_debt, "cashAndInvestments": cash + investments, "netDebt": net_debt,
        "marketCap": market_cap, "pe": pe, "pb": pb, "roe": roe, "roa": roa,
        "grossMargin": gross_margin, "ebitMargin": ebit_margin, "netMargin": net_margin,
        "netDebtEbit": net_debt_ebit, "currentRatio": current_ratio, "evEbit": ev_ebit,
        "eps": eps, "bookValuePerShare": bvps, "revenueGrowth": revenue_growth, "profitGrowth": profit_growth,
        "dividendYield": None,
        "scores": {"price": price_score, "quality": quality_score, "debt": debt_score, "growth": growth_score, "dividends": dividend_score, "overall": overall, "confidence": round(available_count / expected * 100)},
    }

result = []
for asset in catalog:
    ticker = asset["ticker"]
    sec = security.get(ticker)
    fundamental = company_fundamentals.get(sec["CNPJ_Companhia"]) if sec else None
    enriched = {**asset}
    if sec:
        enriched.update({"securityType": sec.get("Valor_Mobiliario"), "unitComposition": sec.get("Composicao_BDR_Unit") or None})
    if fundamental:
        enriched["fundamentals"] = fundamental
        enriched["marketcap"] = fundamental["marketCap"]
        enriched["pe"] = fundamental["pe"]
        enriched["eps"] = fundamental["eps"]
    result.append(enriched)

paths = [ROOT / "data/b3-fundamentals.json"] if (ROOT / "data").exists() else [ROOT / "app/data/b3-fundamentals.json", ROOT / "public/b3-fundamentals.json"]
for path in paths:
    path.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")))

covered = sum("fundamentals" in row for row in result)
print(f"Generated {len(result)} assets; {covered} with CVM fundamentals; {len(company_fundamentals)} issuers.")
