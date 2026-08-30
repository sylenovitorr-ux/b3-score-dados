import { DEFAULT_EXECUTION, finite } from "./battle-engine.js";

function closeOrder(order, price, reason, asOf) {
  const entry = finite(order.entryPrice);
  const quantity = finite(order.quantity);
  if (!(entry > 0) || !(quantity > 0) || !(price > 0)) return order;
  const feePct = Math.max(0, finite(order.transactionCostPct) ?? DEFAULT_EXECUTION.transactionCostPct);
  const entryFee = finite(order.entryFee) ?? entry * quantity * feePct / 100;
  const exitFee = price * quantity * feePct / 100;
  return {
    ...order,
    status: "closed",
    exitPrice: price,
    exitDate: String(asOf ?? "").slice(0, 10) || order.exitDate,
    exitAt: asOf ?? new Date().toISOString(),
    exitReason: reason,
    exitFee,
    pnl: (price - entry) * quantity - entryFee - exitFee,
  };
}

export function processLiveOrder(order, asset) {
  if (!order || order.status !== "open" || !asset?.intraday) return order;
  const price = finite(asset.price);
  if (!(price > 0)) return order;
  const stop = finite(order.stop);
  const target = finite(order.target);
  const asOf = asset.intradayAsOf ?? new Date().toISOString();
  if (stop != null && price <= stop) return closeOrder(order, price, "STOP INTRADAY", asOf);
  if (target != null && price >= target) return closeOrder(order, price, "ALVO INTRADAY", asOf);
  if (order.deadline && String(asOf).slice(0, 10) >= order.deadline) return closeOrder(order, price, "FIM DO PERÍODO", asOf);
  return order;
}
