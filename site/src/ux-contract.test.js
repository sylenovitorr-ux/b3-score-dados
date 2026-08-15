import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PRIMARY_NAV } from "./navigation.js";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");

test("navegação principal fica curta sem remover rotas do hub", () => {
  const home = read("./HomeHub.jsx");
  assert.ok(PRIMARY_NAV.length <= 6);
  for (const route of ["compare", "quant", "integrity", "simulator", "methodology"]) assert.match(home, new RegExp(`"${route}"`));
});

test("home explica a diferença entre Radar e Valuation", () => {
  const home = read("./HomeHub.jsx");
  assert.match(home, /Radar responde “o que mudou\?”/);
  assert.match(home, /Valuation responde “o preço faz sentido\?”/);
});

test("estado de carregamento não mostra universo fictício", () => {
  const app = read("./App.jsx");
  assert.doesNotMatch(app, /assets\.length\s*\|\|\s*650/);
  assert.match(app, /loading && !assets\.length \? "—"/);
});

test("valuation extremo expõe sensibilidade e valor bruto preservado", () => {
  const app = read("./App.jsx");
  assert.match(app, /valuation-risk-banner/);
  assert.match(app, /valor justo bruto preservado/);
  assert.match(app, /Teste de sensibilidade/);
});

test("laboratório de opções oferece modelo importável e mantém ausência explícita", () => {
  const options = read("./OptionsLab.jsx");
  assert.match(options, /modelo-mercado-opcoes\.csv/);
  assert.match(options, /ticker;bid;ask;openInterest;referenceDate;source/);
  assert.match(options, /permanecem como Dado indisponível/);
});

test("camada visual mantém foco visível, contraste e tipografia mínima revisada", () => {
  const css = read("./v2.css");
  assert.match(css, /focus-visible/);
  assert.match(css, /valuation-risk-chip/);
  assert.match(css, /font-size:11px!important/);
  assert.match(css, /background-image:none/);
});
