import test from "node:test";
import assert from "node:assert/strict";
import { backtestSwingTiming, swingSignalAt } from "./swing-backtest.js";

const series = Array.from({ length: 460 }, (_, index) => ({ date: new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10), close: 20 + index * .04, volume: 1_000_000 }));

test("sinal Swing não lê preços posteriores à data do sinal", () => {
  const baseline = swingSignalAt(series, 250);
  const changed = series.map((row, index) => index > 250 ? { ...row, close: row.close * 50 } : row);
  assert.deepEqual(swingSignalAt(changed, 250), baseline);
});

test("backtest exige janela de formação e retorno futuro completos", () => {
  const result = backtestSwingTiming(series.slice(0, 300), { horizon: 126 });
  assert.equal(result.available, false);
  assert.match(result.reason, /Dados insuficientes/);
});

test("backtest registra retorno posterior sem transformar ausência em dado", () => {
  const result = backtestSwingTiming(series, { horizon: 60 });
  assert.equal(result.available, true);
  assert.equal(result.strategies.length, 4);
  assert.ok(result.strategies.every((strategy) => strategy.samples > 0));
  assert.ok(result.strategies[0].records.every((row) => row.exitDate > row.signalDate));
});
