import test from "node:test";
import assert from "node:assert/strict";
import { lotSizeFor, marketSymbol, matchesAssetSearch, maxQuantityFor, underlyingTicker } from "./battle-market.js";

const assets = [
  { ticker: "PETR4", name: "Petrobras PN", kind: "stock" },
  { ticker: "BPAC11", name: "BTG Pactual Units", kind: "unit" },
  { ticker: "HGLG11", name: "CSHG Logística", kind: "fii" },
];

test("mercado fracionário exibe F para ações e units, mas não para FIIs", () => {
  assert.equal(marketSymbol(assets[0], "fractional"), "PETR4F");
  assert.equal(marketSymbol(assets[1], "fractional"), "BPAC11F");
  assert.equal(marketSymbol(assets[2], "fractional"), "HGLG11");
});

test("lote respeita o mercado escolhido e a regra própria de FII", () => {
  assert.equal(lotSizeFor(assets[0], "fractional"), 1);
  assert.equal(lotSizeFor(assets[0], "standard"), 100);
  assert.equal(lotSizeFor(assets[2], "standard"), 1);
  assert.equal(maxQuantityFor(assets[0], "fractional"), 99);
  assert.equal(maxQuantityFor(assets[2], "fractional"), null);
});

test("busca aceita o código fracionário e resolve para o ativo-base", () => {
  assert.equal(underlyingTicker("petr4f", assets), "PETR4");
  assert.equal(underlyingTicker("HGLG11", assets), "HGLG11");
  assert.equal(matchesAssetSearch(assets[0], "PETR4F", "fractional"), true);
});
