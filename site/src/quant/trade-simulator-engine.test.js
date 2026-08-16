import test from "node:test";
import assert from "node:assert/strict";
import { positionSizing, simulateTrade } from "./trade-simulator-engine.js";

test("position sizing respeita risco monetário e limite de posição", () => {
  const result = positionSizing({ capital: 10_000, riskPct: 1, entry: 20, stop: 18, maxPositionPct: 10 });
  assert.equal(result.quantity, 50);
  assert.equal(result.estimatedLoss, 100);
});
test("corretagem zero não elimina a exigência de taxa B3", () => {
  const result = simulateTrade({ quantity: 100, buyPrice: 10, sellPrice: 12, brokerageBuy: 0, brokerageSell: 0 });
  assert.equal(result.values.netFinal, null);
  assert.match(result.limitation, /taxas B3/);
});
test("IRRF é antecipação e não é somado duas vezes ao imposto", () => {
  const result = simulateTrade({ quantity: 100, buyPrice: 10, sellPrice: 12, b3FeesBuy: 1, b3FeesSell: 1, monthlySales: 25_000 });
  assert.equal(result.values.grossTax, 29.7);
  assert.equal(result.values.irrf, 0.06);
  assert.equal(result.values.taxRemaining, 29.64);
});
test("FII não recebe isenção mensal de ações", () => {
  const result = simulateTrade({ assetType: "fii", quantity: 100, buyPrice: 10, sellPrice: 12, b3FeesBuy: 1, b3FeesSell: 1 });
  assert.equal(result.status.exemption, "tributável");
  assert.equal(result.rule.rate, .20);
});
