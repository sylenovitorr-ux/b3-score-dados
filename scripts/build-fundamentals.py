#!/usr/bin/env python3
"""Build the static B3 + CVM fundamentals snapshot used by the PWA.

Inputs are the official B3 close catalog already in the project and the annual
DFP/current ITR/FCA bulk files published by CVM. Missing facts stay null.
"""

from __future__ import annotations

import csv
import copy
import io
import json
import math
import re
import sys
import unicodedata
import zipfile
from collections import defaultdict
from datetime import date
from pathlib import Path

from accounting_engine import (
    calculate_ttm,
    growth_analysis,
    is_financial_company,
    isolate_quarters,
    latest_annual_pair,
    period_days,
    reconcile_balance,
    select_statement_scope,
)
from dividend_engine import calculate_ticker_dividends

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


def normalize_label(value):
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii").lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


def store_statement_row(bucket, row, code, value, scope="consolidated"):
    bucket[code] = value
    bucket.setdefault("_rows", []).append({
        "code": code,
        "name": row.get("DS_CONTA") or "",
        "label": normalize_label(row.get("DS_CONTA")),
        "value": value,
        "startDate": row.get("DT_INI_EXERC") or None,
        "endDate": row.get("DT_FIM_EXERC") or row.get("DT_REFER") or None,
    })
    bucket.setdefault("_meta", {
        "startDate": row.get("DT_INI_EXERC") or None,
        "endDate": row.get("DT_FIM_EXERC") or row.get("DT_REFER") or None,
        "referenceDate": row.get("DT_REFER") or None,
        "version": int(row.get("VERSAO") or 0),
        "scope": scope,
        "order": row.get("ORDEM_EXERC") or None,
    })


def latest_documents(source):
    latest = {}
    for row in source:
        cnpj = row.get("CNPJ_CIA")
        key = (row.get("DT_REFER", ""), int(row.get("VERSAO") or 0))
        if cnpj and key > latest.get(cnpj, ("", -1)):
            latest[cnpj] = key
    return latest


def statements(zip_name, member, document_keys, scope="consolidated"):
    periods = defaultdict(lambda: {"current": defaultdict(dict), "previous": defaultdict(dict)})
    for row in rows(zip_name, member):
        cnpj = row.get("CNPJ_CIA")
        if not cnpj or (row.get("DT_REFER", ""), int(row.get("VERSAO") or 0)) != document_keys.get(cnpj):
            continue
        bucket = "current" if row.get("ORDEM_EXERC") == "ÚLTIMO" else "previous"
        period_key = (
            row.get("DT_INI_EXERC") or "",
            row.get("DT_FIM_EXERC") or row.get("DT_REFER") or "",
        )
        code = row.get("CD_CONTA")
        value = money_value(row)
        if code and value is not None:
            store_statement_row(periods[cnpj][bucket][period_key], row, code, value, scope)
    data = defaultdict(lambda: {"current": {}, "previous": {}})
    for cnpj, buckets in periods.items():
        for bucket, candidates in buckets.items():
            if not candidates:
                continue
            data[cnpj][bucket] = max(
                candidates.values(),
                key=lambda values: (
                    period_days(values.get("_meta")) or -1,
                    values.get("_meta", {}).get("endDate") or "",
                ),
            )
    return data


def safe_statements(zip_name, member, document_keys, scope="consolidated"):
    try:
        return statements(zip_name, member, document_keys, scope)
    except KeyError:
        return defaultdict(lambda: {"current": {}, "previous": {}})


def merge_statement_methods(primary, secondary, primary_name, secondary_name):
    """Prefer indirect DFC per issuer, retaining direct DFC when it is the only filing."""
    merged = defaultdict(lambda: {"current": {}, "previous": {}})
    methods = {}
    for cnpj in set(primary) | set(secondary):
        if primary.get(cnpj, {}).get("current"):
            merged[cnpj] = primary[cnpj]
            methods[cnpj] = primary_name
        else:
            merged[cnpj] = secondary[cnpj]
            methods[cnpj] = secondary_name
    return merged, methods


def document_index(kind):
    """Latest accepted CVM version for each issuer and reference date."""
    index = {}
    for path in sorted(CVM.glob(f"{kind}*.zip")):
        year = path.stem.removeprefix(kind)
        member = f"{kind}_cia_aberta_{year}.csv"
        try:
            source = rows(path.name, member)
            for row in source:
                cnpj = row.get("CNPJ_CIA")
                reference = row.get("DT_REFER", "")
                version = int(row.get("VERSAO") or 0)
                if cnpj and reference and version > index.get((cnpj, reference), -1):
                    index[(cnpj, reference)] = version
        except KeyError:
            continue
    return index


def annual_history(statement, document_index, scope="consolidated"):
    """Latest annual statements for one explicit CVM accounting scope."""
    history = defaultdict(dict)
    for path in sorted(CVM.glob("dfp*.zip")):
        year = path.stem.removeprefix("dfp")
        suffix = "con" if scope == "consolidated" else "ind"
        member = f"dfp_cia_aberta_{statement}_{suffix}_{year}.csv"
        try:
            source = rows(path.name, member)
            for row in source:
                cnpj = row.get("CNPJ_CIA")
                reference = row.get("DT_REFER", "")
                if not cnpj or not reference or row.get("ORDEM_EXERC") != "ÚLTIMO":
                    continue
                if int(row.get("VERSAO") or 0) != document_index.get((cnpj, reference)):
                    continue
                code = row.get("CD_CONTA")
                value = money_value(row)
                if code and value is not None:
                    store_statement_row(history[cnpj].setdefault(reference, {}), row, code, value, scope)
        except KeyError:
            continue
    return history


def document_versions(kind):
    """Audit trail of accepted and superseded CVM document versions."""
    versions = defaultdict(lambda: defaultdict(set))
    for path in sorted(CVM.glob(f"{kind}*.zip")):
        year = path.stem.removeprefix(kind)
        member = f"{kind}_cia_aberta_{year}.csv"
        try:
            for row in rows(path.name, member):
                cnpj = row.get("CNPJ_CIA")
                reference = row.get("DT_REFER")
                if cnpj and reference:
                    versions[cnpj][reference].add(int(row.get("VERSAO") or 0))
        except KeyError:
            continue
    return versions


def interim_period_history(statement, document_index, scope="consolidated"):
    """All latest-version ITR periods for one explicit accounting scope."""
    history = defaultdict(lambda: defaultdict(list))
    for path in sorted(CVM.glob("itr*.zip")):
        year = path.stem.removeprefix("itr")
        suffix = "con" if scope == "consolidated" else "ind"
        member = f"itr_cia_aberta_{statement}_{suffix}_{year}.csv"
        try:
            grouped = defaultdict(dict)
            for row in rows(path.name, member):
                cnpj = row.get("CNPJ_CIA")
                reference = row.get("DT_REFER", "")
                if not cnpj or not reference or row.get("ORDEM_EXERC") != "ÚLTIMO":
                    continue
                if int(row.get("VERSAO") or 0) != document_index.get((cnpj, reference)):
                    continue
                period_key = (row.get("DT_INI_EXERC") or "", row.get("DT_FIM_EXERC") or reference)
                code = row.get("CD_CONTA")
                value = money_value(row)
                if code and value is not None:
                    store_statement_row(grouped[(cnpj, reference)].setdefault(period_key, {}), row, code, value, scope)
            for (cnpj, reference), periods in grouped.items():
                history[cnpj][reference].extend(periods.values())
        except KeyError:
            continue
    return history


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


def semantic_account(values, phrases, excludes=()):
    """Find custom issuer accounts by description, preferring aggregate rows."""
    matches = []
    excluded = tuple(normalize_label(term) for term in excludes)
    phrase_tokens = [
        [term for term in normalize_label(phrase).split() if term not in {"a", "as", "e", "de", "da", "das", "do", "dos"}]
        for phrase in phrases
    ]
    for row in values.get("_rows", []):
        label = row["label"]
        if any(term in label for term in excluded):
            continue
        label_tokens = set(label.split())
        if any(tokens and all(term in label_tokens for term in tokens) for tokens in phrase_tokens):
            matches.append(row)
    if not matches:
        return None
    matches.sort(key=lambda row: (row["code"].count("."), len(row["label"])))
    return matches[0]["value"]


def account_or_semantic(values, codes, phrases=(), excludes=()):
    return account(values, *codes) if account(values, *codes) is not None else semantic_account(values, phrases, excludes)


def safe_div(a, b, multiplier=1):
    if a is None or b in (None, 0):
        return None
    return a / b * multiplier


def sum_known(*values):
    valid = [value for value in values if value is not None]
    return sum(valid) if valid else None


def ttm_result(code, annual, interim):
    fy = annual["current"].get(code)
    ytd = interim["current"].get(code)
    prior_ytd = interim["previous"].get(code)
    return calculate_ttm(
        fy, ytd, prior_ytd,
        annual["current"].get("_meta"),
        interim["current"].get("_meta"),
        interim["previous"].get("_meta"),
    )


def ttm(code, annual, interim):
    return ttm_result(code, annual, interim)["value"]


def ttm_semantic(codes, phrases, annual, interim, excludes=()):
    fy = account_or_semantic(annual["current"], codes, phrases, excludes)
    ytd = account_or_semantic(interim["current"], codes, phrases, excludes)
    prior_ytd = account_or_semantic(interim["previous"], codes, phrases, excludes)
    return calculate_ttm(
        fy, ytd, prior_ytd,
        annual["current"].get("_meta"),
        interim["current"].get("_meta"),
        interim["previous"].get("_meta"),
    )["value"]


def freshness_score(reference):
    try:
        age = (date.today() - date.fromisoformat(reference)).days
    except (TypeError, ValueError):
        return 0
    if age <= 150:
        return 100
    if age <= 210:
        return 90
    if age <= 300:
        return 75
    if age <= 450:
        return 55
    return 25


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


def weighted_average(items):
    """Average available evidence without turning absence into zero."""
    valid = [(value, weight) for value, weight in items if value is not None and weight > 0]
    total = sum(weight for _, weight in valid)
    return round(sum(value * weight for value, weight in valid) / total) if total else None


catalog_path = (ROOT / "data/b3-catalog.json") if (ROOT / "data").exists() else (ROOT / "app/data/b3-catalog.json")
catalog = json.loads(catalog_path.read_text())
by_ticker = {row["ticker"]: row for row in catalog}
dividend_path = CVM / "b3-dividends.json"
dividend_events_by_name = json.loads(dividend_path.read_text(encoding="utf-8")) if dividend_path.exists() else {}

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

def load_scope(scope):
    suffix = "con" if scope == "consolidated" else "ind"
    return {
        "dfp_dre": safe_statements(f"dfp{DFP_YEAR}.zip", f"dfp_cia_aberta_DRE_{suffix}_{DFP_YEAR}.csv", dfp_index, scope),
        "dfp_bpa": safe_statements(f"dfp{DFP_YEAR}.zip", f"dfp_cia_aberta_BPA_{suffix}_{DFP_YEAR}.csv", dfp_index, scope),
        "dfp_bpp": safe_statements(f"dfp{DFP_YEAR}.zip", f"dfp_cia_aberta_BPP_{suffix}_{DFP_YEAR}.csv", dfp_index, scope),
        "itr_dre": safe_statements(f"itr{ITR_YEAR}.zip", f"itr_cia_aberta_DRE_{suffix}_{ITR_YEAR}.csv", itr_index, scope),
        "itr_bpa": safe_statements(f"itr{ITR_YEAR}.zip", f"itr_cia_aberta_BPA_{suffix}_{ITR_YEAR}.csv", itr_index, scope),
        "itr_bpp": safe_statements(f"itr{ITR_YEAR}.zip", f"itr_cia_aberta_BPP_{suffix}_{ITR_YEAR}.csv", itr_index, scope),
        "dfp_dfc_mi": safe_statements(f"dfp{DFP_YEAR}.zip", f"dfp_cia_aberta_DFC_MI_{suffix}_{DFP_YEAR}.csv", dfp_index, scope),
        "dfp_dfc_md": safe_statements(f"dfp{DFP_YEAR}.zip", f"dfp_cia_aberta_DFC_MD_{suffix}_{DFP_YEAR}.csv", dfp_index, scope),
        "itr_dfc_mi": safe_statements(f"itr{ITR_YEAR}.zip", f"itr_cia_aberta_DFC_MI_{suffix}_{ITR_YEAR}.csv", itr_index, scope),
        "itr_dfc_md": safe_statements(f"itr{ITR_YEAR}.zip", f"itr_cia_aberta_DFC_MD_{suffix}_{ITR_YEAR}.csv", itr_index, scope),
    }


scope_data = {
    "consolidated": load_scope("consolidated"),
    "individual": load_scope("individual"),
}
for scoped in scope_data.values():
    scoped["dfp_dfc"], scoped["dfp_dfc_methods"] = merge_statement_methods(
        scoped["dfp_dfc_mi"], scoped["dfp_dfc_md"], "indirect", "direct"
    )
    scoped["itr_dfc"], scoped["itr_dfc_methods"] = merge_statement_methods(
        scoped["itr_dfc_mi"], scoped["itr_dfc_md"], "indirect", "direct"
    )

dfp_cap = capital(f"dfp{DFP_YEAR}.zip", f"dfp_cia_aberta_composicao_capital_{DFP_YEAR}.csv", dfp_index)
itr_cap = capital(f"itr{ITR_YEAR}.zip", f"itr_cia_aberta_composicao_capital_{ITR_YEAR}.csv", itr_index)

annual_index = document_index("dfp")
interim_index = document_index("itr")
scope_history = {}
for scope in ("consolidated", "individual"):
    scope_history[scope] = {
        "dre": annual_history("DRE", annual_index, scope),
        "bpa": annual_history("BPA", annual_index, scope),
        "bpp": annual_history("BPP", annual_index, scope),
        "dfc_mi": annual_history("DFC_MI", annual_index, scope),
        "dfc_md": annual_history("DFC_MD", annual_index, scope),
        "interim_dre": interim_period_history("DRE", interim_index, scope),
    }
dfp_versions = document_versions("dfp")
itr_versions = document_versions("itr")


def growth(current, previous):
    return growth_analysis(current, previous)["value"]


def trace_account(values, *codes):
    for code in codes:
        for row in values.get("_rows", []):
            if row["code"] == code:
                return {
                    "code": code,
                    "name": row.get("name") or row.get("label"),
                    "value": row["value"],
                    "startDate": row.get("startDate"),
                    "endDate": row.get("endDate"),
                }
    return None


def quarterly_rows(cnpj, scope):
    """Essential DRE accounts as isolated quarters, never mixed across scope."""
    history_dre = scope_history[scope]["dre"]
    interim_history_dre = scope_history[scope]["interim_dre"]
    metrics = {
        "revenue": ("3.01",),
        "grossProfit": ("3.03",),
        "ebit": ("3.05",),
        "netIncome": ("3.11.01", "3.11", "3.09"),
    }
    years = sorted(
        {int(reference[:4]) for reference in interim_history_dre.get(cnpj, {})}
        | {int(reference[:4]) for reference in history_dre.get(cnpj, {})},
        reverse=True,
    )[:5]
    output = []
    for year in years:
        cumulative_by_metric = defaultdict(list)
        for reference, periods in interim_history_dre.get(cnpj, {}).items():
            if int(reference[:4]) != year:
                continue
            for period in periods:
                meta = period.get("_meta", {})
                start = meta.get("startDate") or ""
                end = meta.get("endDate") or reference
                try:
                    month = int(end[5:7])
                except (TypeError, ValueError):
                    continue
                if not start.endswith("-01-01") or month not in (3, 6, 9):
                    continue
                quarter = month // 3
                for name, codes in metrics.items():
                    value = account(period, *codes)
                    if value is not None:
                        cumulative_by_metric[name].append({"quarter": quarter, "value": value, "meta": meta})
        annual = history_dre.get(cnpj, {}).get(f"{year}-12-31", {})
        isolated = {
            name: isolate_quarters(items, account(annual, *metrics[name]))
            for name, items in cumulative_by_metric.items()
        }
        quarter_numbers = sorted({row["quarter"] for rows_ in isolated.values() for row in rows_})
        if quarter_numbers:
            output.append({
                "year": year,
                "scope": scope,
                "quarters": [{
                    "quarter": quarter,
                    "income": {
                        name: next((row["value"] for row in rows_ if row["quarter"] == quarter), None)
                        for name, rows_ in isolated.items()
                    },
                    "states": {
                        name: next((row["state"] for row in rows_ if row["quarter"] == quarter), "unavailable")
                        for name, rows_ in isolated.items()
                    },
                } for quarter in quarter_numbers],
            })
    return output


def history_rows(cnpj, financial, scope):
    history_dre = scope_history[scope]["dre"]
    history_bpa = scope_history[scope]["bpa"]
    history_bpp = scope_history[scope]["bpp"]
    history_dfc_mi = scope_history[scope]["dfc_mi"]
    history_dfc_md = scope_history[scope]["dfc_md"]
    references = sorted(
        set(history_dre.get(cnpj, {})) | set(history_bpa.get(cnpj, {})) | set(history_bpp.get(cnpj, {})),
        reverse=True,
    )[:10]
    result = []
    for reference in references:
        dre = history_dre.get(cnpj, {}).get(reference, {})
        bpa = history_bpa.get(cnpj, {}).get(reference, {})
        bpp = history_bpp.get(cnpj, {}).get(reference, {})
        dfc = history_dfc_mi.get(cnpj, {}).get(reference) or history_dfc_md.get(cnpj, {}).get(reference, {})
        equity_total = account(bpp, "2.08", "2.07", "2.03") if financial else account(bpp, "2.03")
        minority = account(bpp, "2.03.09") or 0
        equity_value = equity_total - minority if equity_total is not None else None
        assets_value = account(bpa, "1")
        revenue_value = account(dre, "3.01")
        gross_profit_value = account(dre, "3.03")
        ebit_value = account(dre, "3.05")
        net_income_value = account(dre, "3.11.01", "3.11", "3.09")
        depreciation = semantic_account(dfc, ("depreciacao e amortizacao", "depreciacoes e amortizacoes"))
        ebitda_value = ebit_value + abs(depreciation) if ebit_value is not None and depreciation is not None else None
        cash_value = sum_known(account(bpa, "1.01.01"), account(bpa, "1.01.02"))
        debt_value = sum_known(account(bpp, "2.01.04"), account(bpp, "2.02.01"))
        cfo = account(dfc, "6.01")
        cfi = account(dfc, "6.02")
        result.append({
            "year": int(reference[:4]),
            "referenceDate": reference,
            "income": {
                "revenue": revenue_value,
                "costs": account(dre, "3.02"),
                "grossProfit": gross_profit_value,
                "operatingExpenses": account(dre, "3.04"),
                "ebit": ebit_value,
                "depreciationAmortization": depreciation,
                "ebitda": ebitda_value,
                "financialResult": account(dre, "3.06"),
                "taxes": account(dre, "3.08"),
                "netIncome": net_income_value,
                "controllerIncome": account(dre, "3.11.01"),
                "nonControllerIncome": account(dre, "3.11.02"),
                "roe": safe_div(net_income_value, equity_value, 100),
                "grossMargin": safe_div(gross_profit_value, revenue_value, 100),
                "ebitMargin": safe_div(ebit_value, revenue_value, 100),
                "netMargin": safe_div(net_income_value, revenue_value, 100),
            },
            "cashFlow": {
                "operating": cfo,
                "investing": cfi,
                "freeCashFlow": cfo + cfi if cfo is not None and cfi is not None else None,
                "financing": account(dfc, "6.03"),
                "currencyEffect": account(dfc, "6.04"),
                "cashChange": account(dfc, "6.05"),
                "openingCash": account(dfc, "6.05.01"),
                "closingCash": account(dfc, "6.05.02"),
            },
            "balance": {
                "assets": assets_value,
                "currentAssets": account(bpa, "1.01"),
                "financialInvestments": account(bpa, "1.01.02"),
                "cash": account(bpa, "1.01.01"),
                "receivables": account(bpa, "1.01.03"),
                "inventory": account(bpa, "1.01.04"),
                "nonCurrentAssets": account(bpa, "1.02"),
                "longTermAssets": account(bpa, "1.02.01"),
                "investments": account(bpa, "1.02.02"),
                "propertyPlantEquipment": account(bpa, "1.02.03"),
                "intangibles": account(bpa, "1.02.04"),
                "liabilities": account(bpp, "2"),
                "currentLiabilities": account(bpp, "2.01"),
                "nonCurrentLiabilities": account(bpp, "2.02"),
                "equity": equity_value,
                "shareCapital": account(bpp, "2.03.01"),
                "capitalReserves": account(bpp, "2.03.02"),
                "profitReserves": account(bpp, "2.03.04"),
                "nonControllingInterest": account(bpp, "2.03.09"),
                "grossDebt": debt_value,
                "netDebt": debt_value - cash_value if debt_value is not None and cash_value is not None else None,
            },
        })
    for index, row in enumerate(result):
        previous = result[index + 1] if index + 1 < len(result) else None
        row["incomeGrowth"] = {
            key: growth(value, previous["income"].get(key) if previous else None)
            for key, value in row["income"].items() if key not in {"roe", "grossMargin", "ebitMargin", "netMargin"}
        }
        row["incomeGrowthStates"] = {
            key: growth_analysis(value, previous["income"].get(key) if previous else None)["state"]
            for key, value in row["income"].items() if key not in {"roe", "grossMargin", "ebitMargin", "netMargin"}
        }
        row["cashFlowGrowth"] = {
            key: growth(value, previous["cashFlow"].get(key) if previous else None)
            for key, value in row["cashFlow"].items()
        }
        row["balanceGrowth"] = {
            key: growth(value, previous["balance"].get(key) if previous else None)
            for key, value in row["balance"].items()
        }
    return result

tickers_by_company = defaultdict(list)
for ticker, row in security.items():
    tickers_by_company[row["CNPJ_Companhia"]].append(ticker)

company_fundamentals = {}
for cnpj, company_tickers in tickers_by_company.items():
    candidates = {}
    for candidate_scope, scoped in scope_data.items():
        candidates[candidate_scope] = {
            "dre": scoped["dfp_dre"].get(cnpj, {"current": {}, "previous": {}}),
            "bpa": scoped["itr_bpa"].get(cnpj) or scoped["dfp_bpa"].get(cnpj) or {"current": {}, "previous": {}},
            "bpp": scoped["itr_bpp"].get(cnpj) or scoped["dfp_bpp"].get(cnpj) or {"current": {}, "previous": {}},
        }
    scope_selection = select_statement_scope(candidates["consolidated"], candidates["individual"])
    accounting_scope = scope_selection["scope"]
    scoped = scope_data[accounting_scope]
    annual_dre = scoped["dfp_dre"].get(cnpj, {"current": {}, "previous": {}})
    if not annual_dre.get("current"):
        annual_dre = latest_annual_pair(scope_history[accounting_scope]["dre"], cnpj)
    interim_dre = scoped["itr_dre"].get(cnpj, {"current": {}, "previous": {}})
    annual_dfc = scoped["dfp_dfc"].get(cnpj, {"current": {}, "previous": {}})
    interim_dfc = scoped["itr_dfc"].get(cnpj, {"current": {}, "previous": {}})
    latest_bpa = scoped["itr_bpa"].get(cnpj) or scoped["dfp_bpa"].get(cnpj) or {"current": {}, "previous": {}}
    latest_bpp = scoped["itr_bpp"].get(cnpj) or scoped["dfp_bpp"].get(cnpj) or {"current": {}, "previous": {}}
    cap = itr_cap.get(cnpj) or dfp_cap.get(cnpj) or {"ordinary": 0, "preferred": 0, "total": 0}

    ttm_results = {
        "revenue": ttm_result("3.01", annual_dre, interim_dre),
        "grossProfit": ttm_result("3.03", annual_dre, interim_dre),
        "ebit": ttm_result("3.05", annual_dre, interim_dre),
        "netIncome": ttm_result("3.11.01", annual_dre, interim_dre),
    }
    revenue = ttm_results["revenue"]["value"]
    gross_profit = ttm_results["grossProfit"]["value"]
    ebit = ttm_results["ebit"]["value"]
    net_income = ttm_results["netIncome"]["value"]
    if net_income is None:
        ttm_results["netIncome"] = ttm_result("3.11", annual_dre, interim_dre)
        net_income = ttm_results["netIncome"]["value"]
    if net_income is None:
        ttm_results["netIncome"] = ttm_result("3.09", annual_dre, interim_dre)
        net_income = ttm_results["netIncome"]["value"]
    depreciation_amortization = ttm_semantic(
        (),
        ("depreciacao e amortizacao", "depreciacoes e amortizacoes"),
        annual_dfc,
        interim_dfc,
    )
    ebitda = ebit + abs(depreciation_amortization) if ebit is not None and depreciation_amortization is not None else None

    bpa = latest_bpa["current"]
    bpp = latest_bpp["current"]
    root = company_tickers[0][:4]
    is_financial = is_financial_company(
        root,
        security[company_tickers[0]].get("Nome_Empresarial", ""),
    )
    equity_total = account(bpp, "2.08", "2.07", "2.03") if is_financial else account(bpp, "2.03")
    minority = account(bpp, "2.03.09") or 0
    equity = equity_total - minority if equity_total is not None else None
    assets = account(bpa, "1")
    current_assets = account(bpa, "1.01")
    current_liabilities = account(bpp, "2.01")
    non_current_liabilities = account(bpp, "2.02")
    cash = account_or_semantic(bpa, ("1.01.01",), ("caixa e equivalentes de caixa",))
    investments = account_or_semantic(bpa, ("1.01.02",), ("aplicacoes financeiras",))
    short_debt = account(bpp, "2.01.04")
    long_debt = account(bpp, "2.02.01")
    gross_debt = sum_known(short_debt, long_debt)
    if gross_debt is None:
        gross_debt = semantic_account(bpp, ("emprestimos e financiamentos", "divida bruta"))
    liquidity = sum_known(cash, investments)
    net_debt = gross_debt - liquidity if gross_debt is not None and liquidity is not None else None

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
    net_debt_ebitda = safe_div(net_debt, ebitda)
    current_ratio = safe_div(current_assets, current_liabilities)
    enterprise_value = market_cap + net_debt if market_cap is not None and net_debt is not None else None
    ev_ebit = safe_div(enterprise_value, ebit)
    eps = safe_div(net_income, cap["total"])
    bvps = safe_div(equity, cap["total"])
    prior_revenue = annual_dre["previous"].get("3.01")
    prior_profit = annual_dre["previous"].get("3.11.01") or annual_dre["previous"].get("3.11") or annual_dre["previous"].get("3.09")
    revenue_growth_analysis = growth_analysis(annual_dre["current"].get("3.01"), prior_revenue)
    revenue_growth = revenue_growth_analysis["value"]
    current_profit = annual_dre["current"].get("3.11.01") or annual_dre["current"].get("3.11") or annual_dre["current"].get("3.09")
    profit_growth_analysis = growth_analysis(current_profit, prior_profit)
    profit_growth = profit_growth_analysis["value"]
    pretax_income = ttm("3.07", annual_dre, interim_dre)
    income_taxes = ttm("3.08", annual_dre, interim_dre)
    effective_tax = safe_div(abs(income_taxes), abs(pretax_income)) if pretax_income and pretax_income > 0 and income_taxes is not None and income_taxes < 0 else None
    invested_capital = sum_known(equity, net_debt)
    roic = safe_div(ebit * (1 - effective_tax), invested_capital, 100) if ebit is not None and effective_tax is not None else None

    def score_growth(result):
        if result["state"] == "turnaround":
            return 82
        if result["state"] in {"profit_to_loss", "new_loss", "loss_increased"}:
            return 12
        if result["state"] == "loss_reduced":
            return 48
        return score_high(result["value"], [(20, 92), (10, 78), (3, 64), (0, 52), (-10, 35), (-10**9, 18)])

    revenue_growth_score = score_growth(revenue_growth_analysis)
    profit_growth_score = score_growth(profit_growth_analysis)

    price_score = average([
        score_low(pe if pe and pe > 0 else None, [(6, 95), (10, 85), (15, 70), (22, 55), (35, 35), (10**9, 20)]),
        score_low(pb if pb and pb > 0 else None, [(1, 92), (2, 76), (3, 62), (5, 42), (10**9, 22)]),
        None if is_financial else score_low(ev_ebit if ev_ebit and ev_ebit > 0 else None, [(6, 92), (10, 78), (15, 60), (25, 40), (10**9, 20)]),
    ])
    quality_score = weighted_average([
        (score_high(roe, [(25, 95), (18, 85), (12, 70), (8, 55), (-10**9, 25)]), 25),
        (score_high(roa, [(12, 92), (8, 80), (5, 65), (2, 50), (-10**9, 25)]), 15),
        (None if is_financial else score_high(roic, [(20, 95), (15, 82), (10, 65), (5, 40), (-10**9, 10)]), 20),
        (None if is_financial else score_high(net_margin, [(20, 92), (12, 78), (7, 65), (3, 50), (-10**9, 25)]), 15),
        (revenue_growth_score, 10),
        (profit_growth_score, 15),
    ])
    debt_score = None if is_financial else average([
        score_low(net_debt_ebitda if ebitda and ebitda > 0 else None, [(0, 96), (1, 85), (2, 72), (3, 56), (4, 40), (10**9, 20)]),
        score_high(current_ratio, [(1.5, 88), (1, 68), (.7, 48), (-10**9, 25)]),
    ])
    growth_score = average([
        revenue_growth_score,
        profit_growth_score,
    ])
    dividend_score = None  # calculated per ticker/share class after issuer fundamentals
    pillar_weights = {"price": 30 if is_financial else 25, "quality": 50 if is_financial else 35, "debt": 0 if is_financial else 25, "dividends": 20 if is_financial else 15}
    pillar_values = {"price": price_score, "quality": quality_score, "debt": debt_score, "dividends": dividend_score}
    overall = weighted_average([(pillar_values[key], pillar_weights[key]) for key in pillar_values])
    if overall is None:
        overall = 50  # catalog compatibility; the UI labels quote-only assets separately
    available_pillar_weight = sum(pillar_weights[key] for key, value in pillar_values.items() if value is not None)
    score_details = {
        key: {
            "weight": pillar_weights[key],
            "effectiveWeight": round(pillar_weights[key] / available_pillar_weight * 100) if value is not None and available_pillar_weight else 0,
            "score": value,
            "inputs": {
                "price": ["P/L", "P/VP"] + ([] if is_financial else ["EV/EBIT"]),
                "quality": ["ROE", "ROA", "ROIC", "margens", "crescimento"],
                "debt": [] if is_financial else ["Dívida líquida/EBITDA", "Liquidez corrente"],
                "dividends": ["Dividend yield", "Regularidade", "Payout"],
            }[key],
            "rationale": {
                "price": "Preço comparado a lucro, patrimônio e resultado operacional.",
                "quality": "Rentabilidade, eficiência e evolução dos resultados.",
                "debt": "Não aplicável a instituições financeiras." if is_financial else "Alavancagem e liquidez de curto prazo.",
                "dividends": "Yield, frequência e payout calculados por classe com eventos oficiais da B3.",
            }[key],
        }
        for key, value in pillar_values.items()
    }

    issuer = security[company_tickers[0]]
    reference_date = (itr_index.get(cnpj) or dfp_index.get(cnpj) or (None,))[0]
    metric_values = {
        "pe": pe, "pb": pb, "evEbit": ev_ebit, "roe": roe, "roa": roa,
        "grossMargin": gross_margin, "ebitMargin": ebit_margin, "netMargin": net_margin,
        "netDebtEbit": net_debt_ebit, "netDebtEbitda": net_debt_ebitda, "currentRatio": current_ratio,
        "revenueGrowth": revenue_growth, "profitGrowth": profit_growth, "eps": eps,
        "bookValuePerShare": bvps, "ebitda": ebitda, "roic": roic,
    }
    non_applicable = {"evEbit", "grossMargin", "ebitMargin", "netMargin", "netDebtEbit", "netDebtEbitda", "currentRatio", "ebitda", "roic"} if is_financial else set()
    score_metric_names = ["pe", "pb", "roe", "roa", "revenueGrowth", "profitGrowth"]
    if not is_financial:
        score_metric_names += ["evEbit", "netMargin", "netDebtEbit", "currentRatio"]
    applicable = [name for name in score_metric_names if name not in non_applicable]
    available_count = sum(metric_values[name] is not None for name in applicable)
    coverage = round(available_count / len(applicable) * 100) if applicable else 0
    freshness = freshness_score(reference_date)
    linkage = 100 if cnpj and cvm_codes.get(cnpj, (None, ""))[1] else 85
    consolidation = 100 if accounting_scope == "consolidated" else 90
    estimation = 85 if market_cap_estimated else 100
    confidence = round(coverage * .55 + freshness * .20 + linkage * .10 + consolidation * .10 + estimation * .05)
    metric_states = {
        name: (
            "not_applicable" if name in non_applicable else
            "not_found" if value is None else
            "estimated" if market_cap_estimated and name in {"pe", "pb", "evEbit"} else
            "stale" if freshness < 55 else
            "available"
        )
        for name, value in metric_values.items()
    }
    company_history = history_rows(cnpj, is_financial, accounting_scope)
    company_quarters = quarterly_rows(cnpj, accounting_scope)
    balance_reconciliation = reconcile_balance(assets, current_liabilities, non_current_liabilities, equity_total)
    selected_dfp_reference = dfp_index.get(cnpj, (None, None))[0]
    selected_itr_reference = itr_index.get(cnpj, (None, None))[0]
    document_audit = []
    for document_type, selected_reference, version_map in (
        ("DFP", selected_dfp_reference, dfp_versions),
        ("ITR", selected_itr_reference, itr_versions),
    ):
        if not selected_reference:
            continue
        available_versions = sorted(version_map.get(cnpj, {}).get(selected_reference, set()))
        document_audit.append({
            "documentType": document_type,
            "referenceDate": selected_reference,
            "selectedVersion": available_versions[-1] if available_versions else None,
            "supersededVersions": available_versions[:-1],
            "reissued": len(available_versions) > 1,
            "scope": accounting_scope,
        })
    account_map = {
        "revenue": {
            "annual": trace_account(annual_dre["current"], "3.01"),
            "currentYtd": trace_account(interim_dre["current"], "3.01"),
            "priorYtd": trace_account(interim_dre["previous"], "3.01"),
        },
        "netIncome": {
            "annual": trace_account(annual_dre["current"], "3.11.01", "3.11", "3.09"),
            "currentYtd": trace_account(interim_dre["current"], "3.11.01", "3.11", "3.09"),
            "priorYtd": trace_account(interim_dre["previous"], "3.11.01", "3.11", "3.09"),
        },
        "assets": trace_account(bpa, "1"),
        "currentLiabilities": trace_account(bpp, "2.01"),
        "nonCurrentLiabilities": trace_account(bpp, "2.02"),
        "equity": trace_account(bpp, "2.08", "2.07", "2.03") if is_financial else trace_account(bpp, "2.03"),
    }
    validated_ttm = any(result["state"] == "validated_ttm" for result in ttm_results.values())
    company_fundamentals[cnpj] = {
        "cnpj": cnpj,
        "cvmCode": cvm_codes.get(cnpj, (None, ""))[1],
        "companyName": issuer.get("Nome_Empresarial"),
        "segment": issuer.get("Segmento") or None,
        "listingSegment": issuer.get("Segmento") or None,
        "sector": None,
        "subsector": None,
        "industrySegment": None,
        "freeFloat": None,
        "referenceDate": reference_date,
        "filingType": "ITR + DFP (TTM validado)" if validated_ttm else "DFP anual",
        "periodLabel": "12 meses validados até a última ITR" if validated_ttm else f"exercício de {DFP_YEAR}",
        "marketCapEstimated": market_cap_estimated,
        "financialCompany": is_financial,
        "revenueTTM": revenue, "grossProfitTTM": gross_profit, "ebitTTM": ebit,
        "depreciationAmortizationTTM": depreciation_amortization, "ebitdaTTM": ebitda, "netIncomeTTM": net_income,
        "equity": equity, "assets": assets, "currentAssets": current_assets, "currentLiabilities": current_liabilities,
        "nonCurrentLiabilities": non_current_liabilities,
        "grossDebt": gross_debt, "cashAndInvestments": liquidity, "netDebt": net_debt,
        "enterpriseValue": enterprise_value,
        "sharesOutstanding": cap["total"] or None, "ordinaryShares": cap["ordinary"] or None, "preferredShares": cap["preferred"] or None,
        "marketCap": market_cap, "pe": pe, "pb": pb, "roe": roe, "roa": roa, "roic": roic,
        "grossMargin": gross_margin, "ebitMargin": ebit_margin, "netMargin": net_margin,
        "netDebtEbit": net_debt_ebit, "netDebtEbitda": net_debt_ebitda, "currentRatio": current_ratio, "evEbit": ev_ebit,
        "eps": eps, "bookValuePerShare": bvps, "revenueGrowth": revenue_growth, "profitGrowth": profit_growth,
        "dividendYield": None, "dividendsPerShare12m": None, "dividendRegularity": None,
        "dividendMonths24m": 0, "payout": None, "dividendEvents": [], "dividendSourceDate": None,
        "audit": {
            "methodVersion": "3.0.0",
            "generatedAt": date.today().isoformat(),
            "accountingSource": f"CVM DFP/ITR {accounting_scope}",
            "priceSource": "B3 COTAHIST",
            "annualYears": sorted({row["year"] for row in company_history}),
            "itrYears": sorted({row["year"] for row in company_quarters}),
            "scope": accounting_scope,
            "scopeReason": scope_selection["reason"],
            "ttm": ttm_results,
            "documents": document_audit,
            "accounts": account_map,
            "balanceReconciliation": balance_reconciliation,
            "cashFlowMethod": scoped["itr_dfc_methods"].get(cnpj) or scoped["dfp_dfc_methods"].get(cnpj),
            "growthStates": {
                "revenue": revenue_growth_analysis["state"],
                "profit": profit_growth_analysis["state"],
            },
        },
        "scoreDetails": score_details,
        "metricStates": metric_states,
        "confidenceDetails": {
            "coverage": coverage,
            "freshness": freshness,
            "linkage": linkage,
            "consolidation": consolidation,
            "estimation": estimation,
            "available": available_count,
            "applicable": len(applicable),
        },
        "history": company_history,
        "quarters": company_quarters,
        "scores": {"price": price_score, "quality": quality_score, "debt": debt_score, "growth": growth_score, "dividends": dividend_score, "overall": overall, "confidence": confidence},
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
        fundamental = copy.deepcopy(fundamental)
        events = dividend_events_by_name.get(str(asset.get("name") or "").strip().upper(), [])
        dividend_metrics = calculate_ticker_dividends(
            events,
            ticker,
            asset.get("price"),
            fundamental.get("netIncomeTTM"),
            fundamental.get("sharesOutstanding"),
            date.fromisoformat(asset["date"]) if asset.get("date") else date.today(),
        )
        fundamental.update(dividend_metrics)
        dividend_score = dividend_metrics["dividendScore"]
        fundamental["scores"]["dividends"] = dividend_score
        if dividend_score is not None:
            weights = {
                "price": 30 if fundamental["financialCompany"] else 25,
                "quality": 50 if fundamental["financialCompany"] else 35,
                "debt": 0 if fundamental["financialCompany"] else 25,
                "dividends": 20 if fundamental["financialCompany"] else 15,
            }
            fundamental["scores"]["overall"] = weighted_average([
                (fundamental["scores"].get(key), weight) for key, weight in weights.items()
            ])
            dividend_detail = fundamental.get("scoreDetails", {}).get("dividends")
            if dividend_detail:
                dividend_detail["score"] = dividend_score
                dividend_detail["rationale"] = "Proventos oficiais da B3: yield de 12 meses, meses com pagamento e payout estimado."
                available_weight = sum(
                    weights[key] for key in weights if fundamental["scores"].get(key) is not None
                )
                for key, detail in fundamental.get("scoreDetails", {}).items():
                    detail["effectiveWeight"] = (
                        round(weights[key] / available_weight * 100)
                        if detail.get("score") is not None and available_weight else 0
                    )
            details = fundamental.get("confidenceDetails")
            if details:
                details["applicable"] += 1
                details["available"] += 1
                details["coverage"] = round(details["available"] / details["applicable"] * 100)
                fundamental["scores"]["confidence"] = round(
                    details["coverage"] * .55 + details["freshness"] * .20 +
                    details["linkage"] * .10 + details["consolidation"] * .10 +
                    details["estimation"] * .05
                )
            fundamental.setdefault("metricStates", {}).update({
                "dividendYield": "available",
                "dividendRegularity": "available",
                "payout": "available" if dividend_metrics["payout"] is not None else "not_found",
            })
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
