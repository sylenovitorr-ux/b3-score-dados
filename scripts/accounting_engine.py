#!/usr/bin/env python3
"""Pure accounting rules used by the CVM snapshot builder.

The functions in this module deliberately do not perform I/O.  This makes the
period, version and reconciliation rules independently testable.
"""

from __future__ import annotations

from datetime import date


def parse_date(value):
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def period_days(meta):
    start = parse_date((meta or {}).get("startDate"))
    end = parse_date((meta or {}).get("endDate"))
    return (end - start).days + 1 if start and end and end >= start else None


def select_latest_versions(records):
    """Keep the highest CVM version for each issuer/reference/document/scope."""
    latest = {}
    for record in records:
        key = (
            record.get("cnpj"),
            record.get("referenceDate"),
            record.get("documentType"),
            record.get("scope"),
        )
        version = int(record.get("version") or 0)
        if all(key[:2]) and version >= int(latest.get(key, {}).get("version") or -1):
            latest[key] = record
    return latest


def select_statement_scope(consolidated, individual):
    """Choose one complete accounting scope for the whole issuer.

    Consolidated statements are preferred.  When the issuer does not publish a
    usable consolidated DRE/balance set, use the individual set consistently
    instead of mixing scopes or leaving every income metric unavailable.
    """
    required = {
        "dre": ("3.01",),
        "bpa": ("1",),
        "bpp": ("2.03", "2.07", "2.08"),
    }

    def complete(dataset):
        for statement, codes in required.items():
            values = (dataset.get(statement) or {}).get("current") or {}
            if not any(code in values for code in codes):
                return False
        return True

    if complete(consolidated):
        return {
            "scope": "consolidated",
            "reason": "demonstracoes_consolidadas_completas",
        }
    if complete(individual):
        return {
            "scope": "individual",
            "reason": "consolidado_incompleto_fallback_individual",
        }
    return {
        "scope": "consolidated",
        "reason": "nenhum_escopo_completo_preferencia_consolidado",
    }


def validate_ttm_periods(annual_meta, current_meta, prior_meta):
    """Validate FY + current YTD - comparable prior YTD.

    The two interim periods must have approximately the same duration and end
    in the same calendar month/day one year apart.  The annual period must be a
    full year immediately preceding the current interim exercise.
    """
    annual_start = parse_date((annual_meta or {}).get("startDate"))
    annual_end = parse_date((annual_meta or {}).get("endDate"))
    current_start = parse_date((current_meta or {}).get("startDate"))
    current_end = parse_date((current_meta or {}).get("endDate"))
    prior_start = parse_date((prior_meta or {}).get("startDate"))
    prior_end = parse_date((prior_meta or {}).get("endDate"))
    if not all((annual_start, annual_end, current_start, current_end, prior_start, prior_end)):
        return False, "datas_do_periodo_ausentes"
    annual_days = period_days(annual_meta)
    current_days = period_days(current_meta)
    prior_days = period_days(prior_meta)
    if annual_days is None or annual_days < 330:
        return False, "dfp_nao_cobre_exercicio_anual"
    if current_days is None or prior_days is None or abs(current_days - prior_days) > 3:
        return False, "itr_atual_e_comparativa_incompativeis"
    if (current_end.month, current_end.day) != (prior_end.month, prior_end.day):
        return False, "datas_finais_incompativeis"
    if current_end.year - prior_end.year != 1:
        return False, "comparativa_nao_e_do_ano_anterior"
    if current_start.year - prior_start.year != 1:
        return False, "datas_iniciais_incompativeis"
    if annual_end.year != current_end.year - 1:
        return False, "dfp_nao_precede_a_itr"
    scopes = {
        (annual_meta or {}).get("scope"),
        (current_meta or {}).get("scope"),
        (prior_meta or {}).get("scope"),
    }
    scopes.discard(None)
    if len(scopes) > 1:
        return False, "demonstracoes_consolidadas_e_individuais_misturadas"
    return True, "validado"


def calculate_ttm(fy, current_ytd, prior_ytd, annual_meta, current_meta, prior_meta):
    valid, reason = validate_ttm_periods(annual_meta, current_meta, prior_meta)
    if valid and None not in (fy, current_ytd, prior_ytd):
        return {
            "value": fy + current_ytd - prior_ytd,
            "state": "validated_ttm",
            "reason": reason,
            "formula": "DFP anual + ITR acumulada atual − ITR acumulada comparativa",
        }
    return {
        "value": fy,
        "state": "annual_fallback" if fy is not None else "unavailable",
        "reason": reason if not valid else "contas_necessarias_ausentes",
        "formula": "DFP anual (TTM não calculado)",
    }


def isolate_quarters(cumulative_periods, annual_value=None):
    """Return isolated quarters from validated cumulative observations.

    cumulative_periods contains items with quarter (1..3), value and meta.
    Missing or non-cumulative observations are not silently combined.
    """
    ordered = sorted(cumulative_periods, key=lambda item: item["quarter"])
    result = []
    previous_value = 0
    previous_end = None
    for item in ordered:
        quarter = int(item["quarter"])
        value = item.get("value")
        meta = item.get("meta") or {}
        start = parse_date(meta.get("startDate"))
        end = parse_date(meta.get("endDate"))
        expected_month = quarter * 3
        cumulative = start and end and start.month == 1 and end.month == expected_month
        if value is None or not cumulative or (previous_end and end <= previous_end):
            result.append({"quarter": quarter, "value": None, "state": "invalid_period"})
            continue
        result.append({
            "quarter": quarter,
            "value": value - previous_value,
            "state": "reported" if quarter == 1 else "derived",
            "referenceDate": meta.get("referenceDate") or meta.get("endDate"),
        })
        previous_value = value
        previous_end = end
    if annual_value is not None and len(result) >= 3 and result[-1]["quarter"] == 3:
        valid_values = [row["value"] for row in result if row["value"] is not None]
        result.append({
            "quarter": 4,
            "value": annual_value - sum(valid_values) if len(valid_values) == 3 else None,
            "state": "derived" if len(valid_values) == 3 else "invalid_period",
        })
    return result


def reconcile_balance(assets, current_liabilities, non_current_liabilities, equity, tolerance_ratio=0.005):
    right_side_values = (current_liabilities, non_current_liabilities, equity)
    if assets is None or any(value is None for value in right_side_values):
        return {
            "state": "unavailable",
            "balanced": None,
            "difference": None,
            "tolerance": None,
            "formula": "Ativo = Passivo circulante + Passivo não circulante + Patrimônio líquido",
        }
    right_side = sum(right_side_values)
    difference = assets - right_side
    tolerance = max(1.0, abs(assets) * tolerance_ratio)
    return {
        "state": "balanced" if abs(difference) <= tolerance else "mismatch",
        "balanced": abs(difference) <= tolerance,
        "difference": difference,
        "tolerance": tolerance,
        "assets": assets,
        "liabilitiesAndEquity": right_side,
        "formula": "Ativo = Passivo circulante + Passivo não circulante + Patrimônio líquido",
    }


def growth_analysis(current, previous):
    if current is None or previous is None:
        return {"value": None, "state": "unavailable"}
    if previous == 0:
        if current > 0:
            return {"value": None, "state": "turnaround"}
        if current < 0:
            return {"value": None, "state": "new_loss"}
        return {"value": 0, "state": "stable"}
    if previous < 0 <= current:
        return {"value": None, "state": "turnaround"}
    if previous >= 0 > current:
        return {"value": None, "state": "profit_to_loss"}
    if previous < 0 and current < 0:
        return {
            "value": None,
            "state": "loss_reduced" if current > previous else "loss_increased",
        }
    return {"value": round((current / previous - 1) * 100, 10), "state": "normal"}
