import test from "node:test";
import assert from "node:assert/strict";
import { buildSwingCandidate, buildTimingScore, trendClassification } from "./swing-engine.js";
const series = (direction = 1, volume = 1_000_000) => Array.from({ length: 260 }, (_, i) => ({ date: new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10), close: 30 + direction * i * .05, volume }));
const rising = series();
const falling = series(-1);
test("tendência positiva exige conjunto de médias e retornos", () => assert.equal(trendClassification(buildTimingScore(rising).snapshot).tone, "positive"));
test("dados insuficientes não viram nota zero", () => { const x = buildTimingScore(rising.slice(-20)); assert.equal(x.score, null); assert.equal(x.state, "Dados insuficientes"); });
test("RSI extremo sinaliza movimento esticado", () => assert.equal(buildTimingScore(rising).state, "Movimento esticado"));
test("tendência negativa é identificada por preços, médias e retornos", () => assert.equal(buildTimingScore(falling).trend.tone, "negative"));
test("movimento de curto prazo extremo é tratado como cautela, não bônus", () => assert.equal(buildTimingScore(rising).stretched, true));
test("score alto com timing ruim explicita o conflito", () => {
  const candidate = buildSwingCandidate({ ticker: "TEST3" }, { score: 88, confidence: 90, components: { liquidity: { value: 80 }, risk: { value: 75 } } }, { series: falling });
  assert.ok(candidate.cautions.some((text) => text.includes("fundamentalmente atrativo")));
});
test("timing forte não transforma qualidade baixa em recomendação", () => {
  const candidate = buildSwingCandidate({ ticker: "TEST3" }, { score: 35, confidence: 90, components: { liquidity: { value: 80 }, risk: { value: 75 } } }, { series: rising });
  assert.notEqual(candidate.state, "Excelente candidato");
});
