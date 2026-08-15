import test from "node:test";
import assert from "node:assert/strict";
import { classifyEvidence, detectMovement, explainPrice, normalizeEvents, periodReturn, scenarioBands } from "./context-engine.js";

const series = Array.from({ length: 30 }, (_, index) => ({ date: `2026-07-${String(index + 1).padStart(2, "0")}`, close: 100 + index, volume: index === 29 ? 3_000 : 1_000, open: 99 + index }));

test("retornos por período são reproduzíveis e ausência não vira zero", () => {
  assert.equal(periodReturn(series, 5), (129 / 124 - 1) * 100);
  assert.equal(periodReturn(series.slice(0, 3), 5), null);
});

test("detector separa movimento relevante de oscilação comum", () => {
  const result = detectMovement({ series, returnZ: 3.1, annualizedVolatilityPct: 22 });
  assert.equal(result.relevant, true);
  assert.ok(result.volumeVsAverage20Pct > 100);
  assert.equal(result.relativeToBenchmark5Pct, null);
});

test("relevância direta supera notícia genérica e não afirma causalidade", () => {
  const asset = { ticker: "PETR4", name: "Petrobras", fundamentals: { companyName: "Petrobras", sector: "Petróleo" } };
  const direct = classifyEvidence({ title: "PETR4 divulga lucro recorde", domain: "Reuters", seenDate: "2026-08-14" }, asset, new Date("2026-08-15"));
  const generic = classifyEvidence({ title: "Bolsa tem sessão tranquila", domain: "Blog", seenDate: "2026-08-14" }, asset, new Date("2026-08-15"));
  assert.ok(direct.relevance > generic.relevance);
  assert.match(direct.causality, /não comprovada/i);
});

test("eventos oficiais preservam retornos indisponíveis", () => {
  const asset = { ticker: "TEST3", fundamentals: { dividendEvents: [{ type: "DIVIDENDO", valuePerShare: 1, approvedAt: "2026-07-29", source: "B3" }] } };
  const [event] = normalizeEvents(asset, { series }, null, new Date("2026-08-15"));
  assert.equal(event.relevance, 100);
  assert.equal(event.returnAfter20Pct, null);
});

test("justificativa e cenários mantêm faixas e limitações", () => {
  const analysis = { levels: { fair: 120 }, components: { momentum: { value: 40 }, risk: { value: 45 } }, valuation: { scenarios: [{ id: "base", value: 120 }] }, risk: { volatility60Pct: 30 } };
  const explanation = explainPrice({ price: 80, fundamentals: { scores: { quality: 75 }, roe: 18, netDebtEbitda: 1.5 } }, analysis, []);
  assert.equal(explanation.state.tone, "divergent");
  const [band] = scenarioBands(analysis);
  assert.ok(band.low < band.value && band.high > band.value);
});
