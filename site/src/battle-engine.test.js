import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_EXECUTION, battleEquitySeries, battlePlanFingerprint, competitorMetrics, finite, historicalTechnicalSnapshot, modelPositionAllocations, modelPositionCount, nextTradingDate, processOrder, replayHistoricalBattle } from "./battle-engine.js";

const noCosts = { transactionCostPct: 0, slippagePct: 0 };

test("ausência não vira zero numérico", () => {
  assert.equal(finite(null), null);
  assert.equal(finite(""), null);
  assert.equal(finite(0), 0);
});

test("modo ao vivo começa em pregão posterior ao planejamento", () => {
  assert.equal(nextTradingDate("2026-08-21"), "2026-08-24");
  assert.equal(nextTradingDate("2026-08-24"), "2026-08-25");
});

test("IA usa sempre dois ativos a mais que o usuário", () => {
  assert.equal(modelPositionCount(1), 3);
  assert.equal(modelPositionCount(2), 4);
  assert.equal(modelPositionCount(4), 6);
  assert.equal(modelPositionCount(0), 0);
});

test("cada ativo da IA usa integralmente o mesmo valor por ativo escolhido pelo usuário", () => {
  assert.deepEqual(modelPositionAllocations(1, 300), [300, 300, 300]);
  assert.deepEqual(modelPositionAllocations(2, 300), [300, 300, 300, 300]);
  assert.deepEqual(modelPositionAllocations(4, 500), [500, 500, 500, 500, 500, 500]);
});

test("toque simultâneo em stop e alvo usa política conservadora", () => {
  const order = { ticker: "TEST3", status: "waiting", plannedEntry: 10, stop: 9, target: 11, allocation: 1000, startDate: "2026-08-24" };
  const assetMap = new Map([["TEST3", { ticker: "TEST3" }]]);
  const anomalies = { assets: { TEST3: { series: [{ date: "2026-08-24", open: 10, high: 11.2, low: 8.8, close: 10 }] } } };
  const result = processOrder(order, { status: "running", startDate: "2026-08-24", capital: 1000, ...noCosts }, assetMap, anomalies);
  assert.equal(result.status, "closed");
  assert.equal(result.exitReason, "STOP CONSERVADOR");
  assert.equal(result.pnl, -100);
});

test("curva diária inclui capital parado e marca a posição a mercado", () => {
  const competitor = { id: "mine", capital: 1000, orders: [{ ticker: "TEST3", status: "open", entryDate: "2026-08-24", entryPrice: 10, quantity: 50, allocation: 1000, ...noCosts }] };
  const battle = { startDate: "2026-08-24", competitors: [competitor] };
  const assetMap = new Map([["TEST3", { ticker: "TEST3" }]]);
  const anomalies = { assets: { TEST3: { series: [{ date: "2026-08-24", close: 10 }, { date: "2026-08-25", close: 11 }] } } };
  const rows = battleEquitySeries(battle, assetMap, anomalies);
  assert.deepEqual(rows.map((row) => row.values.mine), [1000, 1050]);
});

test("execução respeita lote padrão de 100 e fracionário de 1", () => {
  const assetMap = new Map([["TEST3", { ticker: "TEST3" }]]);
  const anomalies = { assets: { TEST3: { series: [{ date: "2026-08-24", open: 10, high: 10, low: 10, close: 10 }] } } };
  const base = { ticker: "TEST3", status: "waiting", plannedEntry: 10, stop: 9, target: 11, allocation: 1050, startDate: "2026-08-24" };
  const fractional = processOrder({ ...base, lotSize: 1 }, { status: "running", startDate: "2026-08-24", capital: 1050, ...noCosts }, assetMap, anomalies);
  const standard = processOrder({ ...base, lotSize: 100 }, { status: "running", startDate: "2026-08-24", capital: 1050, ...noCosts }, assetMap, anomalies);
  assert.equal(fractional.quantity, 105);
  assert.equal(standard.quantity, 100);
});

test("ordem fracionária fica limitada a 99 unidades", () => {
  const assetMap = new Map([["TEST3", { ticker: "TEST3" }]]);
  const anomalies = { assets: { TEST3: { series: [{ date: "2026-08-24", open: 10, high: 10, low: 10, close: 10 }] } } };
  const order = { ticker: "TEST3", status: "waiting", plannedEntry: 10, stop: 9, target: 11, allocation: 5000, lotSize: 1, maxQuantity: 99, startDate: "2026-08-24" };
  const result = processOrder(order, { status: "running", startDate: "2026-08-24", capital: 5000, ...noCosts }, assetMap, anomalies);
  assert.equal(result.quantity, 99);
});

test("gap de entrada e gap de stop executam na abertura, sem preço fictício", () => {
  const order = { ticker: "TEST3", status: "waiting", plannedEntry: 10, stop: 9, target: 13, allocation: 1000, startDate: "2026-08-24" };
  const assetMap = new Map([["TEST3", { ticker: "TEST3" }]]);
  const anomalies = { assets: { TEST3: { series: [
    { date: "2026-08-24", open: 11, high: 11.5, low: 10.8, close: 11 },
    { date: "2026-08-25", open: 8.5, high: 9.2, low: 8, close: 8.8 },
  ] } } };
  const result = processOrder(order, { status: "running", startDate: "2026-08-24", capital: 1000, ...noCosts }, assetMap, anomalies);
  assert.equal(result.marketEntryPrice, 11);
  assert.equal(result.marketExitPrice, 8.5);
  assert.equal(result.exitReason, "STOP · GAP NA ABERTURA");
});

test("custos e slippage são simétricos e reduzem o resultado", () => {
  const order = { ticker: "TEST3", status: "waiting", plannedEntry: 10, stop: 9, target: 11, allocation: 1000, startDate: "2026-08-24" };
  const assetMap = new Map([["TEST3", { ticker: "TEST3" }]]);
  const anomalies = { assets: { TEST3: { series: [{ date: "2026-08-24", open: 10, high: 11, low: 10, close: 11 }] } } };
  const result = processOrder(order, { status: "running", startDate: "2026-08-24", capital: 1000, transactionCostPct: 0.1, slippagePct: 0.1 }, assetMap, anomalies);
  assert.ok(result.pnl < 100);
  assert.ok(result.fees > 0);
  assert.equal(result.executionResolution, "daily-touch");
});

test("nova disputa aplica taxa fixa de 0,031% na compra e na venda sem slippage", () => {
  assert.deepEqual(DEFAULT_EXECUTION, { transactionCostPct: 0.031, slippagePct: 0, ambiguityPolicy: "stop-conservador" });
  const order = { ticker: "TEST3", status: "waiting", plannedEntry: 10, stop: 9, target: 11, allocation: 1000, startDate: "2026-08-24" };
  const assetMap = new Map([["TEST3", { ticker: "TEST3" }]]);
  const anomalies = { assets: { TEST3: { series: [{ date: "2026-08-24", open: 10, high: 11, low: 10, close: 11 }] } } };
  const result = processOrder(order, { status: "running", startDate: "2026-08-24", capital: 1000, ...DEFAULT_EXECUTION }, assetMap, anomalies);
  assert.equal(result.entryFee, 0.31);
  assert.equal(result.exitFee, 0.341);
  assert.ok(Math.abs(result.pnl - 99.349) < 1e-9);
});

test("seleção técnica histórica não lê candles da data inicial nem do futuro", () => {
  const series = Array.from({ length: 35 }, (_, index) => {
    const date = new Date("2026-06-15T12:00:00"); date.setDate(date.getDate() + index);
    return { date: date.toISOString().slice(0, 10), close: 10 + index * .1, low: 9.8 + index * .1, volume: 1500000 };
  });
  const base = { assets: { TEST3: { series } } };
  const withFutureShock = { assets: { TEST3: { series: [...series, { date: "2026-08-05", close: 1, low: 1, volume: 1 }] } } };
  const asset = { ticker: "TEST3", name: "Teste", kind: "stock" };
  const first = historicalTechnicalSnapshot(asset, base, "2026-08-01");
  const second = historicalTechnicalSnapshot(asset, withFutureShock, "2026-08-01");
  assert.equal(first.asset.price, second.asset.price);
  assert.equal(first.score.score, second.score.score);
  assert.equal(first.asset.officialQuoteDate, second.asset.officialQuoteDate);
});

test("replay histórico encerra posição no último candle escolhido", () => {
  const order = { ticker: "TEST3", status: "waiting", plannedEntry: 10, stop: 8, target: 20, allocation: 1000, startDate: "2026-08-20", deadline: "2026-12-20", ...noCosts };
  const assetMap = new Map([["TEST3", { ticker: "TEST3" }]]);
  const anomalies = { assets: { TEST3: { series: [
    { date: "2026-08-20", open: 10, high: 10.5, low: 9.8, close: 10.2 },
    { date: "2026-08-21", open: 10.2, high: 11.2, low: 10.1, close: 11 },
    { date: "2026-08-24", open: 12, high: 13, low: 12, close: 13 },
  ] } } };
  const battle = { status: "running", startDate: "2026-08-20", endDate: "2026-08-21", capital: 1000, ...noCosts, competitors: [{ id: "mine", kind: "mine", orders: [order] }] };
  const result = replayHistoricalBattle(battle, assetMap, anomalies);
  const closed = result.competitors[0].orders[0];
  assert.equal(result.status, "finished");
  assert.equal(closed.exitDate, "2026-08-21");
  assert.equal(closed.exitPrice, 11);
  assert.equal(closed.exitReason, "FIM DO PERÍODO");
});

test("placar oficial usa retorno sobre alocado, não P/L bruto", () => {
  const metrics = competitorMetrics({ capital: 99999, orders: [{ status: "closed", allocation: 300, pnl: 30 }] }, new Map());
  assert.equal(metrics.allocatedCapital, 300);
  assert.equal(metrics.returnPct, 10);
});

test("impressão digital muda somente quando o plano muda", () => {
  const battle = { startDate: "2026-08-24", horizonMonths: 3, marketMode: "fractional", positionAllocation: 300, competitors: [{ kind: "mine", orders: [{ ticker: "PETR4", plannedEntry: 30, stop: 27, target: 36, allocation: 300 }] }] };
  assert.equal(battlePlanFingerprint(battle), battlePlanFingerprint(structuredClone(battle)));
  assert.notEqual(battlePlanFingerprint(battle), battlePlanFingerprint({ ...battle, horizonMonths: 6 }));
});

test("candle do duelo ignora preço intradiário e preserva o fechamento oficial", () => {
  const competitor = { id: "mine", orders: [{ ticker: "TEST3", status: "open", entryDate: "2026-08-24", entryPrice: 10, quantity: 10, allocation: 100, ...noCosts }] };
  const assetMap = new Map([["TEST3", { ticker: "TEST3", intraday: true, date: "2026-08-25", price: 99, officialQuoteDate: "2026-08-24", officialPrice: 10 }]]);
  const rows = battleEquitySeries({ startDate: "2026-08-24", competitors: [competitor] }, assetMap, { assets: {} });
  assert.deepEqual(rows.map((row) => row.values.mine), [100]);
});
