import test from "node:test";
import assert from "node:assert/strict";
import { PROFILE_CONFIG, validateWeights } from "./config.js";
import { datum } from "./data-quality.js";
import { buildQuantAnalysis, technicalSnapshot, valuationConsensus } from "./quant-engine.js";

test("todos os perfis têm pesos auditáveis que somam 100", () => {
  for (const profile of Object.values(PROFILE_CONFIG)) assert.deepEqual(validateWeights(profile), { total: 100, valid: true });
});

test("dado ausente permanece null e nunca vira zero", () => {
  const missing = datum(null, { source: "B3", referenceDate: "2026-08-12" });
  assert.equal(missing.value, null);
  assert.equal(missing.freshness.code, "INDISPONIVEL");
  assert.equal(missing.confidence, 0);
});

test("consenso exclui modelos sem entradas e expõe os pesos", () => {
  const asset = { kind: "stock", price: 20, fundamentals: { eps: 2, bookValuePerShare: 10, sharesOutstanding: null, history: [], referenceDate: "2026-06-30" } };
  const result = valuationConsensus(asset, PROFILE_CONFIG.aggressive);
  assert.equal(result.models.find((model) => model.model === "DCF").available, false);
  assert.ok(result.weighted > 0);
  assert.equal(Object.keys(result.weights).length, 3);
});

test("janela curta não fabrica momentum de 6 ou 12 meses", () => {
  const series = Array.from({ length: 60 }, (_, index) => ({ date: `2026-${String(Math.floor(index / 28) + 1).padStart(2, "0")}-${String(index % 28 + 1).padStart(2, "0")}`, close: 10 + index * .1 }));
  const snapshot = technicalSnapshot(series);
  assert.equal(snapshot.return6m, null);
  assert.equal(snapshot.return12m, null);
  assert.notEqual(snapshot.return1m, null);
});

test("score alto não evita redução de confiança por cobertura", () => {
  const asset = { ticker: "TEST3", kind: "stock", price: 10, date: "2026-08-12", volume: 1_000_000, fundamentals: { referenceDate: "2026-06-30", scores: { price: 90, quality: null, growth: null, debt: null, confidence: 30 }, eps: 1, bookValuePerShare: 5, history: [] } };
  const result = buildQuantAnalysis(asset, [asset], null, "aggressive");
  assert.ok(result.coverage < 50);
  assert.ok(result.confidence < 60);
});
