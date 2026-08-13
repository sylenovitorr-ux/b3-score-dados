import { clamp, finite } from "./statistics.js";

const SQRT_2PI = Math.sqrt(2 * Math.PI);
const pdf = (x) => Math.exp(-.5 * x * x) / SQRT_2PI;

export function normalCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + .3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-z * z);
  return .5 * (1 + sign * erf);
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
  return { available: true, model: "Black-Scholes europeu", price, d1, d2, delta, gamma, theta, vega, rho, inputs: { S, K, T, r, sigma, q }, formula: "d1=[ln(S/K)+(r−q+σ²/2)T]/(σ√T); d2=d1−σ√T.", limitation: "Supõe volatilidade e taxa constantes, exercício europeu, liquidez contínua e distribuição lognormal." };
}

export function impliedVolatility({ marketPrice, tolerance = 1e-7, maxIterations = 120, ...params }) {
  const premium = finite(marketPrice);
  const intrinsic = params.type === "put" ? Math.max((params.strike ?? 0) - (params.spot ?? 0), 0) : Math.max((params.spot ?? 0) - (params.strike ?? 0), 0);
  const upperBound = params.type === "put" ? params.strike : params.spot;
  if (!(premium >= intrinsic && premium <= upperBound) || !(params.timeYears > 0)) return { available: false, converged: false, reason: "Preço fora dos limites de não arbitragem ou prazo inválido." };
  let low = .0001;
  let high = 5;
  let mid = null;
  let error = null;
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    mid = (low + high) / 2;
    const result = blackScholes({ ...params, volatility: mid });
    if (!result.available) return { available: false, converged: false, reason: result.reason };
    error = result.price - premium;
    if (Math.abs(error) <= tolerance) return { available: true, converged: true, volatility: mid, iterations: iteration, error, method: "Bisseção no intervalo 0,01%–500% a.a." };
    if (error > 0) high = mid;
    else low = mid;
  }
  return { available: false, converged: false, volatility: mid, iterations: maxIterations, error, reason: "Não foi possível estimar a volatilidade implícita dentro da tolerância." };
}

export function optionDecomposition({ type = "call", spot, strike, premium }) {
  if (![spot, strike, premium].every((value) => finite(value) !== null)) return { available: false, reason: "Dados insuficientes para calcular." };
  const intrinsic = type === "call" ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
  const extrinsic = premium - intrinsic;
  const distancePct = strike ? (spot / strike - 1) * 100 : null;
  const moneyness = Math.abs(distancePct ?? Infinity) <= 1 ? "ATM" : type === "call" ? spot > strike ? "ITM" : "OTM" : spot < strike ? "ITM" : "OTM";
  const breakEven = type === "call" ? strike + premium : strike - premium;
  return { available: true, intrinsic, extrinsic, distancePct, moneyness, breakEven, rule: "ATM quando |S/K−1| ≤ 1%; fora disso, valor intrínseco define ITM/OTM." };
}

const payoffAt = (strategy, price, p) => {
  const q = p.quantity ?? 100;
  const K = p.strike;
  const premium = p.premium;
  const K2 = strategy === "bull-call" || strategy === "covered-call" ? K + p.width : K - p.width;
  const premium2 = p.secondPremium ?? 0;
  if (strategy === "long-call") return (Math.max(price - K, 0) - premium) * q;
  if (strategy === "long-put") return (Math.max(K - price, 0) - premium) * q;
  if (strategy === "covered-call") return ((price - p.spot) + premium - Math.max(price - K, 0)) * q;
  if (strategy === "protective-put") return ((price - p.spot) - premium + Math.max(K - price, 0)) * q;
  if (strategy === "bull-call") return (Math.max(price - K, 0) - Math.max(price - K2, 0) - (premium - premium2)) * q;
  if (strategy === "bear-put") return (Math.max(K - price, 0) - Math.max(K2 - price, 0) - (premium - premium2)) * q;
  if (strategy === "collar") return ((price - p.spot) + Math.max(K2 - price, 0) - premium - Math.max(price - (K + p.width), 0) + premium2) * q;
  return null;
};

export function strategyAnalysis(params) {
  const values = [params.spot, params.strike, params.premium, params.quantity];
  if (!values.every((value) => finite(value) !== null) || params.spot <= 0 || params.strike <= 0 || params.premium < 0 || params.quantity <= 0) return { available: false, reason: "Dados insuficientes para calcular o payoff." };
  if (["bull-call", "bear-put", "collar"].includes(params.strategy) && !(params.width > 0 && finite(params.secondPremium) !== null)) return { available: false, reason: "A estratégia exige largura entre strikes e prêmio da segunda perna." };
  const minimum = Math.max(.01, params.spot * .35);
  const maximum = params.spot * 1.65;
  const points = Array.from({ length: 81 }, (_, index) => {
    const underlying = minimum + (maximum - minimum) * index / 80;
    return { underlying, payoff: payoffAt(params.strategy, underlying, params) };
  });
  const payoffs = points.map((point) => point.payoff);
  const maxProfit = Math.max(...payoffs);
  const maxLoss = Math.min(...payoffs);
  let breakEven = null;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous.payoff === 0 || previous.payoff * current.payoff < 0) { breakEven = previous.underlying + (current.underlying - previous.underlying) * Math.abs(previous.payoff) / (Math.abs(previous.payoff) + Math.abs(current.payoff)); break; }
  }
  const capitalRequired = ["covered-call", "protective-put", "collar"].includes(params.strategy) ? params.spot * params.quantity + Math.max(0, params.premium - (params.secondPremium ?? 0)) * params.quantity : Math.max(0, params.premium - (params.secondPremium ?? 0)) * params.quantity;
  const riskReward = maxLoss < 0 && Number.isFinite(maxProfit) ? maxProfit / Math.abs(maxLoss) : null;
  return { available: true, points, maxProfit, maxLoss, breakEven, capitalRequired, riskReward, formula: "Payoff no vencimento = soma algébrica do ativo e das pernas de opções, descontados os prêmios.", limitation: "Não inclui corretagem, emolumentos, impostos, exercício antecipado, slippage nem mudança de volatilidade antes do vencimento." };
}

export function optionLiquidityScore({ volume, openInterest, bid, ask }) {
  const spreadPct = bid > 0 && ask >= bid ? (ask - bid) / ((ask + bid) / 2) * 100 : null;
  const volumeScore = volume > 0 ? clamp((Math.log10(volume + 1) / 5) * 100) : null;
  const openScore = openInterest > 0 ? clamp((Math.log10(openInterest + 1) / 6) * 100) : null;
  const spreadScore = spreadPct === null ? null : clamp(100 - spreadPct * 5);
  const parts = [[volumeScore, 35], [openScore, 35], [spreadScore, 30]].filter(([value]) => value !== null);
  const weight = parts.reduce((sum, [, itemWeight]) => sum + itemWeight, 0);
  return { score: weight ? Math.round(parts.reduce((sum, [value, itemWeight]) => sum + value * itemWeight, 0) / weight) : null, coverage: weight, spreadPct, alert: spreadPct !== null && spreadPct > 8 ? "Spread elevado; risco de execução e slippage." : null, formula: "35% volume + 35% open interest + 30% spread relativo; pesos ausentes são removidos e a cobertura é exibida." };
}
