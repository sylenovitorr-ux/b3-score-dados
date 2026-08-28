import { rowsForTicker, finite, DEFAULT_EXECUTION } from "./battle-engine.js";
import { buildBattleBenchmarkSeries } from "./battle-benchmarks.js";

const dateOk = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? "");

function lastCloseAt(rows, date) {
  let value = null;
  for (const row of rows) {
    if (row.date > date) break;
    if (finite(row.close) != null) value = finite(row.close);
  }
  return value;
}

function normalizedPositions(portfolio = {}) {
  const open = (portfolio.holdings ?? []).map((holding) => ({
    id: `open:${holding.ticker}:${holding.entryDate ?? "na"}`,
    ticker: holding.ticker,
    entryDate: holding.entryDate,
    entryPrice: finite(holding.entryPrice),
    quantity: finite(holding.quantity),
    exitDate: null,
    exitPrice: null,
    realizedPnl: null,
  }));
  const closed = (portfolio.closedTrades ?? []).map((trade) => ({
    id: `closed:${trade.id ?? trade.ticker}:${trade.entryDate ?? "na"}`,
    ticker: trade.ticker,
    entryDate: trade.entryDate,
    entryPrice: finite(trade.entryPrice),
    quantity: finite(trade.quantity),
    exitDate: trade.exitDate,
    exitPrice: finite(trade.exitPrice),
    realizedPnl: finite(trade.pnl),
  }));
  return [...open, ...closed].filter((row) => row.ticker && dateOk(row.entryDate) && row.entryPrice > 0 && row.quantity > 0);
}

function positionPnlAt(position, date, rows) {
  if (date < position.entryDate) return 0;
  const feePct = DEFAULT_EXECUTION.transactionCostPct / 100;
  const entryValue = position.entryPrice * position.quantity;
  const entryFee = entryValue * feePct;
  if (position.exitDate && date >= position.exitDate) {
    if (position.realizedPnl != null) return position.realizedPnl;
    if (!(position.exitPrice > 0)) return 0;
    const exitValue = position.exitPrice * position.quantity;
    return exitValue - entryValue - entryFee - exitValue * feePct;
  }
  const close = lastCloseAt(rows, date);
  if (!(close > 0)) return 0;
  const markedValue = close * position.quantity;
  return markedValue - entryValue - entryFee - markedValue * feePct;
}

export function rebuildPortfolioHistory(portfolio, assetMap, anomalies, benchmarkPayload) {
  const capital = finite(portfolio?.capital) ?? 0;
  const positions = normalizedPositions(portfolio);
  if (!(capital > 0) || !positions.length || !anomalies) return { rows: [], benchmarks: null, startDate: null, endDate: null };

  const seriesByTicker = new Map([...new Set(positions.map((row) => row.ticker))].map((ticker) => [ticker, rowsForTicker(ticker, assetMap.get(ticker), anomalies)]));
  const startDate = positions.map((row) => row.entryDate).sort()[0];
  const marketDates = [...seriesByTicker.values()].flatMap((rows) => rows.map((row) => row.date)).filter((date) => date >= startDate);
  const dates = [...new Set(marketDates)].sort();
  const rows = dates.map((date) => {
    const pnl = positions.reduce((sum, position) => sum + positionPnlAt(position, date, seriesByTicker.get(position.ticker) ?? []), 0);
    const equity = capital + pnl;
    return { date, equity, pnl, returnPct: capital > 0 ? pnl / capital * 100 : null };
  });
  const benchmarks = benchmarkPayload ? buildBattleBenchmarkSeries(benchmarkPayload, startDate, rows.map((row) => row.date)) : null;
  return { rows, benchmarks, startDate, endDate: rows.at(-1)?.date ?? null };
}

export function historyStats(history) {
  const rows = history?.rows ?? [];
  if (!rows.length) return { returnPct: null, pnl: null, maxDrawdownPct: null, ibov: null, cdi: null, alphaIbov: null, alphaCdi: null };
  let peak = rows[0].equity;
  let maxDrawdownPct = 0;
  for (const row of rows) {
    peak = Math.max(peak, row.equity);
    if (peak > 0) maxDrawdownPct = Math.min(maxDrawdownPct, (row.equity / peak - 1) * 100);
  }
  const latest = rows.at(-1);
  const ibov = history.benchmarks?.series?.find((item) => item.id === "IBOV")?.latestReturnPct ?? null;
  const cdi = history.benchmarks?.series?.find((item) => item.id === "CDI")?.latestReturnPct ?? null;
  return {
    returnPct: latest.returnPct,
    pnl: latest.pnl,
    maxDrawdownPct,
    ibov,
    cdi,
    alphaIbov: latest.returnPct != null && ibov != null ? latest.returnPct - ibov : null,
    alphaCdi: latest.returnPct != null && cdi != null ? latest.returnPct - cdi : null,
  };
}
