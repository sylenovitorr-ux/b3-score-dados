import test from "node:test";
import assert from "node:assert/strict";
import { b3Holidays, expectedOfficialQuoteDate, isB3TradingDate, nextB3TradingDate, tradingSessionsBetween } from "./market-calendar.js";

test("calendário da B3 respeita fins de semana e feriados de 2026", () => {
  assert.equal(isB3TradingDate("2026-02-16"), false);
  assert.equal(isB3TradingDate("2026-02-17"), false);
  assert.equal(isB3TradingDate("2026-02-18"), true);
  assert.equal(isB3TradingDate("2026-06-04"), false);
  assert.equal(nextB3TradingDate("2026-02-13"), "2026-02-18");
  assert.ok(b3Holidays(2026).has("2026-11-20"));
});

test("defasagem conta pregões, não dias corridos", () => {
  assert.equal(tradingSessionsBetween("2026-08-21", "2026-08-25"), 2);
});

test("fotografia esperada usa D-1 antes do fechamento e D0 depois da consolidação", () => {
  assert.equal(expectedOfficialQuoteDate(new Date("2026-08-25T18:00:00Z")), "2026-08-24");
  assert.equal(expectedOfficialQuoteDate(new Date("2026-08-26T01:30:00Z")), "2026-08-25");
});
