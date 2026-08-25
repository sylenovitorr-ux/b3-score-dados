import test from "node:test";
import assert from "node:assert/strict";
import { marketDataHealth } from "./market-health.js";

const anomaly = (date) => ({ quoteDate: date, assets: { PETR4: { lastDate: date, series: Array.from({ length: 30 }, (_, index) => ({ date: `D${index}` })) } } });

test("duelo aceita D-1 oficial dentro da tolerância", () => {
  const health = marketDataHealth([{ ticker: "PETR4", date: "2026-08-24" }], anomaly("2026-08-24"), new Date("2026-08-25T18:00:00Z"));
  assert.equal(health.ready, true);
});

test("duelo recusa fotografia oficial antiga", () => {
  const health = marketDataHealth([{ ticker: "PETR4", date: "2026-08-14" }], anomaly("2026-08-14"), new Date("2026-08-25T18:00:00Z"));
  assert.equal(health.ready, false);
  assert.match(health.reason, /defasada/);
});
