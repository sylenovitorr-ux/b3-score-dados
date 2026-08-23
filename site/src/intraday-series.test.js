import test from "node:test";
import assert from "node:assert/strict";
import { intradaySummary, normalizeIntradaySeries, snapshotIntradaySeries } from "./intraday-series.js";

test("normaliza todos os pontos de cinco minutos do último pregão", () => {
  const payload = { results: [{ symbol: "PETR4", data: { historicalDataPrice: [
    { date: 1787418000, open: 30, high: 30.2, low: 29.9, close: 30.1 },
    { date: 1787418300, open: 30.1, high: 30.4, low: 30, close: 30.3 },
  ] } }] };
  const rows = normalizeIntradaySeries(payload, "PETR4");
  assert.equal(rows.length, 2);
  assert.equal(rows[1].close, 30.3);
  assert.equal(Math.round(intradaySummary(rows).changePct * 100) / 100, 1);
});

test("snapshot acumulado não transforma ausência em preço zero", () => {
  const rows = snapshotIntradaySeries([{ asOf: "2026-08-21T14:00:00Z", price: null }, { asOf: "2026-08-21T14:08:00Z", price: 25.4 }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].close, 25.4);
});
