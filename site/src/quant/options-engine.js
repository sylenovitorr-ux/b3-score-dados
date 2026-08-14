import { clamp, finite } from "./statistics.js";
import { OPTION_MODEL_VERSION, OPTION_SCORE_CONFIG, OPTION_SCORE_METHODOLOGY } from "./options-config.js";

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const pdf = (x) => Math.exp(-.5 * x * x) / SQRT_2PI;
const available = (value) => finite(value) !== null;
const pointsByThreshold = (value, thresholds, fallback = 0) => {
  if (!available(value)) return null;
  for (const [limit, points] of thresholds) if (value <= limit) return points;
  return fallback;
};

export function normalCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + .3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-z * z);
  return .5 * (1 + sign * erf);
}

export function calculateDte(expiration, referenceDate = new Date()) {
  if (!expiration) return { available: false, value: null, reason: "Vencimento indisponível." };
  const end = new Date(`${expiration}T23:59:59Z`);
  const start = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  if (!Number.isFinite(end.getTime()) || !Number.isFinite(start.getTime())) return { available: false, value: null, reason: "Data de vencimento inválida." };
  const value = Math.ceil((end.getTime() - start.getTime()) / 86400000);
  if (value < 0) return { available: false, value, reason: "Contrato vencido." };
  return { available: true, value, referenceDate: start.toISOString(), expiration, formula: "DTE = teto((fim do vencimento UTC − data de referência) ÷ 86.400.000)." };
}

export function blackScholes({ type = "call", spot, strike, timeYears, rate, volatility, dividendYield = 0 }) {
  const S = finite(spot), K = finite(strike), T = finite(timeYears), r = finite(rate), sigma = finite(volatility), q = finite(dividendYield) ?? 0;
  if (!(S > 0 && K > 0 && T > 0 && sigma > 0) || r === null) return { available: false, reason: "Dados insuficientes para calcular Black-Scholes." };
  const d1 = (Math.log(S / K) + (r - q + sigma ** 2 / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const discountedSpot = S * Math.exp(-q * T);
  const discountedStrike = K * Math.exp(-r * T);
  const isCall = type === "call";
  const price = isCall ? discountedSpot * normalCdf(d1) - discountedStrike * normalCdf(d2) : discountedStrike * normalCdf(-d2) - discountedSpot * normalCdf(-d1);
  const delta = isCall ? Math.exp(-q * T) * normalCdf(d1) : Math.exp(-q * T) * (normalCdf(d1) - 1);
  const gamma = Math.exp(-q * T) * pdf(d1) / (S * sigma * Math.sqrt(T));
  const vega = S * Math.exp(-q * T) * pdf(d1) * Math.sqrt(T) / 100;
  const thetaCore = -(S * Math.exp(-q * T) * pdf(d1) * sigma) / (2 * Math.sqrt(T));
  const theta = (isCall ? thetaCore - r * discountedStrike * normalCdf(d2) + q * discountedSpot * normalCdf(d1) : thetaCore + r * discountedStrike * normalCdf(-d2) - q * discountedSpot * normalCdf(-d1)) / 365;
  const rho = (isCall ? K * T * Math.exp(-r * T) * normalCdf(d2) : -K * T * Math.exp(-r * T) * normalCdf(-d2)) / 100;
  return { available: true, origin: "Calculado localmente", model: "Black-Scholes europeu", modelVersion: OPTION_MODEL_VERSION, price, d1, d2, delta, gamma, theta, vega, rho, inputs: { S, K, T, r, sigma, q }, formula: "d1=[ln(S/K)+(r−q+σ²/2)T]/(σ√T); d2=d1−σ√T.", limitation: "Supõe volatilidade e taxa constantes, exercício europeu, liquidez contínua e distribuição lognormal." };
}

export function impliedVolatility({ marketPrice, tolerance = 1e-7, maxIterations = 120, ...params }) {
  const premium = finite(marketPrice), S = finite(params.spot), K = finite(params.strike), T = finite(params.timeYears), r = finite(params.rate), q = finite(params.dividendYield) ?? 0;
  if (!(premium >= 0 && S > 0 && K > 0 && T > 0) || r === null) return { available: false, converged: false, reason: "Dados insuficientes para estimar IV." };
  const discountedSpot = S * Math.exp(-q * T);
  const discountedStrike = K * Math.exp(-r * T);
  const lowerBound = params.type === "put" ? Math.max(discountedStrike - discountedSpot, 0) : Math.max(discountedSpot - discountedStrike, 0);
  const upperBound = params.type === "put" ? discountedStrike : discountedSpot;
  if (premium < lowerBound - tolerance || premium > upperBound + tolerance) return { available: false, converged: false, reason: "Preço fora dos limites de não arbitragem do modelo." };
  let low = .0001, high = 5, mid = null, error = null;
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    mid = (low + high) / 2;
    const result = blackScholes({ ...params, spot: S, strike: K, timeYears: T, rate: r, volatility: mid, dividendYield: q });
    if (!result.available) return { available: false, converged: false, reason: result.reason };
    error = result.price - premium;
    if (Math.abs(error) <= tolerance) return { available: true, origin: "Calculado localmente", converged: true, volatility: mid, iterations: iteration, error, method: "Bisseção no intervalo 0,01%–500% a.a.", inputs: { marketPrice: premium, S, K, T, r, q } };
    if (error > 0) high = mid;
    else low = mid;
  }
  return { available: false, converged: false, volatility: mid, iterations: maxIterations, error, reason: "Não foi possível estimar a volatilidade implícita dentro da tolerância." };
}

export function optionDecomposition({ type = "call", spot, strike, premium, atmTolerancePct = OPTION_SCORE_CONFIG.atmTolerancePct }) {
  const S = finite(spot), K = finite(strike), P = finite(premium);
  if (!(S > 0 && K > 0 && P >= 0)) return { available: false, reason: "Dados insuficientes para calcular." };
  const intrinsic = type === "call" ? Math.max(S - K, 0) : Math.max(K - S, 0);
  const extrinsic = P - intrinsic;
  const distancePct = (K / S - 1) * 100;
  const moneyness = Math.abs(distancePct) <= atmTolerancePct ? "ATM" : type === "call" ? S > K ? "ITM" : "OTM" : S < K ? "ITM" : "OTM";
  const breakEven = type === "call" ? K + P : K - P;
  const breakEvenDistancePct = (breakEven / S - 1) * 100;
  return { available: true, intrinsic, extrinsic, distancePct, moneyness, breakEven, breakEvenDistancePct, atmTolerancePct, rule: `ATM quando |K/S−1| ≤ ${atmTolerancePct}%; fora disso, valor intrínseco define ITM/OTM.`, limitation: "Break-even calculado para o vencimento; antes dele o preço depende também do tempo e da volatilidade." };
}

export function optionMarketMetrics({ bid, ask, volume, openInterest }) {
  const B = finite(bid), A = finite(ask), V = finite(volume), OI = finite(openInterest);
  const validBook = B !== null && A !== null && B >= 0 && A >= B;
  const midpoint = validBook ? (A + B) / 2 : null;
  const spread = validBook ? A - B : null;
  const spreadPct = midpoint > 0 ? spread / midpoint * 100 : null;
  return { bid: B, ask: A, volume: V, openInterest: OI, midpoint, spread, spreadPct, validBook };
}

export function optionLiquidityScore(input, config = OPTION_SCORE_CONFIG) {
  const metrics = optionMarketMetrics(input);
  const spreadPoints = metrics.spreadPct === null ? null : pointsByThreshold(metrics.spreadPct, [[1, 100], [3, 85], [5, 65], [8, 40]], 0);
  const volumePoints = metrics.volume > 0 ? clamp(Math.log10(metrics.volume + 1) / 5 * 100) : metrics.volume === 0 ? 0 : null;
  const openPoints = metrics.openInterest > 0 ? clamp(Math.log10(metrics.openInterest + 1) / 6 * 100) : metrics.openInterest === 0 ? 0 : null;
  const parts = [[spreadPoints, 48], [volumePoints, 28], [openPoints, 24]].filter(([value]) => value !== null);
  const coverage = parts.reduce((sum, [, weight]) => sum + weight, 0);
  const score = coverage ? Math.round(parts.reduce((sum, [value, weight]) => sum + value * weight, 0) / coverage) : null;
  const spreadExcessive = metrics.spreadPct !== null && metrics.spreadPct > config.liquidity.moderateSpreadPct;
  const label = metrics.spreadPct === null ? "Dados insuficientes" : !spreadExcessive && score >= 70 && metrics.volume >= config.liquidity.minimumGoodVolume && metrics.openInterest >= config.liquidity.minimumGoodOpenInterest ? "Boa" : score >= 40 && !spreadExcessive ? "Moderada" : "Baixa";
  const tone = label === "Boa" ? "good" : label === "Moderada" ? "moderate" : label === "Baixa" ? "low" : "unavailable";
  const reasons = [];
  if (metrics.spreadPct === null) reasons.push("bid/ask indisponíveis");
  else if (spreadExcessive) reasons.push("spread elevado");
  else reasons.push("spread dentro do limite configurado");
  if (metrics.volume === null) reasons.push("volume indisponível");
  else if (metrics.volume < config.liquidity.minimumGoodVolume) reasons.push("volume abaixo do critério de boa liquidez");
  if (metrics.openInterest === null) reasons.push("open interest indisponível");
  else if (metrics.openInterest < config.liquidity.minimumGoodOpenInterest) reasons.push("open interest abaixo do critério");
  return { score, coverage, label, tone, reason: `${label}: ${reasons.join("; ")}.`, alert: spreadExcessive ? "Spread elevado; risco de execução e slippage." : null, metrics, formula: "48% spread relativo + 28% volume + 24% open interest. Boa liquidez exige simultaneamente spread, volume e OI dentro dos critérios." };
}

export function strategyPayoffAtExpiration(strategy, underlyingPrice, params) {
  const price = finite(underlyingPrice), spot = finite(params.spot), K = finite(params.strike), premium = finite(params.premium), q = finite(params.quantity) ?? 100, width = finite(params.width), premium2 = finite(params.secondPremium) ?? 0;
  if (!(price >= 0 && spot > 0 && K > 0 && premium >= 0 && q > 0)) return null;
  if (strategy === "long-call") return (Math.max(price - K, 0) - premium) * q;
  if (strategy === "long-put") return (Math.max(K - price, 0) - premium) * q;
  if (strategy === "covered-call") return ((price - spot) + premium - Math.max(price - K, 0)) * q;
  if (strategy === "protective-put") return ((price - spot) - premium + Math.max(K - price, 0)) * q;
  if (!(width > 0)) return null;
  if (strategy === "bull-call") return (Math.max(price - K, 0) - Math.max(price - (K + width), 0) - (premium - premium2)) * q;
  if (strategy === "bear-put") return (Math.max(K - price, 0) - Math.max((K - width) - price, 0) - (premium - premium2)) * q;
  if (strategy === "collar") return ((price - spot) + Math.max((K - width) - price, 0) - premium - Math.max(price - (K + width), 0) + premium2) * q;
  return null;
}

export function strategyAnalysis(params) {
  const values = [params.spot, params.strike, params.premium, params.quantity];
  if (!values.every((value) => finite(value) !== null) || params.spot <= 0 || params.strike <= 0 || params.premium < 0 || params.quantity <= 0) return { available: false, reason: "Dados insuficientes para calcular o payoff." };
  if (["bull-call", "bear-put", "collar"].includes(params.strategy) && !(params.width > 0 && finite(params.secondPremium) !== null)) return { available: false, reason: "A estratégia exige largura entre strikes e prêmio da segunda perna." };
  const minimum = Math.max(.01, params.spot * .35), maximum = params.spot * 1.65;
  const points = Array.from({ length: 81 }, (_, index) => {
    const underlying = minimum + (maximum - minimum) * index / 80;
    return { underlying, payoff: strategyPayoffAtExpiration(params.strategy, underlying, params) };
  });
  const gridProfit = Math.max(...points.map((point) => point.payoff)), gridLoss = Math.min(...points.map((point) => point.payoff));
  const q = params.quantity, debit = (params.premium - (params.secondPremium ?? 0)) * q;
  let maxProfit = gridProfit, maxLoss = gridLoss, breakEven = null, profitUnlimited = false;
  if (params.strategy === "long-call") { maxProfit = null; maxLoss = -params.premium * q; breakEven = params.strike + params.premium; profitUnlimited = true; }
  if (params.strategy === "long-put") { maxProfit = (params.strike - params.premium) * q; maxLoss = -params.premium * q; breakEven = params.strike - params.premium; }
  if (params.strategy === "covered-call") { maxProfit = (params.strike - params.spot + params.premium) * q; maxLoss = -(params.spot - params.premium) * q; breakEven = params.spot - params.premium; }
  if (params.strategy === "protective-put") { maxProfit = null; maxLoss = -(params.spot + params.premium - params.strike) * q; breakEven = params.spot + params.premium; profitUnlimited = true; }
  if (params.strategy === "bull-call") { maxProfit = params.width * q - debit; maxLoss = -debit; breakEven = params.strike + params.premium - (params.secondPremium ?? 0); }
  if (params.strategy === "bear-put") { maxProfit = params.width * q - debit; maxLoss = -debit; breakEven = params.strike - params.premium + (params.secondPremium ?? 0); }
  if (params.strategy === "collar") { breakEven = params.spot + params.premium - (params.secondPremium ?? 0); maxProfit = strategyPayoffAtExpiration("collar", params.strike + params.width, params); maxLoss = strategyPayoffAtExpiration("collar", Math.max(0, params.strike - params.width), params); }
  const capitalRequired = ["covered-call", "protective-put", "collar"].includes(params.strategy) ? params.spot * q + Math.max(0, debit) : Math.max(0, debit);
  const riskReward = maxLoss < 0 && Number.isFinite(maxProfit) ? maxProfit / Math.abs(maxLoss) : null;
  return { available: true, points, maxProfit, maxLoss, gridProfit, gridLoss, profitUnlimited, breakEven, capitalRequired, riskReward, formula: "Payoff no vencimento = soma algébrica do ativo e das pernas de opções, descontados os prêmios.", limitation: "Não inclui corretagem, emolumentos, impostos, exercício antecipado, slippage nem mudança de volatilidade antes do vencimento." };
}

export function buildOptionScore({ contract, decomposition, liquidity, model, implied, historicalVolatilityPct, payoff }, config = OPTION_SCORE_CONFIG) {
  const component = (key, score, max, inputs, explanation) => ({ key, score: score === null ? null : Math.round(clamp(score, 0, max)), max, inputs, explanation, available: score !== null });
  const spreadPct = liquidity?.metrics?.spreadPct;
  const liquidityPoints = spreadPct === null ? null : pointsByThreshold(spreadPct, [[1, 12], [3, 10], [5, 7], [8, 4]], 0) + (contract.volume >= 10000 ? 7 : contract.volume >= 1000 ? 5 : contract.volume >= 100 ? 3 : contract.volume > 0 ? 1 : 0) + (contract.openInterest >= 50000 ? 6 : contract.openInterest >= 5000 ? 4 : contract.openInterest >= 500 ? 2 : contract.openInterest > 0 ? 1 : 0);
  const theoreticalDeviation = model?.available && contract.premium > 0 ? Math.abs(model.price / contract.premium - 1) * 100 : null;
  const ivPct = implied?.available ? implied.volatility * 100 : finite(contract.impliedVolatilityPct);
  const ivHvGap = ivPct !== null && available(historicalVolatilityPct) ? Math.abs(ivPct - historicalVolatilityPct) : null;
  const priceVolatilityPoints = decomposition?.available && decomposition.extrinsic >= 0 && (theoreticalDeviation !== null || ivHvGap !== null) ? (theoreticalDeviation === null ? 0 : pointsByThreshold(theoreticalDeviation, [[10, 12], [25, 8], [50, 4]], 1)) + (ivHvGap === null ? 0 : pointsByThreshold(ivHvGap, [[10, 8], [20, 6], [35, 3]], 1)) + 5 : null;
  const distance = decomposition?.available ? Math.abs(decomposition.distancePct) : null;
  const deltaAbs = model?.available ? Math.abs(model.delta) : finite(contract.delta) === null ? null : Math.abs(contract.delta);
  const strikePoints = distance === null ? null : pointsByThreshold(distance, [[1, 12], [5, 10], [10, 7], [20, 4]], 2) + (deltaAbs === null ? 0 : deltaAbs >= .25 && deltaAbs <= .75 ? 8 : deltaAbs >= .1 && deltaAbs <= .9 ? 5 : 2);
  const dte = finite(contract.dte);
  const thetaBurdenPct = model?.available && contract.premium > 0 ? Math.abs(model.theta) / contract.premium * 100 : null;
  const dtePoints = dte === null ? null : dte < 0 ? 0 : dte <= 7 ? 1 : dte >= config.time.preferredDteMin && dte <= config.time.preferredDteMax ? 10 : dte <= 365 ? 7 : 3;
  const timePoints = dtePoints === null ? null : dtePoints + (thetaBurdenPct === null ? 0 : pointsByThreshold(thetaBurdenPct, [[.5, 5], [1.5, 3], [3, 2]], 1));
  const breakEvenDistance = decomposition?.available ? Math.abs(decomposition.breakEvenDistancePct) : null;
  const rr = payoff?.riskReward;
  const riskReturnPoints = breakEvenDistance === null ? null : pointsByThreshold(breakEvenDistance, [[5, 8], [10, 6], [20, 3]], 1) + (rr === null ? 0 : rr >= 3 ? 7 : rr >= 2 ? 5 : rr >= 1 ? 3 : 1);
  const components = {
    liquidity: component("liquidity", liquidityPoints, 25, { spreadPct, volume: contract.volume, openInterest: contract.openInterest }, OPTION_SCORE_METHODOLOGY.liquidity),
    priceVolatility: component("priceVolatility", priceVolatilityPoints, 25, { theoreticalDeviation, ivPct, historicalVolatilityPct, ivHvGap, extrinsic: decomposition?.extrinsic }, OPTION_SCORE_METHODOLOGY.priceVolatility),
    strike: component("strike", strikePoints, 20, { distancePct: decomposition?.distancePct, moneyness: decomposition?.moneyness, delta: model?.delta ?? contract.delta }, OPTION_SCORE_METHODOLOGY.strike),
    time: component("time", timePoints, 15, { dte, theta: model?.theta ?? contract.theta, thetaBurdenPct }, OPTION_SCORE_METHODOLOGY.time),
    riskReturn: component("riskReturn", riskReturnPoints, 15, { breakEven: decomposition?.breakEven, breakEvenDistancePct: decomposition?.breakEvenDistancePct, riskReward: rr }, OPTION_SCORE_METHODOLOGY.riskReturn),
  };
  const coverage = Object.values(components).reduce((sum, item) => sum + (item.available ? item.max : 0), 0);
  const score = coverage >= config.minimumCoveragePct ? Math.round(Object.values(components).reduce((sum, item) => sum + (item.score ?? 0), 0) / coverage * 100) : null;
  const explanations = [];
  if (liquidity?.label) explanations.push(`Liquidez ${liquidity.label.toLowerCase()}: ${liquidity.reason}`);
  if (decomposition?.available) explanations.push(`Strike ${decomposition.moneyness}, a ${Math.abs(decomposition.distancePct).toFixed(1)}% do spot.`);
  if (ivHvGap !== null) explanations.push(`IV está ${ivPct >= historicalVolatilityPct ? "acima" : "abaixo"} da HV em ${Math.abs(ivHvGap).toFixed(1)} p.p.`);
  if (dte !== null && dte <= config.time.criticalDte) explanations.push("Vencimento muito próximo aumenta o impacto temporal e operacional.");
  return { modelVersion: OPTION_MODEL_VERSION, score, coverage, status: score === null ? "SEM SCORE" : `${score}/100`, reason: score === null ? "Dados insuficientes para avaliação." : explanations.join(" "), components, weights: config.weights, independentFromAssetScore: true };
}

export function analyzeOptionContract(contract, context = {}) {
  const dteResult = contract.expiration ? calculateDte(contract.expiration, context.referenceDate ?? new Date()) : { available: finite(contract.dte) !== null, value: finite(contract.dte), reason: "DTE informado manualmente." };
  const normalized = { ...contract, dte: dteResult.value };
  const decomposition = optionDecomposition({ type: normalized.type, spot: normalized.spot, strike: normalized.strike, premium: normalized.premium });
  const liquidity = optionLiquidityScore(normalized);
  const timeYears = normalized.dte >= 0 ? normalized.dte / 365 : null;
  const model = blackScholes({ type: normalized.type, spot: normalized.spot, strike: normalized.strike, timeYears, rate: normalized.rate, volatility: normalized.volatility, dividendYield: normalized.dividendYield });
  const implied = impliedVolatility({ type: normalized.type, spot: normalized.spot, strike: normalized.strike, timeYears, rate: normalized.rate, marketPrice: normalized.premium, dividendYield: normalized.dividendYield });
  const payoff = strategyAnalysis({ strategy: normalized.strategy ?? (normalized.type === "put" ? "long-put" : "long-call"), spot: normalized.spot, strike: normalized.strike, premium: normalized.premium, quantity: normalized.quantity ?? 100, width: normalized.width, secondPremium: normalized.secondPremium });
  const optionScore = buildOptionScore({ contract: normalized, decomposition, liquidity, model, implied, historicalVolatilityPct: context.historicalVolatilityPct, payoff });
  return { contract: normalized, dte: dteResult, decomposition, liquidity, model, implied, payoff, optionScore, metadata: { contractSource: normalized.source ?? "Informado manualmente pelo usuário", contractUpdatedAt: normalized.updatedAt ?? null, spotSource: context.spotSource ?? "B3 COTAHIST", spotReferenceDate: context.spotReferenceDate ?? null, calculations: "Calculados localmente", modelVersion: OPTION_MODEL_VERSION } };
}
