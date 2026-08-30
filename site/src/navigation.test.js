import test from "node:test";
import assert from "node:assert/strict";
import { parseRoute, routeHash } from "./navigation.js";

test("rotas novas preservam ticker e funcionam no GitHub Pages", () => {
  assert.deepEqual(parseRoute("#/ativo/bbse3"), { page: "asset", ticker: "BBSE3" });
  assert.deepEqual(parseRoute("#/quant/petr4"), { page: "quant", ticker: "PETR4" });
  assert.equal(routeHash("compare"), "#/comparador");
});

test("links legados continuam válidos e falham com segurança", () => {
  assert.deepEqual(parseRoute("#radar-diario"), { page: "radar", ticker: null });
  assert.deepEqual(parseRoute("#opcoes"), { page: "home", ticker: null });
  assert.deepEqual(parseRoute("#qualquer-coisa"), { page: "home", ticker: null });
});

test("gráficos e âncoras antigas nunca viram página não encontrada", () => {
  for (const hash of ["#graficos", "#grafico", "#gráfico", "#/graficos", "#painel-grafico-ativo"]) {
    assert.equal(parseRoute(hash).page, "analyze");
  }
});

test("rota simuladores é aceita como alias do simulador", () => {
  assert.equal(parseRoute("#/simuladores").page, "simulator");
});

test("Ferramentas Avançadas tem rota canônica e aliases", () => {
  assert.equal(parseRoute("#/ferramentas-avancadas").page, "advanced");
  assert.equal(parseRoute("#/avancadas").page, "advanced");
  assert.equal(routeHash("advanced"), "#/ferramentas-avancadas");
});

test("mapa de calor e candidatas de 3–6 meses preservam rotas auditáveis", () => {
  assert.equal(parseRoute("#/mapa-calor").page, "heatmap");
  assert.equal(parseRoute("#/candidatas-6m").page, "swing");
  assert.equal(routeHash("heatmap"), "#/mapa-calor");
});
