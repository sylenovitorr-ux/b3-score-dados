import test from "node:test";
import assert from "node:assert/strict";
import { mergePurchaseHolding, validatePortfolioPurchase } from "./portfolio-operations.js";

const stock = { ticker: "PETR4", kind: "stock" };

test("compra Swing exige entrada, stop abaixo e alvo acima", () => {
  const result = validatePortfolioPurchase({ asset: stock, marketMode: "fractional", quantity: 10, entryPrice: 30, entryDate: "2026-08-28", stop: 31, target: 29, strategy: "swing", remainingCapital: 1000 });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 2);
});

test("mercado fracionário aceita 1 a 99 e lote padrão exige múltiplo de 100", () => {
  assert.equal(validatePortfolioPurchase({ asset: stock, marketMode: "fractional", quantity: 99, entryPrice: 10, entryDate: "2026-08-28", stop: 9, target: 12, strategy: "swing", remainingCapital: 1000 }).valid, true);
  assert.equal(validatePortfolioPurchase({ asset: stock, marketMode: "fractional", quantity: 100, entryPrice: 10, entryDate: "2026-08-28", stop: 9, target: 12, strategy: "swing", remainingCapital: 2000 }).valid, false);
  assert.equal(validatePortfolioPurchase({ asset: stock, marketMode: "standard", quantity: 50, entryPrice: 10, entryDate: "2026-08-28", stop: 9, target: 12, strategy: "swing", remainingCapital: 2000 }).valid, false);
});

test("nova compra recalcula preço médio e preserva histórico", () => {
  const merged = mergePurchaseHolding({ ticker: "PETR4", quantity: 10, entryPrice: 20, entryDate: "2026-08-20", operations: [{ id: "a" }], thesis: "tese" }, { ticker: "PETR4", quantity: 20, entryPrice: 25, entryDate: "2026-08-28", operations: [{ id: "b" }], stop: 21, target: 30 });
  assert.equal(merged.quantity, 30);
  assert.equal(merged.entryPrice, 700 / 30);
  assert.equal(merged.entryDate, "2026-08-20");
  assert.deepEqual(merged.operations.map((item) => item.id), ["a", "b"]);
  assert.equal(merged.thesis, "tese");
});
