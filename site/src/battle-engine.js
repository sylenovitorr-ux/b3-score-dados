export const finite = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);

export const modelPositionCount = (userCount) => {
  const count = Math.max(0, Math.floor(finite(userCount) ?? 0));
  return count > 0 ? count + 3 : 0;
};

export function localDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function nextTradingDate(base = localDate()) {
  const date = new Date(`${base}T12:00:00`);
  date.setDate(date.getDate() + 1);
  while ([0, 6].includes(date.getDay())) date.setDate(date.getDate() + 1);
  return localDate(date);
}

export function addMonths(value, months) {
  const date = new Date(`${value}T12:00:00`);
  date.setMonth(date.getMonth() + months);
  return localDate(date);
}

export function rowsForTicker(ticker, asset, anomalies) {
  const source = Array.isArray(anomalies?.assets?.[ticker]?.series) ? anomalies.assets[ticker].series : [];
  const map = new Map(source.filter((row) => row?.date && finite(row.close) != null).map((row) => [row.date, row]));
  if (asset?.date && finite(asset.price) != null) {
    map.set(asset.date, {
      date: asset.date,
      open: finite(asset.priceopen) ?? finite(asset.price),
      high: finite(asset.high) ?? finite(asset.price),
      low: finite(asset.low) ?? finite(asset.price),
      close: finite(asset.price),
      volume: finite(asset.volume),
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

export function closeOrder(order, price, date, reason) {
  const exitPrice = finite(price);
  const quantity = finite(order.quantity);
  const entryPrice = finite(order.entryPrice);
  const pnl = exitPrice != null && quantity != null && entryPrice != null ? (exitPrice - entryPrice) * quantity : null;
  const returnPct = entryPrice > 0 && exitPrice != null ? (exitPrice / entryPrice - 1) * 100 : null;
  return { ...order, status: "closed", exitPrice, exitDate: date, exitReason: reason, pnl, returnPct, updatedAt: new Date().toISOString() };
}

export function processOrder(order, battle, assetMap, anomalies) {
  if (battle.status !== "running" || ["closed", "cancelled"].includes(order.status)) return order;
  const asset = assetMap.get(order.ticker);
  const series = rowsForTicker(order.ticker, asset, anomalies);
  if (!series.length) return order;
  let working = { ...order };
  if (working.status === "waiting") {
    const entryIndex = series.findIndex((row) => row.date >= (working.startDate || battle.startDate) && touches(row, working.plannedEntry));
    if (entryIndex < 0) return working;
    const entryRow = series[entryIndex];
    const entryPrice = finite(working.plannedEntry);
    const allocation = finite(working.allocation) ?? battle.capital;
    const lotSize = Math.max(1, Math.floor(finite(working.lotSize) ?? 1));
    const availableQuantity = entryPrice > 0 ? Math.floor(allocation / (entryPrice * lotSize)) * lotSize : 0;
    const maxQuantity = finite(working.maxQuantity);
    const quantity = maxQuantity != null ? Math.min(availableQuantity, Math.max(0, Math.floor(maxQuantity))) : availableQuantity;
    if (!quantity) return working;
    working = { ...working, status: "open", entryPrice, entryDate: entryRow.date, quantity, updatedAt: new Date().toISOString() };
    const hitStop = touches(entryRow, working.stop);
    const hitTarget = touches(entryRow, working.target);
    if (hitStop && hitTarget) return closeOrder(working, working.stop, entryRow.date, "STOP CONSERVADOR");
    if (hitStop) return closeOrder(working, working.stop, entryRow.date, "STOP");
    if (hitTarget) return closeOrder(working, working.target, entryRow.date, "ALVO");
  }
  if (working.status !== "open") return working;
  for (const row of series.filter((item) => item.date > working.entryDate)) {
    const hitStop = touches(row, working.stop);
    const hitTarget = touches(row, working.target);
    if (hitStop && hitTarget) return closeOrder(working, working.stop, row.date, "STOP CONSERVADOR");
    if (hitStop) return closeOrder(working, working.stop, row.date, "STOP");
    if (hitTarget) return closeOrder(working, working.target, row.date, "ALVO");
    if (working.deadline && row.date >= working.deadline) return closeOrder(working, row.close, row.date, "PRAZO");
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
  return close != null && entry != null && quantity != null ? (close - entry) * quantity : 0;
}

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
      const capital = finite(competitor.capital) ?? finite(battle.capital) ?? 0;
      const pnl = (competitor.orders ?? []).reduce((sum, order) => sum + orderPnlAt(order, date, seriesByTicker.get(order.ticker) ?? []), 0);
      return [competitor.id, capital + pnl];
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
      const current = finite(assetMap.get(order.ticker)?.price);
      const entry = finite(order.entryPrice);
      const quantity = finite(order.quantity);
      if (current != null && entry != null && quantity != null) pnl += (current - entry) * quantity;
    } else if (order.status === "waiting") waiting += 1;
  }
  const capital = finite(competitor.capital) ?? 0;
  return { capital, pnl, equity: capital + pnl, returnPct: capital > 0 ? pnl / capital * 100 : null, closed, open, waiting, winRate: closed ? wins / closed * 100 : null };
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
