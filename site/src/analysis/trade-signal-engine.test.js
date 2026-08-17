import { describe, expect, it } from "vitest";
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

describe("buildTradeSignal", () => {
  it("confirma entrada quando há confluência forte e book comprador", () => {
    const signal = buildTradeSignal({
      asset,
      analysis,
      book: { bestBid: 19.99, bestAsk: 20.01, bidVolume: 9000, askVolume: 3000 },
    });
    expect(signal.id).toBe("confirmed");
    expect(signal.bookPressure).toBe(50);
    expect(signal.entryLow).toBe(19.99);
    expect(signal.entryHigh).toBe(20.01);
    expect(signal.stop).toBeLessThan(asset.price);
    expect(signal.target1).toBeGreaterThan(asset.price);
    expect(signal.target2).toBeGreaterThan(signal.target1);
  });

  it("protege a posição quando a pressão vendedora fica forte", () => {
    const signal = buildTradeSignal({
      asset,
      analysis,
      book: { bidVolume: 2000, askVolume: 10000 },
    });
    expect(signal.id).toBe("protect");
    expect(signal.bookPressure).toBeLessThanOrEqual(-30);
  });

  it("não inventa book quando a fonte não fornece profundidade", () => {
    const signal = buildTradeSignal({ asset: { ...asset, intraday: false }, analysis });
    expect(signal.bookPressure).toBeNull();
    expect(signal.bestBid).toBeNull();
    expect(signal.bestAsk).toBeNull();
    expect(signal.sourceStatus).toBe("last_available");
  });
});
