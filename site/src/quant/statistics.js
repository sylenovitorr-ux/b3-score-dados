export const finite = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
export const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
export const mean = (values) => {
  const clean = values.filter((value) => finite(value) !== null);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
};
export const stdev = (values) => {
  const clean = values.filter((value) => finite(value) !== null);
  if (clean.length < 2) return null;
  const avg = mean(clean);
  return Math.sqrt(clean.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (clean.length - 1));
};
export const quantile = (values, p) => {
  const clean = values.filter((value) => finite(value) !== null).sort((a, b) => a - b);
  if (!clean.length) return null;
  const index = (clean.length - 1) * clamp(p, 0, 1);
  const low = Math.floor(index);
  const fraction = index - low;
  return clean[low + 1] === undefined ? clean[low] : clean[low] + fraction * (clean[low + 1] - clean[low]);
};
export const returnsFromSeries = (series = []) => series.slice(1).map((row, index) => {
  const previous = finite(series[index]?.close);
  const current = finite(row?.close);
  return previous && current ? current / previous - 1 : null;
}).filter((value) => value !== null);

export function maximumDrawdown(series = []) {
  const rows = series.filter((row) => finite(row?.close) !== null);
  if (rows.length < 2) return null;
  let peak = rows[0];
  let trough = rows[0];
  let worst = 0;
  let worstPeak = peak;
  let worstTrough = trough;
  let troughIndex = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.close > peak.close) peak = row;
    const drawdown = row.close / peak.close - 1;
    if (drawdown < worst) {
      worst = drawdown;
      worstPeak = peak;
      worstTrough = row;
      troughIndex = index;
    }
  }
  const recovery = rows.slice(troughIndex + 1).find((row) => row.close >= worstPeak.close);
  return {
    valuePct: worst * 100,
    peak: worstPeak.close,
    peakDate: worstPeak.date,
    trough: worstTrough.close,
    troughDate: worstTrough.date,
    daysToTrough: Math.max(0, rows.indexOf(worstTrough) - rows.indexOf(worstPeak)),
    recovered: Boolean(recovery),
    recoveryDate: recovery?.date ?? null,
    daysToRecovery: recovery ? rows.indexOf(recovery) - rows.indexOf(worstTrough) : null,
  };
}

export function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  const changes = closes.slice(-period - 1).slice(1).map((value, index) => value - closes.slice(-period - 1)[index]);
  const gains = mean(changes.map((value) => Math.max(0, value)));
  const losses = mean(changes.map((value) => Math.max(0, -value)));
  if (losses === 0) return gains === 0 ? 50 : 100;
  return 100 - 100 / (1 + gains / losses);
}
