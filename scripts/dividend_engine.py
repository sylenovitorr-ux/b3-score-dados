#!/usr/bin/env python3
"""Normalization and scoring rules for official B3 cash distributions."""

from __future__ import annotations

from datetime import date, timedelta


def br_number(value):
    if value in (None, "", "-"):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace("R$", "").replace(" ", "")
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def br_date(value):
    if not value:
        return None
    text = str(value).strip()[:10]
    try:
        if "/" in text:
            day, month, year = text.split("/")
            return date(int(year), int(month), int(day))
        return date.fromisoformat(text)
    except (TypeError, ValueError):
        return None


def normalize_share_type(value):
    text = " ".join(str(value or "").upper().split())
    if text.startswith("ON"):
        return "ON"
    if text.startswith("PNA"):
        return "PNA"
    if text.startswith("PNB"):
        return "PNB"
    if text.startswith("PN"):
        return "PN"
    if text.startswith(("UNT", "UNIT")):
        return "UNIT"
    return text or "N/D"


def normalize_event(raw, trading_name):
    value_cash = br_number(raw.get("valueCash"))
    quoted = br_number(raw.get("quotedPerShares")) or 1
    ex_prior = br_date(raw.get("lastDatePriorEx") or raw.get("lastDateTimePriorEx"))
    approval = br_date(raw.get("dateApproval"))
    if value_cash is None or quoted <= 0 or ex_prior is None:
        return None
    per_share = value_cash / quoted
    if per_share <= 0:
        return None
    action = " ".join(str(raw.get("corporateAction") or "Provento em dinheiro").split())
    share_type = normalize_share_type(raw.get("typeStock"))
    return {
        "tradingName": trading_name,
        "shareType": share_type,
        "type": action,
        "valuePerShare": per_share,
        "approvedAt": approval.isoformat() if approval else None,
        "lastDateWith": ex_prior.isoformat(),
        "exDate": (ex_prior + timedelta(days=1)).isoformat(),
        "paymentDate": None,
        "source": "B3",
    }


def event_key(event):
    return (
        event.get("tradingName"),
        event.get("shareType"),
        event.get("type"),
        event.get("valuePerShare"),
        event.get("lastDateWith"),
    )


def deduplicate_events(events):
    unique = {}
    for event in events:
        if event:
            unique[event_key(event)] = event
    return sorted(unique.values(), key=lambda item: item["lastDateWith"], reverse=True)


def applies_to_ticker(event, ticker):
    suffix = str(ticker)[4:]
    share_type = event.get("shareType")
    if suffix == "3":
        return share_type == "ON"
    if suffix == "4":
        return share_type in {"PN", "PNA", "PNB"}
    if suffix == "5":
        return share_type in {"PNA", "PN"}
    if suffix == "6":
        return share_type in {"PNB", "PN"}
    if suffix in {"11", "12", "13"}:
        return share_type == "UNIT"
    return False


def score_high(value, bands):
    if value is None:
        return None
    for limit, points in bands:
        if value >= limit:
            return points
    return bands[-1][1]


def score_payout(value):
    if value is None:
        return None
    if value < 0:
        return 10
    if value <= 35:
        return 72
    if value <= 75:
        return 92
    if value <= 100:
        return 70
    if value <= 130:
        return 42
    return 18


def weighted_average(items):
    valid = [(value, weight) for value, weight in items if value is not None]
    total = sum(weight for _, weight in valid)
    return round(sum(value * weight for value, weight in valid) / total) if total else None


def calculate_ticker_dividends(events, ticker, price, net_income, total_shares, as_of=None):
    as_of = as_of or date.today()
    applicable = [event for event in deduplicate_events(events) if applies_to_ticker(event, ticker)]
    cutoff_12m = as_of - timedelta(days=365)
    cutoff_24m = as_of - timedelta(days=730)
    events_12m = [event for event in applicable if (br_date(event["lastDateWith"]) or date.min) >= cutoff_12m]
    events_24m = [event for event in applicable if (br_date(event["lastDateWith"]) or date.min) >= cutoff_24m]
    cash_12m = sum(event["valuePerShare"] for event in events_12m)
    dividend_yield = cash_12m / price * 100 if price and price > 0 and events_12m else None
    paid_months = len({event["lastDateWith"][:7] for event in events_24m})
    regularity = paid_months / 24 * 100 if events_24m else None
    payout = (
        cash_12m * total_shares / net_income * 100
        if cash_12m and total_shares and net_income and net_income > 0
        else None
    )
    yield_score = score_high(dividend_yield, [(10, 92), (7, 84), (5, 72), (3, 58), (0, 35), (-10**9, 20)])
    regularity_score = score_high(regularity, [(45, 92), (30, 80), (20, 65), (10, 48), (-10**9, 25)])
    payout_score = score_payout(payout)
    score = weighted_average([(yield_score, 50), (regularity_score, 25), (payout_score, 25)])
    return {
        "dividendYield": dividend_yield,
        "dividendsPerShare12m": cash_12m if events_12m else None,
        "dividendRegularity": regularity,
        "dividendMonths24m": paid_months,
        "payout": payout,
        "dividendScore": score,
        "dividendEvents": applicable[:20],
        "dividendEvents12m": len(events_12m),
        "dividendSourceDate": max((event["lastDateWith"] for event in applicable), default=None),
    }
