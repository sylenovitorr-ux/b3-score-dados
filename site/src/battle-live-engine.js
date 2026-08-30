import { closeOrder, finite } from "./battle-engine.js";

function quoteDate(asset) {
  const value = asset?.intradayAsOf ?? asset?.date;
  const match = String(value ?? "").match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? asset?.officialQuoteDate ?? asset?.date ?? null;
}

export function processIntradayOrder(order, battle, asset) {
  if (!asset?.intraday || battle?.status !== "running" || ["closed", "cancelled"].includes(order?.status)) return order;
  const price = finite(asset.price);
  const date = quoteDate(asset);
  if (!(price > 0) || !date || date < (order.startDate || battle.startDate)) return order;

  if (order.status !== "open") return order;
  const stop = finite(order.stop);
  const target = finite(order.target);
  if (stop != null && price <= stop) return closeOrder(order, price, date, "STOP · INTRADAY", battle);
  if (target != null && price >= target) return closeOrder(order, price, date, "ALVO · INTRADAY", battle);
  if (order.deadline && date >= order.deadline) return closeOrder(order, price, date, "PRAZO · INTRADAY", battle);
  return order;
}
