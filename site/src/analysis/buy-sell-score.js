const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

const STRATEGIES = {
  swing: {
    label: "Swing Trade",
    horizon: "2–6 meses",
    parts: [
      ["fundamentals", "Fundamentos", 35],
      ["valuation", "Valuation", 20],
      ["momentum", "Momentum / timing", 30],
      ["risk", "Risco", 10],
      ["confidence", "Confiança dos dados", 5],
    ],
    required: "fundamentals",
  },
  long: {
    label: "Longo Prazo",
    horizon: "anos",
    parts: [
      ["fundamentals", "Fundamentos", 50],
      ["valuation", "Valuation", 20],
      ["growth", "Crescimento", 15],
      ["risk", "Risco", 10],
      ["confidence", "Confiança dos dados", 5],
    ],
    required: "fundamentals",
  },
  dividends: {
    label: "Dividendos",
    horizon: "renda recorrente",
    parts: [
      ["quality", "Qualidade financeira", 35],
      ["dividends", "Dividendos", 35],
      ["valuation", "Valuation", 15],
      ["risk", "Risco", 10],
      ["confidence", "Confiança dos dados", 5],
    ],
    required: "dividends",
  },
};

export function buildBuySellScore({ asset, analysis, strategy = "swing" }) {
  const fundamentals = asset?.kind === "fii" ? asset?.fund ?? {} : asset?.fundamentals ?? {};
  const values = {
    fundamentals: finite(fundamentals?.scores?.overall),
    quality: finite(fundamentals?.scores?.quality),
    growth: finite(fundamentals?.scores?.growth),
    dividends: finite(fundamentals?.scores?.dividends),
    valuation: finite(analysis?.components?.valuation?.value ?? fundamentals?.scores?.price),
    momentum: finite(analysis?.components?.momentum?.value),
    risk: finite(analysis?.components?.risk?.value),
    confidence: finite(analysis?.confidence ?? fundamentals?.scores?.confidence),
  };
  const config = STRATEGIES[strategy] ?? STRATEGIES.swing;
  const parts = config.parts.map(([key, label, weight]) => ({ key, label, value: values[key], weight }));
  const valid = parts.filter((part) => part.value !== null);
  const availableWeight = valid.reduce((sum, part) => sum + part.weight, 0);
  const requiredValue = values[config.required];
  const score = requiredValue === null || !availableWeight
    ? null
    : Math.round(clamp(valid.reduce((sum, part) => sum + part.value * part.weight, 0) / availableWeight));
  const signal = score === null ? "unavailable" : score >= 70 ? "buy" : "sell";
  const label = signal === "buy" ? "COMPRA" : signal === "sell" ? "VENDA" : "NÃO AVALIÁVEL";

  return {
    score,
    signal,
    label,
    tone: signal,
    strategy,
    strategyLabel: config.label,
    horizon: config.horizon,
    fundamentalScore: values.fundamentals,
    quality: values.quality,
    growth: values.growth,
    dividends: values.dividends,
    valuation: values.valuation,
    momentum: values.momentum,
    risk: values.risk,
    confidence: values.confidence,
    coreScore: strategy === "dividends"
      ? (values.dividends == null ? null : Math.round((values.dividends * .55) + ((values.quality ?? values.dividends) * .45)))
      : values.fundamentals,
    availableWeight,
    parts: valid,
    formula: parts.map((part) => `${part.label} ${part.weight}%`).join(" + "),
    threshold: 70,
  };
}

export const BUY_SELL_STRATEGIES = STRATEGIES;
