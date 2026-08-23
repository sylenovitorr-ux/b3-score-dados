import test from "node:test";
import assert from "node:assert/strict";
import { battleEquitySeries, finite, modelPositionCount, nextTradingDate, processOrder } from "./battle-engine.js";

test("ausência não vira zero numérico", () => {
  assert.equal(finite(null), null);
  assert.equal(finite(""), null);
  assert.equal(finite(0), 0);
});

test("disputa sempre começa em pregão posterior ao planejamento", () => {
  assert.equal(nextTradingDate("2026-08-21"), "2026-08-24");
  assert.equal(nextTradingDate("2026-08-24"), "2026-08-25");
});

test("IA usa sempre três ativos a mais que o usuário", () => {
  assert.equal(modelPositionCount(1), 4);
  assert.equal(modelPositionCount(2), 5);
  assert.equal(modelPositionCount(4), 7);
  assert.equal(modelPositionCount(0), 0);
});

test("toque simultâneo em stop e alvo usa política conservadora", () => {
  const order = { ticker: "TEST3", status: "waiting", plannedEntry: 10, stop: 9, target: 11, allocation: 1000, startDate: "2026-08-24" };
  const assetMap = new Map([["TEST3", { ticker: "TEST3" }]]);
  const anomalies = { assets: { TEST3: { series: [{ date: "2026-08-24", open: 10, high: 11.2, low: 8.8, close: 10 }] } } };
  const result = processOrder(order, { status: "running", startDate: "2026-08-24", capital: 1000 }, assetMap, anomalies);
  assert.equal(result.status, "closed");
  assert.equal(result.exitReason, "STOP CONSERVADOR");
  assert.equal(result.pnl, -100);
});

test("curva diária inclui capital parado e marca a posição a mercado", () => {
  const competitor = { id: "mine", capital: 1000, orders: [{ ticker: "TEST3", status: "open", entryDate: "2026-08-24", entryPrice: 10, quantity: 50 }] };
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
  const fractional = processOrder({ ...base, lotSize: 1 }, { status: "running", startDate: "2026-08-24", capital: 1050 }, assetMap, anomalies);
  const standard = processOrder({ ...base, lotSize: 100 }, { status: "running", startDate: "2026-08-24", capital: 1050 }, assetMap, anomalies);
  assert.equal(fractional.quantity, 105);
  assert.equal(standard.quantity, 100);
});

test("ordem fracionária fica limitada a 99 unidades", () => {
  const assetMap = new Map([["TEST3", { ticker: "TEST3" }]]);
  const anomalies = { assets: { TEST3: { series: [{ date: "2026-08-24", open: 10, high: 10, low: 10, close: 10 }] } } };
  const order = { ticker: "TEST3", status: "waiting", plannedEntry: 10, stop: 9, target: 11, allocation: 5000, lotSize: 1, maxQuantity: 99, startDate: "2026-08-24" };
  const result = processOrder(order, { status: "running", startDate: "2026-08-24", capital: 5000 }, assetMap, anomalies);
  assert.equal(result.quantity, 99);
});
