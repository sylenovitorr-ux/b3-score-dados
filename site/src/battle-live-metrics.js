import { DEFAULT_EXECUTION, finite } from "./battle-engine.js";

export function liveCompetitorMetrics(competitor, assetMap) {
  if (!competitor) return null;
  let pnl = 0;
  let closed = 0;
  let open = 0;
  let waiting = 0;
  let wins = 0;
  let capital = 0;

  for (const order of competitor.orders ?? []) {
    if (order.status !== "cancelled") capital += finite(order.allocation) ?? 0;
    if (order.status === "closed") {
      closed += 1;
      const value = finite(order.pnl) ?? 0;
      pnl += value;
      if (value > 0) wins += 1;
      continue;
    }
    if (order.status === "waiting") {
      waiting += 1;
      continue;
    }
    if (order.status !== "open") continue;
    open += 1;
    const asset = assetMap.get(order.ticker);
    const current = finite(asset?.price);
    const entry = finite(order.entryPrice);
    const quantity = finite(order.quantity);
    if (current == null || entry == null || quantity == null) continue;
    const feePct = Math.max(0, finite(order.transactionCostPct) ?? DEFAULT_EXECUTION.transactionCostPct);
    const entryFee = finite(order.entryFee) ?? entry * quantity * feePct / 100;
    const exitFee = current * quantity * feePct / 100;
    pnl += (current - entry) * quantity - entryFee - exitFee;
  }

  capital = capital || finite(competitor.capital) || 0;
  return {
    capital,
    pnl,
    equity: capital + pnl,
    returnPct: capital > 0 ? pnl / capital * 100 : null,
    closed,
    open,
    waiting,
    winRate: closed ? wins / closed * 100 : null,
  };
}
