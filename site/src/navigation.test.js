import test from "node:test";
import assert from "node:assert/strict";
import { parseRoute, routeHash } from "./navigation.js";

test("rotas novas preservam ticker e funcionam no GitHub Pages", () => {
  assert.deepEqual(parseRoute("#/ativo/bbse3"), { page: "asset", ticker: "BBSE3" });
  assert.deepEqual(parseRoute("#/quant/petr4"), { page: "quant", ticker: "PETR4" });
  assert.equal(routeHash("compare"), "#/comparador");
});

test("links legados continuam válidos", () => {
  assert.deepEqual(parseRoute("#radar-diario"), { page: "radar", ticker: null });
  assert.deepEqual(parseRoute("#opcoes"), { page: "options", ticker: null });
  assert.deepEqual(parseRoute("#qualquer-coisa"), { page: "not-found", ticker: null });
});

test("rota simuladores é aceita como alias do simulador", () => {
  assert.equal(parseRoute("#/simuladores").page, "simulator");
});
