export const QUANT_MODEL_VERSION = "1.1.0";

const weights = (valuation, quality, growth, profitability, debt, momentum, risk, liquidity, consistency, asymmetry) => ({
  valuation, quality, growth, profitability, debt, momentum, risk, liquidity, consistency, asymmetry,
});

export const PROFILE_CONFIG = Object.freeze({
  swing_3_6m: {
    id: "swing_3_6m", label: "Swing 3–6M",
    // Hipótese inicial: exige validação histórica antes de qualquer conclusão de superioridade.
    weights: weights(15, 10, 10, 8, 5, 25, 15, 7, 3, 2),
    limits: { maxAssetPct: 15, maxSectorPct: 35, drawdownPct: 18, volatilityPct: 45, derivativesPct: 10, minimumDailyVolume: 500_000, minimumRiskReward: 2, safetyMarginPct: 15, holdingSessionsMin: 60, holdingSessionsMax: 126 },
    valuation: { targetPE: 12, targetPB: 1.5, discountRatePct: 12, terminalGrowthPct: 3, explicitGrowthCapPct: 12 },
    hypothesis: "Pesos iniciais para estudo de Swing Trade em 60–126 pregões; regra pendente de validação por backtest.",
  },
  long_term: {
    id: "long_term", label: "Longo Prazo",
    weights: weights(20, 20, 15, 15, 10, 3, 7, 2, 5, 3),
    limits: { maxAssetPct: 15, maxSectorPct: 30, drawdownPct: 30, volatilityPct: 40, derivativesPct: 0, minimumDailyVolume: 300_000, minimumRiskReward: 1.8, safetyMarginPct: 20, holdingSessionsMin: 252, holdingSessionsMax: 1260 },
    valuation: { targetPE: 12, targetPB: 1.6, discountRatePct: 12, terminalGrowthPct: 3, explicitGrowthCapPct: 12 },
    hypothesis: "Perfil estrutural para anos: qualidade, crescimento, rentabilidade e valuation dominam; momentum tem peso apenas auxiliar.",
  },
  conservative: {
    id: "conservative", label: "Conservador",
    weights: weights(18, 18, 8, 14, 14, 4, 12, 5, 4, 3),
    limits: { maxAssetPct: 8, maxSectorPct: 22, drawdownPct: 12, volatilityPct: 22, derivativesPct: 0, minimumDailyVolume: 1_000_000, minimumRiskReward: 2.5, safetyMarginPct: 30 },
    valuation: { targetPE: 10, targetPB: 1.2, discountRatePct: 14, terminalGrowthPct: 2.5, explicitGrowthCapPct: 8 },
  },
  moderate: {
    id: "moderate", label: "Moderado",
    weights: weights(17, 15, 12, 13, 11, 7, 10, 5, 4, 6),
    limits: { maxAssetPct: 12, maxSectorPct: 28, drawdownPct: 20, volatilityPct: 30, derivativesPct: 5, minimumDailyVolume: 600_000, minimumRiskReward: 2.2, safetyMarginPct: 25 },
    valuation: { targetPE: 11, targetPB: 1.4, discountRatePct: 13, terminalGrowthPct: 3, explicitGrowthCapPct: 10 },
  },
  bold: {
    id: "bold", label: "Arrojado",
    weights: weights(16, 13, 14, 12, 9, 9, 9, 5, 5, 8),
    limits: { maxAssetPct: 18, maxSectorPct: 35, drawdownPct: 30, volatilityPct: 40, derivativesPct: 12, minimumDailyVolume: 350_000, minimumRiskReward: 2, safetyMarginPct: 20 },
    valuation: { targetPE: 12, targetPB: 1.6, discountRatePct: 12, terminalGrowthPct: 3, explicitGrowthCapPct: 12 },
  },
  aggressive: {
    id: "aggressive", label: "Agressivo",
    weights: weights(15, 12, 15, 12, 8, 10, 8, 5, 5, 10),
    limits: { maxAssetPct: 25, maxSectorPct: 45, drawdownPct: 40, volatilityPct: 55, derivativesPct: 20, minimumDailyVolume: 200_000, minimumRiskReward: 1.8, safetyMarginPct: 15 },
    valuation: { targetPE: 13, targetPB: 1.8, discountRatePct: 11, terminalGrowthPct: 3, explicitGrowthCapPct: 15 },
  },
});

export const DEFAULT_QUANT_PROFILE = "aggressive";

export function profileConfig(id, overrides = {}) {
  const base = PROFILE_CONFIG[id] ?? PROFILE_CONFIG[DEFAULT_QUANT_PROFILE];
  return {
    ...base,
    limits: { ...base.limits, ...(overrides.limits ?? {}) },
    valuation: { ...base.valuation, ...(overrides.valuation ?? {}) },
    weights: { ...base.weights, ...(overrides.weights ?? {}) },
  };
}

export function validateWeights(profile) {
  const total = Object.values(profile.weights).reduce((sum, value) => sum + value, 0);
  return { total, valid: Math.abs(total - 100) < 1e-9 };
}
