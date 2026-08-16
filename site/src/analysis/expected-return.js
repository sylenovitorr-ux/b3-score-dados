import { fairValueRange } from "../opportunity-engine.js";

const finite = (value) => Number.isFinite(value) ? value : null;
const annualize = (totalPct, months) => totalPct == null || !(months > 0) || totalPct <= -100 ? null : ((1 + totalPct / 100) ** (12 / months) - 1) * 100;

export function annualizedCdi(benchmark, sessionsPerYear = 252) {
  const series = benchmark?.series?.filter((row) => finite(row.base100) != null) ?? [];
  if (series.length < 2) return { value: null, sessions: 0, source: benchmark?.source ?? null, referenceDate: null };
  const start = series[0].base100, end = series.at(-1).base100;
  if (!(start > 0 && end > 0)) return { value: null, sessions: 0, source: benchmark?.source ?? null, referenceDate: null };
  return { value: ((end / start) ** (sessionsPerYear / (series.length - 1)) - 1) * 100, sessions: series.length - 1, source: benchmark?.source ?? null, referenceDate: series.at(-1).date ?? null };
}

export function expectedTotalReturn(asset, benchmarks = null, options = {}) {
  const price = finite(asset?.price), fair = fairValueRange(asset);
  const data = asset?.kind === "fii" ? asset?.fund : asset?.fundamentals;
  const confidence = finite(data?.scores?.confidence);
  const yield12 = finite(asset?.kind === "fii" ? data?.dy12 : data?.dividendYield);
  const horizonMonths = options.horizonMonths ?? (asset?.kind === "fii" ? 12 : 18);
  const appreciationPct = price > 0 && fair?.base > 0 ? (fair.base / price - 1) * 100 : null;
  const incomePct = yield12 == null ? null : yield12 * horizonMonths / 12;
  const totalPct = appreciationPct == null || incomePct == null ? null : ((1 + appreciationPct / 100) * (1 + incomePct / 100) - 1) * 100;
  const annualizedPct = annualize(totalPct, horizonMonths);
  const cdi = annualizedCdi(benchmarks?.series?.CDI);
  const premiumPct = annualizedPct == null || cdi.value == null ? null : annualizedPct - cdi.value;
  const riskScore = finite(data?.scores?.risk ?? data?.scores?.debt);
  const minimumPremiumPct = riskScore == null ? null : riskScore >= 70 ? 2 : riskScore >= 50 ? 4 : 7;
  const premiumAssessment = premiumPct == null || minimumPremiumPct == null || confidence == null ? { status: "insufficient_data", label: "Dados insuficientes para avaliar o prêmio", reason: "prêmio, risco ou confiança indisponíveis" } : confidence < 60 ? { status: "attention", label: "Prêmio exige cautela", reason: "confiança dos dados abaixo de 60%" } : premiumPct >= minimumPremiumPct ? { status: "adequate", label: "Prêmio potencial compatível com o risco configurado", reason: `prêmio de ${premiumPct.toFixed(1)} p.p. versus mínimo de ${minimumPremiumPct.toFixed(1)} p.p.` } : { status: "insufficient", label: "Prêmio potencial pouco atrativo para o risco", reason: `prêmio de ${premiumPct.toFixed(1)} p.p. abaixo do mínimo de ${minimumPremiumPct.toFixed(1)} p.p.` };
  const anchors = fair?.anchors?.map((item) => item.value).filter((value) => value > 0) ?? [];
  const dispersionPct = anchors.length >= 2 && fair?.base > 0 ? (Math.max(...anchors) - Math.min(...anchors)) / fair.base * 100 : null;
  return { status: totalPct == null ? "insufficient_data" : "estimated", appreciationPct, incomePct, totalPct, annualizedPct, horizonMonths, incomeBasis: yield12 == null ? null : "DY observado nos últimos 12 meses; não é promessa de provento futuro.", fairModel: fair?.model ?? null, marginOfSafetyPct: appreciationPct, valuationConfidence: confidence, valuationDispersionPct: dispersionPct, cdi, premiumPct, riskScore, minimumPremiumPct, premiumAssessment, missing: [appreciationPct == null && "valor justo ou preço", yield12 == null && "proventos/rendimentos 12m", cdi.value == null && "série CDI sincronizada"].filter(Boolean), formula: "Retorno total no horizonte = (1 + valorização estimada) × (1 + proventos observados proporcionais ao horizonte) − 1. Anualização = (1 + retorno total)^(12/meses) − 1." };
}
