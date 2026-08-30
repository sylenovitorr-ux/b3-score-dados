import { uniqueByIssuer } from "./issuer-key.js";

const finite = (value) => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const mean = (values) => {
  const valid = values.filter((value) => finite(value) !== null).map(Number);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
};
const stdev = (values) => {
  const valid = values.filter((value) => finite(value) !== null).map(Number);
  if (valid.length < 2) return null;
  const avg = mean(valid);
  return Math.sqrt(valid.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (valid.length - 1));
};

export function horizonSessions(months = 3) {
  const normalized = Math.max(1, Math.min(6, Math.round(Number(months) || 3)));
  return normalized * 21;
}

export function technicalSeriesFor(asset, anomaly) {
  const byDate = new Map();
  for (const row of anomaly?.series ?? []) {
    const close = finite(row?.close);
    const date = String(row?.date ?? "").slice(0, 10);
    if (!date || close == null || close <= 0) continue;
    byDate.set(date, {
      date,
      open: finite(row.open) ?? close,
      high: finite(row.high) ?? close,
      low: finite(row.low) ?? close,
      close,
      volume: finite(row.volume),
    });
  }
  const price = finite(asset?.price);
  const date = String(asset?.date ?? "").slice(0, 10);
  if (date && price != null && price > 0) {
    const prior = byDate.get(date) ?? {};
    byDate.set(date, {
      date,
      open: finite(asset?.priceopen) ?? prior.open ?? price,
      high: finite(asset?.high) ?? prior.high ?? price,
      low: finite(asset?.low) ?? prior.low ?? price,
      close: price,
      volume: finite(asset?.volume) ?? prior.volume ?? null,
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function rsi14(closes) {
  if (closes.length < 15) return null;
  let gains = 0;
  let losses = 0;
  for (let index = closes.length - 14; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }
  if (losses === 0) return gains > 0 ? 100 : 50;
  const rs = (gains / 14) / (losses / 14);
  return 100 - (100 / (1 + rs));
}

function returnPct(closes, sessions) {
  if (closes.length <= sessions || closes.at(-1 - sessions) <= 0) return null;
  return (closes.at(-1) / closes.at(-1 - sessions) - 1) * 100;
}

function movingAverage(closes, sessions) {
  if (closes.length < sessions) return null;
  return mean(closes.slice(-sessions));
}

function annualizedVolatility(closes, sessions = 60) {
  if (closes.length < 21) return null;
  const returns = [];
  for (let index = Math.max(1, closes.length - sessions); index < closes.length; index += 1) {
    if (closes[index - 1] > 0) returns.push(closes[index] / closes[index - 1] - 1);
  }
  const deviation = stdev(returns);
  return deviation == null ? null : deviation * Math.sqrt(252) * 100;
}

function maximumDrawdownPct(closes, sessions) {
  const window = closes.slice(-Math.max(21, sessions));
  if (window.length < 2) return null;
  let peak = window[0];
  let worst = 0;
  for (const value of window) {
    peak = Math.max(peak, value);
    if (peak > 0) worst = Math.min(worst, (value / peak - 1) * 100);
  }
  return Math.abs(worst);
}

function momentumScore(closes, months) {
  const sessions = horizonSessions(months);
  const horizonReturn = returnPct(closes, sessions);
  const return20 = returnPct(closes, 20);
  const ma20 = movingAverage(closes, 20);
  const ma50 = movingAverage(closes, 50);
  const trendPct = ma20 != null && ma50 != null && ma50 > 0 ? (ma20 / ma50 - 1) * 100 : null;
  const rsi = rsi14(closes);
  const factor = ({ 1: 2.2, 2: 1.7, 3: 1.35, 4: 1.1, 5: .95, 6: .85 })[months] ?? 1.35;
  const horizonPart = horizonReturn == null ? null : clamp(50 + horizonReturn * factor);
  const recentPart = return20 == null ? null : clamp(50 + return20 * 1.8);
  const trendPart = trendPct == null ? null : clamp(50 + trendPct * 5);
  const rsiPart = rsi == null ? null : rsi >= 78 ? 30 : rsi <= 25 ? 42 : clamp(95 - Math.abs(57 - rsi) * 2.2);
  return {
    value: mean([horizonPart, recentPart, trendPart, rsiPart]),
    horizonReturnPct: horizonReturn,
    return20Pct: return20,
    ma20,
    ma50,
    trendPct,
    rsi14: rsi,
  };
}

function weightConfig(months) {
  const fundamental = ({ 1: 25, 2: 28, 3: 30, 4: 32, 5: 34, 6: 35 })[months] ?? 30;
  const momentum = ({ 1: 35, 2: 32, 3: 30, 4: 28, 5: 26, 6: 25 })[months] ?? 30;
  return { fundamental, valuation: 15, momentum, risk: 15, liquidity: 5, confidence: 5 };
}

export function buildSwingCandidate(asset, anomaly, horizonMonths = 3) {
  if (!asset || asset.kind === "fii") return null;
  const months = Math.max(1, Math.min(6, Math.round(Number(horizonMonths) || 3)));
  const series = technicalSeriesFor(asset, anomaly);
  const closes = series.map((row) => row.close);
  const fundamentals = asset.fundamentals ?? {};
  const fundamental = finite(fundamentals?.scores?.overall);
  if (fundamental == null || closes.length < 30) return null;
  const momentum = momentumScore(closes, months);
  if (momentum.value == null) return null;
  const sessions = horizonSessions(months);
  const volatility = annualizedVolatility(closes, Math.min(60, sessions));
  const drawdown = maximumDrawdownPct(closes, sessions);
  const anomalyScore = finite(anomaly?.score);
  const risk = mean([
    volatility == null ? null : clamp(100 - volatility * 1.15),
    drawdown == null ? null : clamp(100 - drawdown * 1.6),
    anomalyScore == null ? null : clamp(100 - anomalyScore),
  ]);
  const valuation = finite(fundamentals?.scores?.price);
  const confidence = finite(fundamentals?.scores?.confidence);
  const volume = finite(asset.volume);
  const liquidity = volume != null && volume > 0 ? clamp((Math.log10(volume) - 4.5) / 4 * 100) : null;
  if (risk == null || liquidity == null) return null;

  const values = { fundamental, valuation, momentum: momentum.value, risk, liquidity, confidence };
  const weights = weightConfig(months);
  const valid = Object.entries(weights).filter(([key]) => finite(values[key]) !== null);
  const availableWeight = valid.reduce((sum, [, weight]) => sum + weight, 0);
  const score = availableWeight
    ? Math.round(valid.reduce((sum, [key, weight]) => sum + values[key] * weight, 0) / availableWeight)
    : null;
  const coverage = Math.round(availableWeight);
  if (score == null || coverage < 80) return null;

  return {
    asset,
    horizonMonths: months,
    horizonSessions: sessions,
    score,
    signal: score >= 72 ? "forte" : score >= 62 ? "observar" : "fraco",
    fundamental,
    valuation,
    momentum: momentum.value,
    risk,
    liquidity,
    confidence,
    coverage,
    horizonReturnPct: momentum.horizonReturnPct,
    return20Pct: momentum.return20Pct,
    rsi14: momentum.rsi14,
    ma20: momentum.ma20,
    ma50: momentum.ma50,
    trendPct: momentum.trendPct,
    volatilityPct: volatility,
    drawdownPct: drawdown,
    anomalyScore,
    technicalSessions: series.length,
    technicalReferenceDate: series.at(-1)?.date ?? null,
    series,
    weights,
  };
}

export function rankSwingCandidates(assets = [], anomalies = null, horizonMonths = 3) {
  const rows = assets
    .filter((asset) => asset?.kind !== "fii")
    .map((asset) => buildSwingCandidate(asset, anomalies?.assets?.[asset.ticker], horizonMonths))
    .filter(Boolean)
    .sort((a, b) => (b.score - a.score) || ((b.liquidity ?? 0) - (a.liquidity ?? 0)) || a.asset.ticker.localeCompare(b.asset.ticker));
  return uniqueByIssuer(rows);
}
