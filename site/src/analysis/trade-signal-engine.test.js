import test from "node:test";
import assert from "node:assert/strict";
import { buildTradeSignal } from "./trade-signal-engine.js";

const analysis = {
  confidence: 82,
  components: {
    momentum: { value: 74 },
    risk: { value: 67 },
    valuation: { value: 71 },
  },
};

const asset = {
  ticker: "TEST3",
  kind: "stock",
  price: 20,
  priceopen: 19.8,
  high: 20.4,
  low: 19.6,
  closeyest: 19.7,
  changepct: 1.52,
  intraday: true,
  intradayAsOf: "2026-08-17T14:30:00-04:00",
  fundamentals: { scores: { overall: 78, confidence: 85 } },
};

test("retorna COMPRA quando há confluência forte e book comprador", () => {
  const signal = buildTradeSignal({
    asset,
    analysis,
    book: { bestBid: 19.99, bestAsk: 20.01, bidVolume: 9000, askVolume: 3000 },
  });
  assert.equal(signal.id, "buy");
  assert.equal(signal.label, "COMPRA");
  assert.equal(signal.bookPressure, 50);
  assert.equal(signal.entryLow, 19.99);
  assert.equal(signal.entryHigh, 20.01);
  assert.ok(signal.stop < asset.price);
  assert.ok(signal.target1 > asset.price);
  assert.ok(signal.target2 > signal.target1);
});

test("retorna VENDA quando a pressão vendedora fica forte", () => {
  const signal = buildTradeSignal({
    asset,
    analysis,
    book: { bidVolume: 2000, askVolume: 10000 },
  });
  assert.equal(signal.id, "sell");
  assert.equal(signal.label, "VENDA");
  assert.ok(signal.bookPressure <= -30);
});

test("não inventa book quando a fonte não fornece profundidade", () => {
  const signal = buildTradeSignal({ asset: { ...asset, intraday: false }, analysis });
  assert.equal(signal.bookPressure, null);
  assert.equal(signal.bestBid, null);
  assert.equal(signal.bestAsk, null);
  assert.equal(signal.sourceStatus, "last_available");
});
