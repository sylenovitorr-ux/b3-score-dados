import test from "node:test";
import assert from "node:assert/strict";
import { base100Series, relativePosition, synchronizedBenchmarkReturn } from "./comparison-engine.js";

test("base 100 normaliza preços diferentes sem inventar sessões", () => {
  assert.deepEqual(base100Series([{ date: "a", close: 10 }, { date: "b", close: 12 }]).map((row) => row.value), [100, 120]);
  assert.deepEqual(base100Series([]), []);
});

test("posição relativa respeita o sentido econômico", () => {
  assert.equal(relativePosition(15, [10, 15, 20], true).rank, 2);
  assert.equal(relativePosition(10, [10, 15, 20], false).rank, 1);
  assert.equal(relativePosition(null, [10]).available, false);
});

test("benchmark só usa datas efetivamente sincronizadas", () => {
  const result = synchronizedBenchmarkReturn([{ date: "2026-01-02", close: 10 }, { date: "2026-01-03", close: 13 }, { date: "2026-01-06", close: 12 }], [{ date: "2026-01-02", base100: 100 }, { date: "2026-01-06", base100: 110 }]);
  assert.equal(result.sessions, 2);
  assert.ok(Math.abs(result.assetReturnPct - 20) < 1e-9);
  assert.ok(Math.abs(result.benchmarkReturnPct - 10) < 1e-9);
  assert.ok(Math.abs(result.relativeReturnPct - 10) < 1e-9);
});
