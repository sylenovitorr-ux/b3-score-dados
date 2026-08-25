import test from "node:test";
import assert from "node:assert/strict";
import { applyIntradayQuotes, normalizeIntraday } from "./intraday.js";

test("fotografia indisponível não substitui fechamento por dado fictício", () => {
  const snapshot = normalizeIntraday({ status: "INDISPONIVEL", quotes: [] });
  assert.equal(snapshot.available, false);
  assert.equal(applyIntradayQuotes([{ ticker: "PETR4", price: 30 }], snapshot)[0].price, 30);
});

test("fotografia válida substitui apenas a cotação explicitamente fornecida", () => {
  const snapshot = normalizeIntraday({ status: "ATUALIZADO", updatedAt: "2026-08-17T12:00:00Z", delayMinutes: 15, quotes: [{ ticker: "PETR4", price: 31, changePct: 2.5, series: [{ asOf: "2026-08-17T11:52:00Z", price: 30.8 }, { asOf: "2026-08-17T12:00:00Z", price: 31 }] }] }, new Date("2026-08-17T12:30:00Z"));
  const assets = applyIntradayQuotes([{ ticker: "PETR4", price: 30, date: "2026-08-15", high: 30.5 }, { ticker: "VALE3", price: 50 }], snapshot);
  assert.equal(assets[0].price, 31);
  assert.equal(assets[0].intraday, true);
  assert.equal(assets[0].intradaySeries.length, 2);
  assert.equal(assets[0].officialPrice, 30);
  assert.equal(assets[0].officialQuoteDate, "2026-08-15");
  assert.equal(assets[1].price, 50);
});

test("arquivo intradiário de outro dia nunca substitui o fechamento oficial", () => {
  const normalized = normalizeIntraday({ status: "ATUALIZADO", updatedAt: "2026-08-17T15:00:00-03:00", quotes: [{ ticker: "PETR4", price: 40 }] }, new Date("2026-08-18T10:00:00-03:00"));
  assert.equal(normalized.available, false);
  assert.match(normalized.reason, /defasado/);
});
