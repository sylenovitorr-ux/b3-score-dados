import test from "node:test";
import assert from "node:assert/strict";
import { applyIntradayQuotes, normalizeIntraday } from "./intraday.js";

test("fotografia indisponível não substitui fechamento por dado fictício", () => {
  const snapshot = normalizeIntraday({ status: "INDISPONIVEL", quotes: [] });
  assert.equal(snapshot.available, false);
  assert.equal(applyIntradayQuotes([{ ticker: "PETR4", price: 30 }], snapshot)[0].price, 30);
});

test("fotografia válida substitui apenas a cotação explicitamente fornecida", () => {
  const snapshot = normalizeIntraday({ status: "ATUALIZADO", updatedAt: "2026-08-17T12:00:00Z", delayMinutes: 15, quotes: [{ ticker: "PETR4", price: 31, changePct: 2.5, series: [{ asOf: "2026-08-17T11:52:00Z", price: 30.8 }, { asOf: "2026-08-17T12:00:00Z", price: 31 }] }] });
  const assets = applyIntradayQuotes([{ ticker: "PETR4", price: 30 }, { ticker: "VALE3", price: 50 }], snapshot);
  assert.equal(assets[0].price, 31);
  assert.equal(assets[0].intraday, true);
  assert.equal(assets[0].intradaySeries.length, 2);
  assert.equal(assets[1].price, 50);
});
