import test from "node:test";
import assert from "node:assert/strict";
import { base100Series, relativePosition } from "./comparison-engine.js";

test("base 100 normaliza preços diferentes sem inventar sessões", () => {
  assert.deepEqual(base100Series([{ date: "a", close: 10 }, { date: "b", close: 12 }]).map((row) => row.value), [100, 120]);
  assert.deepEqual(base100Series([]), []);
});

test("posição relativa respeita o sentido econômico", () => {
  assert.equal(relativePosition(15, [10, 15, 20], true).rank, 2);
  assert.equal(relativePosition(10, [10, 15, 20], false).rank, 1);
  assert.equal(relativePosition(null, [10]).available, false);
});
