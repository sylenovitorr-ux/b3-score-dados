const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export function buildBuySellScore({ asset, analysis }) {
  const fundamentals = asset?.kind === "fii" ? asset?.fund ?? {} : asset?.fundamentals ?? {};
  const fundamentalScore = finite(fundamentals?.scores?.overall);
  const valuation = finite(analysis?.components?.valuation?.value ?? fundamentals?.scores?.price);
  const momentum = finite(analysis?.components?.momentum?.value);
  const risk = finite(analysis?.components?.risk?.value);
  const confidence = finite(analysis?.confidence ?? fundamentals?.scores?.confidence);

  const parts = [
    { key: "fundamentals", label: "Fundamentos", value: fundamentalScore, weight: 50 },
    { key: "valuation", label: "Valuation", value: valuation, weight: 20 },
    { key: "momentum", label: "Momentum / timing", value: momentum, weight: 15 },
    { key: "risk", label: "Risco", value: risk, weight: 10 },
    { key: "confidence", label: "Confiança dos dados", value: confidence, weight: 5 },
  ];
  const valid = parts.filter((part) => part.value !== null);
  const availableWeight = valid.reduce((sum, part) => sum + part.weight, 0);
  const score = fundamentalScore === null || !availableWeight
    ? null
    : Math.round(clamp(valid.reduce((sum, part) => sum + part.value * part.weight, 0) / availableWeight));

  return {
    score,
    signal: score !== null && score >= 70 ? "buy" : "sell",
    label: score !== null && score >= 70 ? "COMPRA" : "VENDA",
    tone: score !== null && score >= 70 ? "buy" : "sell",
    fundamentalScore,
    valuation,
    momentum,
    risk,
    confidence,
    availableWeight,
    parts: valid,
    formula: "Nota = Fundamentos 50% + Valuation 20% + Momentum/Timing 15% + Risco 10% + Confiança 5%. Pesos ausentes são renormalizados; fundamentos ausentes impedem nota numérica.",
    threshold: 70,
  };
}
