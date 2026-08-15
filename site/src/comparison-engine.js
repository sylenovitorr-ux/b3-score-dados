const finite = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);

export function base100Series(series = []) {
  const rows = series.filter((row) => finite(row?.close) > 0);
  if (!rows.length) return [];
  const base = Number(rows[0].close);
  return rows.map((row) => ({ date: row.date, value: Number((Number(row.close) / base * 100).toFixed(2)), close: Number(row.close) }));
}

export function relativePosition(value, peers = [], higherIsBetter = true) {
  const valid = peers.map(finite).filter((item) => item !== null);
  const current = finite(value);
  if (current === null || !valid.length) return { available: false, median: null, rank: null, total: valid.length };
  const ordered = [...valid].sort((a, b) => higherIsBetter ? b - a : a - b);
  const medianRows = [...valid].sort((a, b) => a - b);
  const middle = Math.floor(medianRows.length / 2);
  const median = medianRows.length % 2 ? medianRows[middle] : (medianRows[middle - 1] + medianRows[middle]) / 2;
  return { available: true, median, rank: ordered.findIndex((item) => item === current) + 1, total: valid.length, higherIsBetter };
}

export function comparisonMetrics(asset, anomaly) {
  const f = asset?.fundamentals ?? asset?.fund ?? {};
  const scores = f.scores ?? {};
  return {
    price: finite(asset?.price), change: finite(asset?.changepct), score: finite(scores.overall), confidence: finite(scores.confidence),
    pe: finite(f.pe), pb: finite(f.pb), roe: finite(f.roe), growth: finite(f.revenueGrowth), debt: finite(f.netDebtEbitda ?? f.netDebtEbit),
    dividendYield: finite(f.dividendYield ?? f.dy12), volume: finite(asset?.volume), volatility: finite(anomaly?.annualizedVolatilityPct), drawdown: finite(anomaly?.drawdownPct), momentum20: finite(anomaly?.return20Pct),
  };
}

// Usa exclusivamente pregões que existam nas duas séries: nenhuma lacuna é preenchida.
export function synchronizedBenchmarkReturn(assetSeries = [], benchmarkSeries = []) {
  const assetByDate = new Map(assetSeries.filter((row) => finite(row?.close) > 0 && row?.date).map((row) => [row.date, Number(row.close)]));
  const rows = benchmarkSeries.filter((row) => finite(row?.base100) > 0 && assetByDate.has(row?.date)).map((row) => ({ date: row.date, asset: assetByDate.get(row.date), benchmark: Number(row.base100) }));
  if (rows.length < 2) return { available: false, sessions: rows.length, startDate: null, endDate: null, assetReturnPct: null, benchmarkReturnPct: null, relativeReturnPct: null };
  const first = rows[0], last = rows.at(-1);
  const assetReturnPct = (last.asset / first.asset - 1) * 100;
  const benchmarkReturnPct = (last.benchmark / first.benchmark - 1) * 100;
  return { available: true, sessions: rows.length, startDate: first.date, endDate: last.date, assetReturnPct, benchmarkReturnPct, relativeReturnPct: assetReturnPct - benchmarkReturnPct };
}
