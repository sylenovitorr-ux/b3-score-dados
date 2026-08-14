export const OPTION_MODEL_VERSION = "2.0.0";

export const OPTION_SCORE_CONFIG = Object.freeze({
  atmTolerancePct: 1,
  minimumCoveragePct: 70,
  weights: Object.freeze({ liquidity: 25, priceVolatility: 25, strike: 20, time: 15, riskReturn: 15 }),
  liquidity: Object.freeze({ goodSpreadPct: 3, moderateSpreadPct: 8, minimumGoodVolume: 1000, minimumGoodOpenInterest: 5000 }),
  time: Object.freeze({ preferredDteMin: 30, preferredDteMax: 120, criticalDte: 7 }),
});

export const OPTION_SCORE_METHODOLOGY = Object.freeze({
  liquidity: "Até 12 pontos pelo spread, 7 pelo volume e 6 pelo open interest.",
  priceVolatility: "Até 12 pontos pela proximidade entre prêmio e preço teórico, 8 pela relação IV/HV e 5 pela decomposição válida do prêmio.",
  strike: "Até 12 pontos pela distância do strike e 8 pelo Delta calculado.",
  time: "Até 10 pontos pelo DTE e 5 pelo peso diário do Theta sobre o prêmio.",
  riskReturn: "Até 8 pontos pela distância ao break-even e 7 pela assimetria do payoff informado.",
});
