import test from "node:test";
import assert from "node:assert/strict";
import { buildOpportunity, fairValueRange, relativeValuation } from "./opportunity-engine.js";

const fundamentals = (overrides = {}) => ({ financialCompany: false, eps: 2, bookValuePerShare: 8, roe: 18, roic: 14, netMargin: 12, revenueGrowth: 8, profitGrowth: 7, ebitdaTTM: 1_000, enterpriseValue: 6_000, netDebt: 1_000, sharesOutstanding: 500, equity: 4_000, netDebtEbitda: 1, sector: "Teste", scores: { quality: 75, debt: 78, growth: 70, dividends: 60, confidence: 85 }, history: [{ income: { netIncome: 120 }, cashFlow: { freeCashFlow: 100 } }, { income: { netIncome: 110 }, cashFlow: { freeCashFlow: 90 } }], ...overrides });
const asset = (ticker, overrides = {}) => ({ ticker, kind: "stock", price: 10, fundamentals: fundamentals(), ...overrides });

test("instituição financeira usa modelo próprio e dá maior peso ao patrimônio", () => {
  const result = fairValueRange(asset("BANK3", { fundamentals: fundamentals({ financialCompany: true }) }));
  assert.equal(result.model, "Instituição financeira");
  assert.equal(result.anchors.find((row) => row.label.startsWith("VPA")).effectiveWeight, 70);
});

test("valuation relativo não compara setores diferentes", () => {
  const target = asset("TEST3");
  const otherSectors = Array.from({ length: 8 }, (_, index) => asset(`OUT${index}`, { fundamentals: fundamentals({ sector: "Outro" }) }));
  assert.equal(relativeValuation(target, [target, ...otherSectors]).score, null);
});

test("prejuízo recorrente bloqueia sinal favorável", () => {
  const troubled = asset("LOSS3", { fundamentals: fundamentals({ history: [{ income: { netIncome: -20 }, cashFlow: { freeCashFlow: -5 } }, { income: { netIncome: -10 }, cashFlow: { freeCashFlow: -8 } }] }) });
  const result = buildOpportunity(troubled, [troubled]);
  assert.equal(result.signal.label, "Desfavorável");
  assert.ok(result.penaltyPoints >= 27);
});

test("baixa cobertura limita a classificação", () => {
  const sparse = asset("DATA3", { fundamentals: fundamentals({ sector: null, scores: { quality: 95, debt: null, growth: null, dividends: null, confidence: 90 }, history: [] }) });
  const result = buildOpportunity(sparse, [sparse]);
  assert.ok(result.coverage < 70);
  assert.ok(result.score <= 69);
  assert.ok(result.caps.length > 0);
});
