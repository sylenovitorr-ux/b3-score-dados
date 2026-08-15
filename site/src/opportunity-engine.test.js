import test from "node:test";
import assert from "node:assert/strict";
import { buildActionSignal, buildOpportunity, buildPositionPlan, fairValueRange, relativeValuation, valuationRiskAssessment } from "./opportunity-engine.js";

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

test("plano aguarda a faixa quando o preço está acima do valor conservador", () => {
  const row = asset("WAIT3", { price: 30 });
  const plan = buildPositionPlan(row, { dailyVolatilityPct: 2 });
  assert.match(plan.status, /Aguardar/);
  assert.ok(plan.entryHigh < plan.currentPrice);
  assert.ok(plan.defensiveExit < plan.entryLow);
});

test("volatilidade elevada alonga a janela mínima", () => {
  const row = asset("VOLA3", { fundamentals: fundamentals({ scores: { quality: 75, debt: 78, growth: 70, dividends: 60, confidence: 45 } }) });
  assert.equal(buildPositionPlan(row, { dailyVolatilityPct: 4.5 }).horizon, "24–36 meses");
});

test("plano também calcula FII por valor patrimonial", () => {
  const row = { kind: "fii", price: 90, changepct: .5, fund: { navPerShare: 100, scores: { quality: 75, risk: 70, confidence: 80 } } };
  const plan = buildPositionPlan(row, { dailyVolatilityPct: 1.2 });
  assert.ok(plan.fair.base > 0);
  assert.ok(plan.targetHigh > plan.targetBase);
});

test("compra exige desconto, qualidade, confiança e ausência de anomalia", () => {
  const row = asset("BUY3", { price: 12 });
  assert.equal(buildActionSignal(row, [row], { score: 10, dailyVolatilityPct: 2 }).code, "buy");
  assert.notEqual(buildActionSignal(row, [row], { score: 65, dailyVolatilityPct: 2 }).code, "buy");
});

test("preço acima da faixa justa gera realização e não compra", () => {
  const row = asset("SELL3", { price: 40 });
  const signal = buildActionSignal(row, [row], { score: 0, dailyVolatilityPct: 2 });
  assert.equal(signal.code, "realize");
  assert.match(signal.newcomer, /Não comprar/);
});

test("penalidade grave prioriza redução mesmo com desconto", () => {
  const row = asset("RISK3", { price: 5, fundamentals: fundamentals({ history: [{ income: { netIncome: -20 }, cashFlow: { freeCashFlow: -5 } }, { income: { netIncome: -10 }, cashFlow: { freeCashFlow: -8 } }] }) });
  assert.equal(buildActionSignal(row, [row], { score: 0 }).code, "reduce");
});

test("upside extremo não vira sinal favorável sem validação das premissas", () => {
  const row = asset("EXTM3", { price: 2 });
  const result = buildOpportunity(row, [row]);
  assert.ok(result.potential >= 200);
  assert.equal(result.valuationRisk.code, "very-high");
  assert.equal(result.valuationRisk.scoreCap, 49);
  assert.ok(result.score <= 49);
  assert.notEqual(result.signal.label, "Favorável");
  assert.equal(buildActionSignal(row, [row], { score: 0 }).code, "wait");
});

test("avaliação de sensibilidade preserva o valor justo bruto e expõe a fórmula", () => {
  const fair = { low: 24, base: 30, high: 36, anchors: [{ label: "A", value: 28 }, { label: "B", value: 32 }] };
  const result = valuationRiskAssessment({ fair, potential: 50, confidence: 85, fundamental: { coverage: 90, cashFlow: 80 } });
  assert.equal(result.code, "controlled");
  assert.deepEqual(result.sensitivityRange, { low: 24, base: 30, high: 36 });
  assert.match(result.formula, /valor justo bruto não é alterado/);
});

test("modelo de âncora única exige cautela quando o potencial é elevado", () => {
  const fair = { low: 16, base: 20, high: 24, anchors: [{ label: "Única", value: 20 }] };
  const result = valuationRiskAssessment({ fair, potential: 90, confidence: 55, fundamental: { coverage: 60, cashFlow: null } });
  assert.equal(result.blocksPositiveSignal, true);
  assert.ok(result.scoreCap <= 69);
  assert.ok(result.reasons.some((reason) => reason.includes("única âncora")));
});

test("âncora incompatível com a escala do preço não entra no ranking", () => {
  const row = asset("SCAL3", { price: 10, fundamentals: fundamentals({ eps: 1_000, bookValuePerShare: null, ebitdaTTM: null }) });
  assert.equal(fairValueRange(row), null);
  assert.equal(buildOpportunity(row, [row]).fair, null);
  assert.equal(buildActionSignal(row, [row]).code, "unavailable");
});
