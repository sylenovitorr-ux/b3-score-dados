import { nextB3TradingDate } from "./market-calendar.js";

export const finite = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
export const BATTLE_MODEL_VERSION = "b3-score-swing-v3.0.0";
export const DEFAULT_EXECUTION = Object.freeze({ transactionCostPct: 0.03, slippagePct: 0.05, ambiguityPolicy: "stop-conservador" });

export const modelPositionCount = (userCount) => {
  const count = Math.max(0, Math.floor(finite(userCount) ?? 0));
  return count > 0 ? count + 3 : 0;
};

export const modelPositionAllocations = (userCount, perAssetValue) => {
  const value = finite(perAssetValue);
  return value > 0 ? Array(modelPositionCount(userCount)).fill(value) : [];
};

export function localDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function nextTradingDate(base = localDate()) {
  return nextB3TradingDate(base);
}

function stableHash(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function battlePlanFingerprint(battle) {
  const mine = battle?.competitors?.find((item) => item.kind === "mine");
  const plan = {
    startDate: battle?.startDate, horizonMonths: battle?.horizonMonths, marketMode: battle?.marketMode,
    positionAllocation: finite(battle?.positionAllocation),
    orders: (mine?.orders ?? []).map((order) => ({ ticker: order.ticker, entry: finite(order.plannedEntry), stop: finite(order.stop), target: finite(order.target), allocation: finite(order.allocation) })).sort((a, b) => a.ticker.localeCompare(b.ticker)),
  };
  return `plan-${stableHash(JSON.stringify(plan))}`;
}

export function marketSnapshotFingerprint(assets = [], anomalies = null) {
  const rows = assets.map((asset) => [asset.ticker, asset.officialQuoteDate ?? asset.date, finite(asset.price)]).sort((a, b) => a[0].localeCompare(b[0]));
  return `data-${stableHash(JSON.stringify({ quoteDate: anomalies?.quoteDate ?? null, model: anomalies?.modelVersion ?? null, rows }))}`;
}

export function addMonths(value, months) {
  const date = new Date(`${value}T12:00:00`);
  date.setMonth(date.getMonth() + months);
  return localDate(date);
}

export function rowsForTicker(ticker, asset, anomalies) {
  const source = Array.isArray(anomalies?.assets?.[ticker]?.series) ? anomalies.assets[ticker].series : [];
  const map = new Map(source.filter((row) => row?.date && finite(row.close) != null).map((row) => [row.date, row]));
  const assetDate = asset?.intraday ? asset.officialQuoteDate : asset?.date;
  const assetClose = asset?.intraday ? asset.officialPrice : asset?.price;
  if (assetDate && finite(assetClose) != null) {
    map.set(assetDate, {
      date: assetDate,
      open: finite(asset?.intraday ? asset.officialOpen : asset.priceopen) ?? finite(assetClose),
      high: finite(asset?.intraday ? asset.officialHigh : asset.high) ?? finite(assetClose),
      low: finite(asset?.intraday ? asset.officialLow : asset.low) ?? finite(assetClose),
      close: finite(assetClose),
      volume: finite(asset?.intraday ? asset.officialVolume : asset.volume),
    });
  }
  return [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function touches(row, price) {
  const target = finite(price);
  const low = finite(row?.low) ?? finite(row?.close);
  const high = finite(row?.high) ?? finite(row?.close);
  return target != null && low != null && high != null && low <= target && high >= target;
}

function executionConfig(order, battle = {}) {
  return {
    transactionCostPct: Math.max(0, finite(order.transactionCostPct) ?? finite(battle.transactionCostPct) ?? DEFAULT_EXECUTION.transactionCostPct),
    slippagePct: Math.max(0, finite(order.slippagePct) ?? finite(battle.slippagePct) ?? DEFAULT_EXECUTION.slippagePct),
  };
}

const buyExecution = (price, config) => finite(price) * (1 + config.slippagePct / 100);
const sellExecution = (price, config) => finite(price) * (1 - config.slippagePct / 100);

export function closeOrder(order, price, date, reason, battle = {}) {
  const marketExitPrice = finite(price);
  const config = executionConfig(order, battle);
  const exitPrice = marketExitPrice == null ? null : sellExecution(marketExitPrice, config);
  const quantity = finite(order.quantity);
  const entryPrice = finite(order.entryPrice);
  const entryFee = finite(order.entryFee) ?? (entryPrice != null && quantity != null ? entryPrice * quantity * config.transactionCostPct / 100 : 0);
  const exitFee = exitPrice != null && quantity != null ? exitPrice * quantity * config.transactionCostPct / 100 : 0;
  const fees = entryFee + exitFee;
  const grossPnl = exitPrice != null && quantity != null && entryPrice != null ? (exitPrice - entryPrice) * quantity : null;
  const pnl = grossPnl == null ? null : grossPnl - fees;
  const returnPct = entryPrice > 0 && exitPrice != null ? (exitPrice / entryPrice - 1) * 100 : null;
  const netReturnPct = entryPrice > 0 && quantity > 0 && pnl != null ? pnl / (entryPrice * quantity) * 100 : null;
  return { ...order, status: "closed", marketExitPrice, exitPrice, exitDate: date, exitReason: reason, grossPnl, fees, exitFee, pnl, returnPct: netReturnPct ?? returnPct, executionResolution: reason === "STOP CONSERVADOR" ? "daily-conservative" : reason.includes("GAP") ? "opening-gap" : "daily-touch", updatedAt: new Date().toISOString() };
}

function exitForRow(order, row) {
  const open = finite(row?.open) ?? finite(row?.close);
  const stop = finite(order.stop);
  const target = finite(order.target);
  if (open != null && stop != null && open <= stop) return { price: open, reason: "STOP · GAP NA ABERTURA" };
  if (open != null && target != null && open >= target) return { price: open, reason: "ALVO · GAP NA ABERTURA" };
  const hitStop = touches(row, stop);
  const hitTarget = touches(row, target);
  if (hitStop && hitTarget) return { price: stop, reason: "STOP CONSERVADOR" };
  if (hitStop) return { price: stop, reason: "STOP" };
  if (hitTarget) return { price: target, reason: "ALVO" };
  return null;
}

export function processOrder(order, battle, assetMap, anomalies) {
  if (battle.status !== "running" || ["closed", "cancelled"].includes(order.status)) return order;
  const asset = assetMap.get(order.ticker);
  const series = rowsForTicker(order.ticker, asset, anomalies);
  if (!series.length) return order;
  let working = { ...order };
  if (working.status === "waiting") {
    const entryIndex = series.findIndex((row) => row.date >= (working.startDate || battle.startDate) && ((finite(row.open) ?? -Infinity) > finite(working.plannedEntry) || touches(row, working.plannedEntry)));
    if (entryIndex < 0) return working;
    const entryRow = series[entryIndex];
    const plannedEntry = finite(working.plannedEntry);
    const open = finite(entryRow.open);
    const marketEntryPrice = open != null && open > plannedEntry ? open : plannedEntry;
    const config = executionConfig(working, battle);
    const entryPrice = buyExecution(marketEntryPrice, config);
    const allocation = finite(working.allocation) ?? battle.capital;
    const lotSize = Math.max(1, Math.floor(finite(working.lotSize) ?? 1));
    const availableQuantity = entryPrice > 0 ? Math.floor(allocation / (entryPrice * lotSize)) * lotSize : 0;
    const maxQuantity = finite(working.maxQuantity);
    const quantity = maxQuantity != null ? Math.min(availableQuantity, Math.max(0, Math.floor(maxQuantity))) : availableQuantity;
    if (!quantity) return working;
    const entryFee = entryPrice * quantity * config.transactionCostPct / 100;
    working = { ...working, status: "open", marketEntryPrice, entryPrice, entryDate: entryRow.date, quantity, entryFee, transactionCostPct: config.transactionCostPct, slippagePct: config.slippagePct, entryResolution: marketEntryPrice === open && open > plannedEntry ? "opening-gap" : "daily-touch", updatedAt: new Date().toISOString() };
    const exit = exitForRow(working, entryRow);
    if (exit) return closeOrder(working, exit.price, entryRow.date, exit.reason, battle);
  }
  if (working.status !== "open") return working;
  for (const row of series.filter((item) => item.date > working.entryDate)) {
    const exit = exitForRow(working, row);
    if (exit) return closeOrder(working, exit.price, row.date, exit.reason, battle);
    if (working.deadline && row.date >= working.deadline) return closeOrder(working, row.close, row.date, "PRAZO", battle);
  }
  return working;
}

function lastCloseAt(series, date) {
  let value = null;
  for (const row of series) {
    if (row.date > date) break;
    if (finite(row.close) != null) value = finite(row.close);
  }
  return value;
}

function orderPnlAt(order, date, series) {
  if (!order.entryDate || date < order.entryDate) return 0;
  if (order.exitDate && date >= order.exitDate) return finite(order.pnl) ?? 0;
  const close = lastCloseAt(series, date);
  const entry = finite(order.entryPrice);
  const quantity = finite(order.quantity);
  if (close == null || entry == null || quantity == null) return 0;
  const config = executionConfig(order);
  const markedExit = sellExecution(close, config);
  const entryFee = finite(order.entryFee) ?? entry * quantity * config.transactionCostPct / 100;
  const exitFee = markedExit * quantity * config.transactionCostPct / 100;
  return (markedExit - entry) * quantity - entryFee - exitFee;
}

export const allocatedCapital = (competitor) => (competitor?.orders ?? []).filter((order) => order.status !== "cancelled").reduce((sum, order) => sum + (finite(order.allocation) ?? 0), 0);

export function battleEquitySeries(battle, assetMap, anomalies) {
  if (!battle || battle.status === "setup") return [];
  const competitors = battle?.competitors ?? [];
  const tickers = [...new Set(competitors.flatMap((competitor) => (competitor.orders ?? []).map((order) => order.ticker)))];
  const seriesByTicker = new Map(tickers.map((ticker) => [ticker, rowsForTicker(ticker, assetMap.get(ticker), anomalies)]));
  const marketDates = [...seriesByTicker.values()].flatMap((rows) => rows.map((row) => row.date)).filter((date) => date >= battle.startDate && (!battle.endDate || date <= battle.endDate));
  const dates = [...new Set([battle.startDate, ...marketDates])].sort();
  return dates.map((date) => ({
    date,
    values: Object.fromEntries(competitors.map((competitor) => {
      const capital = allocatedCapital(competitor) || finite(competitor.capital) || finite(battle.capital) || 0;
      const pnl = (competitor.orders ?? []).reduce((sum, order) => sum + orderPnlAt(order, date, seriesByTicker.get(order.ticker) ?? []), 0);
      return [competitor.id, capital + pnl];
    })), returns: Object.fromEntries(competitors.map((competitor) => {
      const capital = allocatedCapital(competitor) || finite(competitor.capital) || finite(battle.capital) || 0;
      const pnl = (competitor.orders ?? []).reduce((sum, order) => sum + orderPnlAt(order, date, seriesByTicker.get(order.ticker) ?? []), 0);
      return [competitor.id, capital > 0 ? pnl / capital * 100 : 0];
    })),
  }));
}

export function competitorMetrics(competitor, assetMap) {
  let pnl = 0;
  let closed = 0;
  let open = 0;
  let waiting = 0;
  let wins = 0;
  for (const order of competitor.orders ?? []) {
    if (order.status === "closed") {
      closed += 1;
      const orderPnl = finite(order.pnl);
      if (orderPnl != null) pnl += orderPnl;
      if (orderPnl > 0) wins += 1;
    } else if (order.status === "open") {
      open += 1;
      const asset = assetMap.get(order.ticker);
      const current = finite(asset?.intraday ? asset.officialPrice : asset?.price);
      const entry = finite(order.entryPrice);
      const quantity = finite(order.quantity);
      if (current != null && entry != null && quantity != null) {
        const config = executionConfig(order);
        const markedExit = sellExecution(current, config);
        const entryFee = finite(order.entryFee) ?? entry * quantity * config.transactionCostPct / 100;
        pnl += (markedExit - entry) * quantity - entryFee - markedExit * quantity * config.transactionCostPct / 100;
      }
    } else if (order.status === "waiting") waiting += 1;
  }
  const availableCapital = finite(competitor.capital) ?? 0;
  const capital = allocatedCapital(competitor) || availableCapital;
  return { capital, availableCapital, allocatedCapital: capital, pnl, equity: capital + pnl, returnPct: capital > 0 ? pnl / capital * 100 : null, closed, open, waiting, winRate: closed ? wins / closed * 100 : null };
}

export function equityStats(rows, competitorId) {
  const values = rows.map((row) => finite(row.values?.[competitorId])).filter((value) => value != null);
  if (!values.length) return { latest: null, dailyPct: null, maxDrawdownPct: null };
  let peak = values[0];
  let drawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    if (peak > 0) drawdown = Math.min(drawdown, (value / peak - 1) * 100);
  }
  const latest = values.at(-1);
  const prior = values.at(-2);
  return { latest, dailyPct: prior > 0 ? (latest / prior - 1) * 100 : null, maxDrawdownPct: drawdown };
}
