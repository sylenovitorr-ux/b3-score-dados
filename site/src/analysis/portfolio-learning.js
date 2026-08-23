const finite = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);

export function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function closestOnOrBefore(series, date) {
  if (!Array.isArray(series) || !date) return null;
  let found = null;
  for (const row of series) {
    if (!row?.date || row.date > date) continue;
    if (!found || row.date > found.date) found = row;
  }
  return found;
}

export function benchmarkReturn(series, entryDate, exitDate) {
  const start = closestOnOrBefore(series, entryDate);
  const end = closestOnOrBefore(series, exitDate);
  const a = finite(start?.value ?? start?.base100);
  const b = finite(end?.value ?? end?.base100);
  if (a == null || b == null || a <= 0 || !start || !end || end.date < start.date) return null;
  return (b / a - 1) * 100;
}

export function enrichTradeBenchmarks(trade, benchmarkData) {
  const series = benchmarkData?.series ?? {};
  const ibov = benchmarkReturn(series?.IBOV?.series, trade.entryDate, trade.exitDate);
  const cdiSeries = series?.CDI?.series ?? series?.SELIC?.series ?? series?.CDI_ACUMULADO?.series ?? null;
  const cdi = benchmarkReturn(cdiSeries, trade.entryDate, trade.exitDate);
  const own = finite(trade.returnPct);
  return {
    ...trade,
    benchmarkIbov: ibov,
    benchmarkCdi: cdi,
    alphaIbov: own != null && ibov != null ? own - ibov : null,
    alphaCdi: own != null && cdi != null ? own - cdi : null,
  };
}

const DEFAULT_WEIGHTS = {
  swing: { fundamentals: 35, valuation: 20, momentum: 30, risk: 10, confidence: 5 },
  long: { fundamentals: 50, valuation: 20, growth: 15, risk: 10, confidence: 5 },
  dividends: { quality: 35, dividends: 35, valuation: 15, risk: 10, confidence: 5 },
};

export function learningCalibration(trades = [], strategy = "swing") {
  const usable = trades.filter((trade) => trade.strategy === strategy && finite(trade.returnPct) != null && trade.entryParts && typeof trade.entryParts === "object");
  const defaults = DEFAULT_WEIGHTS[strategy] ?? DEFAULT_WEIGHTS.swing;
  if (usable.length < 20) return { sample: usable.length, ready: false, weights: defaults, defaults, message: `Faltam ${20 - usable.length} operações com componentes registrados para a primeira calibração.` };

  const keys = Object.keys(defaults);
  const raw = {};
  for (const key of keys) {
    const rows = usable.map((trade) => ({ x: finite(trade.entryParts?.[key]), y: finite(trade.returnPct) })).filter((row) => row.x != null && row.y != null);
    if (rows.length < 10) { raw[key] = defaults[key]; continue; }
    const meanX = rows.reduce((sum, row) => sum + row.x, 0) / rows.length;
    const meanY = rows.reduce((sum, row) => sum + row.y, 0) / rows.length;
    const covariance = rows.reduce((sum, row) => sum + (row.x - meanX) * (row.y - meanY), 0);
    const variance = rows.reduce((sum, row) => sum + (row.x - meanX) ** 2, 0);
    const slope = variance > 0 ? covariance / variance : 0;
    const adjustment = Math.max(-.35, Math.min(.35, slope * 7));
    raw[key] = Math.max(3, defaults[key] * (1 + adjustment));
  }
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0) || 100;
  const normalized = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Math.round(value / total * 100)]));
  const drift = 100 - Object.values(normalized).reduce((sum, value) => sum + value, 0);
  const largest = Object.keys(normalized).sort((a, b) => normalized[b] - normalized[a])[0];
  normalized[largest] += drift;
  return { sample: usable.length, ready: true, weights: normalized, defaults, message: "Pesos sugeridos a partir da relação entre componentes registrados na entrada e retorno realizado. Sugestão experimental, não garantia de desempenho futuro." };
}

export function partsObject(score) {
  return Object.fromEntries((score?.parts ?? []).map((part) => [part.key, finite(part.value)]).filter(([, value]) => value != null));
}
