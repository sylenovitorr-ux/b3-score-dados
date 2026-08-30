import { uniqueByIssuer } from "./issuer-key.js";
import { fairValueRange } from "./opportunity-engine.js";

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
const roundPrice = (value) => finite(value) == null ? null : Math.round(Number(value) * 100) / 100;
const round = (value, digits = 2) => finite(value) == null ? null : Math.round(Number(value) * 10 ** digits) / 10 ** digits;
const TRANSACTION_COST_PCT = 0.031;

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

  // Durante o pregão, preserva o último fechamento oficial dentro da série técnica.
  // O preço intradiário entra no plano operacional, não reescreve o histórico B3.
  const official = Boolean(asset?.intraday);
  const price = finite(official ? asset?.officialPrice : asset?.price);
  const date = String(official ? asset?.officialQuoteDate : asset?.date ?? "").slice(0, 10);
  if (date && price != null && price > 0) {
    const prior = byDate.get(date) ?? {};
    byDate.set(date, {
      date,
      open: finite(official ? asset?.officialOpen : asset?.priceopen) ?? prior.open ?? price,
      high: finite(official ? asset?.officialHigh : asset?.high) ?? prior.high ?? price,
      low: finite(official ? asset?.officialLow : asset?.low) ?? prior.low ?? price,
      close: price,
      volume: finite(official ? asset?.officialVolume : asset?.volume) ?? prior.volume ?? null,
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

function atr14(series) {
  if (series.length < 15) return null;
  const ranges = [];
  for (let index = Math.max(1, series.length - 14); index < series.length; index += 1) {
    const row = series[index];
    const priorClose = finite(series[index - 1]?.close);
    const high = finite(row?.high) ?? finite(row?.close);
    const low = finite(row?.low) ?? finite(row?.close);
    if (high == null || low == null || priorClose == null) continue;
    ranges.push(Math.max(high - low, Math.abs(high - priorClose), Math.abs(low - priorClose)));
  }
  return ranges.length >= 10 ? mean(ranges) : null;
}

function localBounds(series, sessions) {
  const lookback = Math.min(series.length, Math.max(20, Math.min(63, sessions)));
  const rows = series.slice(-lookback);
  const lows = rows.map((row) => finite(row.low) ?? finite(row.close)).filter((value) => value != null && value > 0);
  const highs = rows.map((row) => finite(row.high) ?? finite(row.close)).filter((value) => value != null && value > 0);
  return {
    lookback,
    support: lows.length ? Math.min(...lows) : null,
    resistance: highs.length ? Math.max(...highs) : null,
  };
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

function tradePlan(asset, series, months, technical, metrics) {
  const current = finite(asset?.price);
  const atr = atr14(series);
  if (current == null || current <= 0 || atr == null || atr <= 0) return null;
  const sessions = horizonSessions(months);
  const { support, resistance, lookback } = localBounds(series, sessions);
  const maxPullbackPct = ({ 1: 3, 2: 4, 3: 5, 4: 6, 5: 7, 6: 8 })[months] ?? 5;
  const pullbackAtr = ({ 1: .35, 2: .45, 3: .55, 4: .65, 5: .75, 6: .85 })[months] ?? .55;
  const stopAtr = ({ 1: 1.4, 2: 1.6, 3: 1.8, 4: 2, 5: 2.2, 6: 2.4 })[months] ?? 1.8;
  const maxRiskPct = ({ 1: 6, 2: 7, 3: 8, 4: 9, 5: 10, 6: 11 })[months] ?? 8;
  const positiveTrend = technical.ma20 != null && technical.ma50 != null && technical.ma20 >= technical.ma50;
  const ma20Near = technical.ma20 != null && technical.ma20 < current && (current / technical.ma20 - 1) * 100 <= maxPullbackPct + 2;
  const anchor = positiveTrend && ma20Near
    ? Math.max(technical.ma20, current - atr * 1.25)
    : current - atr * pullbackAtr;
  const pullbackFloor = current * (1 - maxPullbackPct / 100);
  const center = Math.min(current, Math.max(pullbackFloor, anchor));
  const entryLow = Math.min(current, Math.max(pullbackFloor, center - atr * .25));
  const entryHigh = Math.max(entryLow, Math.min(current * 1.003, center + atr * .25));
  const entry = (entryLow + entryHigh) / 2;

  const riskFloor = entry * (1 - maxRiskPct / 100);
  const atrStop = entry - atr * stopAtr;
  const supportStop = support != null ? support - atr * .2 : atrStop;
  let stop = Math.max(riskFloor, Math.min(atrStop, supportStop));
  if (!(stop > 0 && stop < entry)) stop = Math.max(entry * (1 - maxRiskPct / 100), entry - atr * stopAtr);
  const grossRisk = entry - stop;
  if (!(grossRisk > 0)) return null;

  const fair = fairValueRange(asset);
  const fairTarget = finite(fair?.base) > entry ? finite(fair.base) : null;
  const resistanceTarget = finite(resistance) > entry ? finite(resistance) : null;
  const anchoredTargets = [resistanceTarget, fairTarget].filter((value) => value != null).sort((a, b) => a - b);
  const fallbackMultiple = ({ 1: 1.6, 2: 1.75, 3: 1.9, 4: 2, 5: 2.1, 6: 2.2 })[months] ?? 1.9;
  const projectedTarget = entry + grossRisk * fallbackMultiple;
  const target1 = anchoredTargets[0] ?? projectedTarget;
  const target2 = anchoredTargets.find((value) => value > target1 * 1.015) ?? Math.max(projectedTarget, target1);

  const costRate = TRANSACTION_COST_PCT / 100;
  const entryCost = entry * costRate;
  const stopCost = stop * costRate;
  const targetCost = target1 * costRate;
  const netRisk = grossRisk + entryCost + stopCost;
  const netReward = Math.max(0, target1 - entry - entryCost - targetCost);
  const riskReward = netRisk > 0 ? netReward / netRisk : null;
  const riskPct = netRisk / entry * 100;
  const rewardPct = netReward / entry * 100;
  const insideEntry = current >= entryLow && current <= entryHigh;
  const invalidated = current <= stop;
  const setupStatus = invalidated ? "invalidado" : insideEntry && (riskReward ?? 0) >= 1.35 ? "na-faixa" : current > entryHigh ? "aguardar-pullback" : "monitorar";

  const reasons = [];
  if (metrics.fundamental >= 75) reasons.push(`Fundamentos fortes (${Math.round(metrics.fundamental)}/100).`);
  else if (metrics.fundamental >= 65) reasons.push(`Fundamentos acima da média (${Math.round(metrics.fundamental)}/100).`);
  if (metrics.valuation >= 65) reasons.push(`Valuation favorável (${Math.round(metrics.valuation)}/100).`);
  if (metrics.momentum >= 65 && positiveTrend) reasons.push(`Momentum favorável com MM20 acima da MM50 (${Math.round(metrics.momentum)}/100).`);
  else if (metrics.momentum >= 65) reasons.push(`Momentum da janela em nível favorável (${Math.round(metrics.momentum)}/100).`);
  if (metrics.risk >= 65) reasons.push(`Risco quantitativo controlado (${Math.round(metrics.risk)}/100).`);
  if (metrics.liquidity >= 70) reasons.push(`Liquidez elevada para execução (${Math.round(metrics.liquidity)}/100).`);
  if (reasons.length < 3 && technical.horizonReturnPct != null) reasons.push(`Retorno de ${months}m em ${round(technical.horizonReturnPct, 1)}%.`);

  const cautions = [];
  if (technical.rsi14 != null && technical.rsi14 >= 72) cautions.push(`RSI14 em ${round(technical.rsi14, 1)}: evitar perseguir preço esticado.`);
  if (metrics.volatility != null && metrics.volatility >= 45) cautions.push(`Volatilidade anualizada elevada (${round(metrics.volatility, 1)}%).`);
  if (metrics.anomalyScore != null && metrics.anomalyScore >= 40) cautions.push(`Anomalia estatística ${Math.round(metrics.anomalyScore)}/100: investigar evento antes da entrada.`);
  if (riskReward != null && riskReward < 1.35) cautions.push(`Risco/retorno líquido de ${round(riskReward, 2)}x é apertado; aguardar preço melhor.`);
  if (current > entryHigh * 1.01) cautions.push(`Preço atual está acima da zona de entrada calculada.`);

  return {
    current: roundPrice(current),
    entry: roundPrice(entry),
    entryLow: roundPrice(entryLow),
    entryHigh: roundPrice(entryHigh),
    stop: roundPrice(stop),
    target: roundPrice(target1),
    target2: roundPrice(target2),
    support: roundPrice(support),
    resistance: roundPrice(resistance),
    fairTarget: roundPrice(fairTarget),
    atr14: roundPrice(atr),
    riskPct: round(riskPct),
    rewardPct: round(rewardPct),
    riskReward: round(riskReward),
    transactionCostPct: TRANSACTION_COST_PCT,
    setupStatus,
    reasons: reasons.slice(0, 4),
    cautions: cautions.slice(0, 4),
    source: "B3 COTAHIST + CVM; níveis derivados pelo B3 Score",
    lookbackSessions: lookback,
    methodology: `Entrada por pullback/média curta, stop por ATR14 + suporte com risco máximo de ${maxRiskPct}%, alvo pela resistência ou valor fundamental disponível. R:R líquido desconta ${TRANSACTION_COST_PCT}% na compra e ${TRANSACTION_COST_PCT}% na venda.`,
  };
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
  const baseScore = availableWeight
    ? Math.round(valid.reduce((sum, [key, weight]) => sum + values[key] * weight, 0) / availableWeight)
    : null;
  const coverage = Math.round(availableWeight);
  if (baseScore == null || coverage < 80) return null;

  const plan = tradePlan(asset, series, months, momentum, { ...values, volatility, anomalyScore });
  const setupScore = plan?.riskReward == null ? 50 : clamp(40 + plan.riskReward * 22);
  const score = Math.round(baseScore * .88 + setupScore * .12);

  return {
    asset,
    horizonMonths: months,
    horizonSessions: sessions,
    score,
    baseScore,
    signal: score >= 72 && (plan?.riskReward ?? 0) >= 1.35 ? "forte" : score >= 62 ? "observar" : "fraco",
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
    tradePlan: plan,
  };
}

export function rankSwingCandidates(assets = [], anomalies = null, horizonMonths = 3) {
  const rows = assets
    .filter((asset) => asset?.kind !== "fii")
    .map((asset) => buildSwingCandidate(asset, anomalies?.assets?.[asset.ticker], horizonMonths))
    .filter(Boolean)
    .sort((a, b) => (b.score - a.score) || ((b.tradePlan?.riskReward ?? -1) - (a.tradePlan?.riskReward ?? -1)) || ((b.liquidity ?? 0) - (a.liquidity ?? 0)) || a.asset.ticker.localeCompare(b.asset.ticker));
  return uniqueByIssuer(rows);
}
