export const scoreLabel = (score) => score == null ? "Dados insuficientes" : score >= 80 ? "Muito forte" : score >= 65 ? "Favorável" : score >= 50 ? "Misto" : score >= 35 ? "Atenção" : "Frágil";
export const scoreTone = (score) => score == null ? "na" : score >= 80 ? "excellent" : score >= 65 ? "good" : score >= 50 ? "mid" : score >= 35 ? "warn" : "bad";
export const confidenceTone = (value) => value >= 80 ? "high" : value >= 60 ? "medium" : "low";
