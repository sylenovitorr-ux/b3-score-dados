import test from "node:test";
import assert from "node:assert/strict";
import { buildBuySellScore } from "./buy-sell-score.js";

const analysis = { components: { valuation: { value: 80 }, momentum: { value: 75 }, risk: { value: 70 } }, confidence: 90 };

test("score ausente nunca vira VENDA", () => {
  const result = buildBuySellScore({ asset: { kind: "stock", fundamentals: { scores: { overall: null } } }, analysis, strategy: "swing" });
  assert.equal(result.score, null);
  assert.equal(result.signal, "unavailable");
  assert.equal(result.label, "NÃO AVALIÁVEL");
});

test("limiar único mantém 70 como COMPRA e 69 como VENDA", () => {
  const base = { kind: "stock", fundamentals: { scores: { overall: 70, price: 70, confidence: 70 } } };
  const exact = buildBuySellScore({ asset: base, analysis: { components: { valuation: { value: 70 }, momentum: { value: 70 }, risk: { value: 70 } }, confidence: 70 }, strategy: "swing" });
  const below = buildBuySellScore({ asset: { kind: "stock", fundamentals: { scores: { overall: 69, price: 69, confidence: 69 } } }, analysis: { components: { valuation: { value: 69 }, momentum: { value: 69 }, risk: { value: 69 } }, confidence: 69 }, strategy: "swing" });
  assert.equal(exact.signal, "buy");
  assert.equal(below.signal, "sell");
});
