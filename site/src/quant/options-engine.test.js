import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeOptionContract, blackScholes, calculateDte, impliedVolatility,
  optionDecomposition, optionLiquidityScore, optionMarketMetrics,
  strategyAnalysis, strategyPayoffAtExpiration,
} from "./options-engine.js";

test("Black-Scholes reproduz referência clássica", () => {
  const result = blackScholes({ type: "call", spot: 100, strike: 100, timeYears: 1, rate: .05, volatility: .2 });
  assert.ok(result.available);
  assert.ok(Math.abs(result.price - 10.4506) < .01);
  assert.ok(Math.abs(result.delta - .6368) < .01);
});

test("IV por bisseção recupera a volatilidade usada no preço", () => {
  const params = { type: "put", spot: 100, strike: 105, timeYears: .5, rate: .1, volatility: .35, dividendYield: .02 };
  const result = impliedVolatility({ ...params, marketPrice: blackScholes(params).price });
  assert.ok(result.converged);
  assert.ok(Math.abs(result.volatility - .35) < 1e-5);
});

for (const [type, spot, strike, expected] of [
  ["call", 110, 100, "ITM"], ["call", 100.5, 100, "ATM"], ["call", 90, 100, "OTM"],
  ["put", 90, 100, "ITM"], ["put", 100.5, 100, "ATM"], ["put", 110, 100, "OTM"],
]) test(`${type.toUpperCase()} ${expected} usa a regra configurada`, () => {
  assert.equal(optionDecomposition({ type, spot, strike, premium: 12 }).moneyness, expected);
});

test("intrínseco, extrínseco e break-even de CALL", () => {
  const result = optionDecomposition({ type: "call", spot: 35, strike: 30, premium: 7 });
  assert.deepEqual([result.intrinsic, result.extrinsic, result.breakEven], [5, 2, 37]);
});

test("intrínseco, extrínseco e break-even de PUT", () => {
  const result = optionDecomposition({ type: "put", spot: 25, strike: 30, premium: 7 });
  assert.deepEqual([result.intrinsic, result.extrinsic, result.breakEven], [5, 2, 23]);
});

test("DTE é reproduzível com data de referência explícita", () => {
  const result = calculateDte("2026-08-20", new Date("2026-08-14T12:00:00Z"));
  assert.equal(result.value, 7);
  assert.ok(result.available);
});

test("spread absoluto e relativo usam o midpoint", () => {
  const result = optionMarketMetrics({ bid: 1.9, ask: 2.1, volume: 1000, openInterest: 5000 });
  assert.ok(Math.abs(result.spread - .2) < 1e-12);
  assert.ok(Math.abs(result.spreadPct - 10) < 1e-12);
});

test("volume alto não mascara spread excessivo", () => {
  const result = optionLiquidityScore({ bid: 1.8, ask: 2.2, volume: 100000, openInterest: 100000 });
  assert.equal(result.label, "Baixa");
  assert.ok(result.alert);
});

test("payoff de CALL e PUT compradas é exato no vencimento", () => {
  assert.equal(strategyPayoffAtExpiration("long-call", 120, { spot: 100, strike: 100, premium: 5, quantity: 100 }), 1500);
  assert.equal(strategyPayoffAtExpiration("long-put", 80, { spot: 100, strike: 100, premium: 5, quantity: 100 }), 1500);
});

test("bull call spread limita ganho e perda", () => {
  const result = strategyAnalysis({ strategy: "bull-call", spot: 30, strike: 30, premium: 3, width: 5, secondPremium: 1, quantity: 100 });
  assert.ok(result.available);
  assert.equal(result.maxLoss, -200);
  assert.equal(result.maxProfit, 300);
});

test("Option Score completo é separado do score do ativo", () => {
  const result = analyzeOptionContract({ type: "call", spot: 100, strike: 100, premium: 8, dte: 60, rate: .12, volatility: .3, bid: 7.9, ask: 8.1, volume: 5000, openInterest: 10000, quantity: 100 }, { historicalVolatilityPct: 28 });
  assert.ok(Number.isInteger(result.optionScore.score));
  assert.equal(result.optionScore.independentFromAssetScore, true);
  assert.equal(result.optionScore.coverage, 100);
});

test("Option Score não é criado com cobertura insuficiente", () => {
  const result = analyzeOptionContract({ type: "call", spot: 100, strike: 110, premium: 2, dte: 30, quantity: 100 });
  assert.equal(result.optionScore.score, null);
  assert.equal(result.optionScore.reason, "Dados insuficientes para avaliação.");
});

test("entradas inválidas falham sem inventar resultado", () => {
  assert.equal(strategyAnalysis({ strategy: "long-call", spot: null, strike: 100, premium: 5, quantity: 100 }).available, false);
  assert.equal(impliedVolatility({ type: "call", spot: 100, strike: 100, timeYears: 1, rate: .1, marketPrice: 200 }).available, false);
});
