import { overallScoreResult, scoreEligibility } from "./score-eligibility.js";

const weightsFor = (financial) => financial ? { price: 30, quality: 50, debt: 0, dividends: 20 } : { price: 25, quality: 35, debt: 25, dividends: 15 };
export function buildScoreDetails(f, scores) {
  const weights = weightsFor(f.financialCompany), values = { price: scores.price, quality: scores.quality, debt: f.financialCompany ? null : scores.debt, dividends: scores.dividends };
  const inputs = { price: ["P/L", "P/VP", ...(f.financialCompany ? [] : ["EV/EBIT"])], quality: ["ROE", "ROA", ...(f.financialCompany ? [] : ["margens", "crescimento"])], debt: f.financialCompany ? [] : ["dívida líquida/EBIT", "liquidez corrente"], dividends: ["dividend yield", "regularidade e payout"] };
  const rationale = { price: "Compara preço com lucro, patrimônio e resultado operacional.", quality: "Mede rentabilidade, eficiência e evolução dos resultados publicados.", debt: f.financialCompany ? "Não aplicável a bancos: captação faz parte da operação." : "Avalia alavancagem e capacidade de pagamento.", dividends: "Usa proventos e regularidade quando vinculados à fonte." };
  const availableWeight = Object.keys(values).reduce((sum, key) => values[key] == null ? sum : sum + weights[key], 0);
  return Object.fromEntries(Object.keys(values).map((key) => [key, { weight: weights[key], effectiveWeight: values[key] == null || !availableWeight ? 0 : Math.round(weights[key] / availableWeight * 100), score: values[key], inputs: inputs[key], rationale: rationale[key] }]));
}
export function upgradeFundamentals(f) {
  const qualityParts = [f.scores?.quality, f.scores?.growth].filter((value) => value != null);
  const upgradedScores = { ...f.scores, quality: qualityParts.length ? Math.round(qualityParts.reduce((sum, value) => sum + value, 0) / qualityParts.length) : null, debt: f.financialCompany ? null : f.scores?.debt };
  const values = { pe: f.pe, pb: f.pb, evEbit: f.evEbit, roe: f.roe, roa: f.roa, grossMargin: f.grossMargin, ebitMargin: f.ebitMargin, netMargin: f.netMargin, netDebtEbit: f.netDebtEbit, netDebtEbitda: f.netDebtEbitda, currentRatio: f.currentRatio, revenueGrowth: f.revenueGrowth, profitGrowth: f.profitGrowth, eps: f.eps, bookValuePerShare: f.bookValuePerShare, ebitda: f.ebitdaTTM, roic: f.roic };
  const nonApplicable = new Set(f.financialCompany ? ["evEbit", "grossMargin", "ebitMargin", "netMargin", "netDebtEbit", "netDebtEbitda", "currentRatio", "ebitda", "roic"] : []);
  const applicable = f.financialCompany ? ["pe", "pb", "roe", "roa", "revenueGrowth", "profitGrowth"] : ["pe", "pb", "evEbit", "roe", "roa", "netMargin", "netDebtEbit", "currentRatio", "revenueGrowth", "profitGrowth"];
  const available = applicable.filter((key) => values[key] != null).length, coverage = Math.round(available / applicable.length * 100);
  const age = f.referenceDate ? Math.floor((Date.now() - new Date(`${f.referenceDate}T12:00:00`).getTime()) / 864e5) : Infinity;
  const freshness = age <= 150 ? 100 : age <= 210 ? 90 : age <= 300 ? 75 : age <= 450 ? 55 : 25;
  const linkage = f.cnpj && f.cvmCode ? 100 : 85, estimation = f.marketCapEstimated ? 85 : 100;
  const confidence = Math.round(coverage * .55 + freshness * .2 + linkage * .1 + 10 + estimation * .05);
  const metricStates = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, nonApplicable.has(key) ? "not_applicable" : value == null ? "not_found" : f.marketCapEstimated && ["pe", "pb", "evEbit", "eps"].includes(key) ? "estimated" : freshness < 55 ? "stale" : "available"]));
  const base = { ...f, metricStates, confidenceDetails: { coverage, freshness, linkage, consolidation: 100, estimation, available, applicable: applicable.length }, scores: { ...upgradedScores, confidence } };
  const scoreDetails = buildScoreDetails(base, base.scores);
  const weighted = Object.values(scoreDetails).filter((detail) => detail.score != null && detail.effectiveWeight > 0);
  const computedOverall = weighted.length ? Math.round(weighted.reduce((sum, detail) => sum + detail.score * detail.effectiveWeight, 0) / weighted.reduce((sum, detail) => sum + detail.effectiveWeight, 0)) : null;
  const eligibility = scoreEligibility({ kind: "stock", fundamentals: base });
  return { ...base, scores: { ...base.scores, overall: eligibility.eligible ? computedOverall : null }, scoreDetails, overallScore: overallScoreResult({ kind: "stock", fundamentals: base }, { overall: eligibility.eligible ? computedOverall : null }) };
}
export function fallbackMarketScores(asset) {
  const momentum = asset.changepct == null ? null : Math.round(Math.max(10, Math.min(90, 55 + asset.changepct * 5)));
  const liquidity = asset.volume == null ? null : asset.volume >= 1e8 ? 92 : asset.volume >= 2e7 ? 80 : asset.volume >= 5e6 ? 65 : asset.volume >= 1e6 ? 50 : 30;
  return { overall: null, fundamentals: null, valuation: null, momentum, liquidity, confidence: 0, status: "insufficient_data", missing: ["fundamentos", "valuation"] };
}
export function assetOverallScore(asset) { return overallScoreResult(asset, asset.fund?.scores ?? asset.fundamentals?.scores).value; }
