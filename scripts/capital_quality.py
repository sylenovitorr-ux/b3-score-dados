"""Quality rules for CVM share quantities without an explicit scale column."""


def normalize_capital_scale(capital, equity, net_income, quote):
    """Return audited share quantities, multiplying only on strong evidence."""
    adjusted = dict(capital)
    multiplier = 1
    reasons = []
    if not adjusted.get("total") or not quote or quote <= 0:
        return adjusted, {"multiplier": multiplier, "reasons": reasons, "state": "unchanged"}
    for _ in range(2):
        total = adjusted["total"]
        book_to_price = equity / total / quote if equity is not None and equity > 0 else None
        earnings_to_price = abs(net_income / total) / quote if net_income is not None else None
        triggers = []
        if book_to_price is not None and book_to_price > 50:
            triggers.append(f"VPA/preço={book_to_price:.2f}")
        if earnings_to_price is not None and earnings_to_price > 20:
            triggers.append(f"|LPA|/preço={earnings_to_price:.2f}")
        if not triggers:
            break
        adjusted = {key: value * 1000 for key, value in adjusted.items()}
        multiplier *= 1000
        reasons.extend(triggers)
    state = "scale_adjusted" if multiplier > 1 else "unchanged"
    return adjusted, {"multiplier": multiplier, "reasons": reasons, "state": state}
