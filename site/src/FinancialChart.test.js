import test from "node:test";
import assert from "node:assert/strict";
import { movingAverage } from "./financial-chart-math.js";

test("média móvel não preenche valores inventados", () => {
  assert.deepEqual(movingAverage([{ close: 1 }, { close: 2 }, { close: 3 }], 2), [null, 1.5, 2.5]);
});

test("média móvel mantém observação ausente indisponível", () => {
  assert.deepEqual(movingAverage([{ close: 1 }, { close: null }, { close: 3 }], 2), [null, null, null]);
});
