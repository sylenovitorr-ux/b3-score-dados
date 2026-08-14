import test from "node:test";
import assert from "node:assert/strict";
import { formatCompactMoney, formatMoney, formatNumber, formatPercent } from "./formatters.js";

test("formatadores não quebram com dados ausentes ou inválidos", () => {
  assert.equal(formatMoney(undefined), "—");
  assert.equal(formatMoney(Number.NaN), "—");
  assert.equal(formatNumber(null), "—");
  assert.equal(formatCompactMoney(undefined), "—");
  assert.equal(formatPercent(Number.NaN), "—");
});

test("formatadores preservam zero e números válidos", () => {
  assert.match(formatMoney(0), /0,00/);
  assert.equal(formatNumber(12.345, 2), "12,35");
  assert.equal(formatPercent(3.5), "+3,5%");
});
