import test from "node:test";
import assert from "node:assert/strict";
import { buildBattleBenchmarkSeries, excessReturn, mergeBenchmarksIntoBattleRows } from "./battle-benchmarks.js";

const payload = { series: {
  IBOV: { status: "ATUALIZADO", referenceDate: "2026-08-25", series: [
    { date: "2026-08-21", value: 100 },
    { date: "2026-08-24", value: 102 },
    { date: "2026-08-25", value: 99 },
  ] },
  CDI: { status: "ATUALIZADO", referenceDate: "2026-08-25", series: [
    { date: "2026-08-21", base100: 100 },
    { date: "2026-08-24", base100: 100.1 },
    { date: "2026-08-25", base100: 100.2 },
  ] },
} };

test("benchmarks usam o último fechamento anterior como base comum", () => {
  const result = buildBattleBenchmarkSeries(payload, "2026-08-24", ["2026-08-24", "2026-08-25"]);
  assert.equal(result.ready, true);
  assert.equal(result.series[0].baselineDate, "2026-08-21");
  assert.ok(Math.abs(result.series[0].returns["2026-08-24"] - 2) < 1e-9);
  assert.ok(Math.abs(result.series[1].returns["2026-08-25"] - .2) < 1e-9);
});

test("cada data do duelo recebe somente benchmarks realmente publicados", () => {
  const benchmarks = buildBattleBenchmarkSeries(payload, "2026-08-24", ["2026-08-24", "2026-08-26"]);
  assert.equal(benchmarks.ready, false);
  const rows = mergeBenchmarksIntoBattleRows([
    { date: "2026-08-24", returns: { mine: 3 } },
    { date: "2026-08-26", returns: { mine: 4 } },
  ], benchmarks);
  assert.ok(Math.abs(rows[0].returns["benchmark-IBOV"] - 2) < 1e-9);
  assert.equal(rows[1].returns["benchmark-IBOV"], null);
  assert.equal(rows[1].returns["benchmark-CDI"], null);
});

test("retorno excedente é medido em pontos percentuais", () => {
  assert.equal(excessReturn(8.2, 5.1), 3.0999999999999996);
  assert.equal(excessReturn(null, 5.1), null);
});
