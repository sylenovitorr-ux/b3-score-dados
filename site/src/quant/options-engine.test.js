import test from "node:test";
import assert from "node:assert/strict";
import { blackScholes, impliedVolatility, optionDecomposition, strategyAnalysis } from "./options-engine.js";

test("Black-Scholes reproduz referência clássica", () => {
  const result = blackScholes({ type: "call", spot: 100, strike: 100, timeYears: 1, rate: .05, volatility: .2, dividendYield: 0 });
  assert.ok(result.available);
  assert.ok(Math.abs(result.price - 10.4506) < .01);
  assert.ok(Math.abs(result.delta - .6368) < .01);
});

test("IV por bisseção recupera a volatilidade usada no preço", () => {
  const params = { type: "put", spot: 100, strike: 105, timeYears: .5, rate: .1, volatility: .35, dividendYield: .02 };
  const marketPrice = blackScholes(params).price;
  const result = impliedVolatility({ ...params, marketPrice });
  assert.ok(result.converged);
  assert.ok(Math.abs(result.volatility - .35) < 1e-5);
});

test("intrínseco, extrínseco e break-even de call são rastreáveis", () => {
  const result = optionDecomposition({ type: "call", spot: 35, strike: 30, premium: 7 });
  assert.equal(result.intrinsic, 5);
  assert.equal(result.extrinsic, 2);
  assert.equal(result.breakEven, 37);
  assert.equal(result.moneyness, "ITM");
});

test("bull call spread limita ganho e perda", () => {
  const result = strategyAnalysis({ strategy: "bull-call", spot: 30, strike: 30, premium: 3, width: 5, secondPremium: 1, quantity: 100 });
  assert.ok(result.available);
  assert.ok(Math.abs(result.maxLoss + 200) < 1);
  assert.ok(Math.abs(result.maxProfit - 300) < 1);
});
