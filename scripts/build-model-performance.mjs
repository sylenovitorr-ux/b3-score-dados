#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "data/model-performance.json");
const HORIZONS = [20, 60, 120];
const STRATEGIES = ["swing", "long", "dividends"];

const readJson = (path, fallback = null) => {
  try { return JSON.parse(readFileSync(resolve(ROOT, path), "utf8")); } catch { return fallback; }
};
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const round = (value, digits = 2) => value == null ? null : Number(value.toFixed(digits));

const pulse = readJson("data/model-pulse.json", { history: [] });
const anomalies = readJson("data/market-anomalies.json", { assets: {} });
const history = Array.isArray(pulse?.history) ? pulse.history : [];

function outcomeFor(ticker, snapshotDate, entryPrice, horizon) {
  const series = anomalies?.assets?.[ticker]?.series;
  if (!Array.isArray(series) || !series.length) return null;
  let index = series.findIndex((row) => row?.date === snapshotDate);
  if (index < 0) {
    for (let i = series.length - 1; i >= 0; i -= 1) {
      if (String(series[i]?.date ?? "") <= snapshotDate) { index = i; break; }
    }
  }
  if (index < 0 || index + horizon >= series.length) return null;
  const base = finite(entryPrice) ?? finite(series[index]?.close);
  const exit = finite(series[index + horizon]?.close);
  if (!(base > 0) || !(exit > 0)) return null;
  return {
    exitDate: series[index + horizon].date,
    exitPrice: exit,
    returnPct: (exit / base - 1) * 100,
  };
}

function scoreBand(score) {
  if (score >= 85) return "85+";
  if (score >= 80) return "80–84";
  if (score >= 75) return "75–79";
  if (score >= 70) return "70–74";
  if (score >= 60) return "60–69";
  return "0–59";
}

function summarise(rows) {
  const buys = rows.filter((row) => row.signal === "buy");
  const sells = rows.filter((row) => row.signal === "sell");
  const buyReturns = buys.map((row) => row.returnPct);
  const sellReturns = sells.map((row) => row.returnPct);
  return {
    sample: rows.length,
    buySample: buys.length,
    sellSample: sells.length,
    buyPositiveRatePct: buys.length ? round(buys.filter((row) => row.returnPct > 0).length / buys.length * 100, 1) : null,
    buyAverageReturnPct: round(mean(buyReturns)),
    buyMedianReturnPct: buys.length ? round([...buyReturns].sort((a, b) => a - b)[Math.floor(buyReturns.length / 2)]) : null,
    sellNonPositiveRatePct: sells.length ? round(sells.filter((row) => row.returnPct <= 0).length / sells.length * 100, 1) : null,
    sellAverageFollowingReturnPct: round(mean(sellReturns)),
  };
}

const observations = [];
for (const snapshot of history) {
  if (!snapshot?.date || !snapshot?.strategies) continue;
  for (const strategy of STRATEGIES) {
    for (const [ticker, signal] of Object.entries(snapshot.strategies[strategy] ?? {})) {
      const score = finite(signal?.score);
      if (score == null || !["buy", "sell"].includes(signal?.signal)) continue;
      for (const horizon of HORIZONS) {
        const outcome = outcomeFor(ticker, snapshot.date, signal.price, horizon);
        if (!outcome) continue;
        observations.push({
          snapshotDate: snapshot.date,
          strategy,
          ticker,
          signal: signal.signal,
          score,
          scoreBand: scoreBand(score),
          horizon,
          entryPrice: signal.price ?? null,
          ...outcome,
        });
      }
    }
  }
}

const strategies = {};
for (const strategy of STRATEGIES) {
  strategies[strategy] = {};
  for (const horizon of HORIZONS) {
    const rows = observations.filter((row) => row.strategy === strategy && row.horizon === horizon);
    const bands = {};
    for (const band of ["85+", "80–84", "75–79", "70–74", "60–69", "0–59"]) {
      const bandRows = rows.filter((row) => row.scoreBand === band);
      if (bandRows.length) bands[band] = summarise(bandRows);
    }
    strategies[strategy][`${horizon}s`] = { ...summarise(rows), bands };
  }
}

const payload = {
  generatedAt: new Date().toISOString(),
  modelVersion: pulse?.modelVersion ?? "b3-score-4.0",
  firstSnapshotDate: history[0]?.date ?? null,
  lastSnapshotDate: history.at(-1)?.date ?? null,
  snapshotCount: history.length,
  evaluatedObservations: observations.length,
  methodology: "Placar prospectivo. Cada fotografia usa o sinal que foi efetivamente registrado naquele pregão e mede o preço 20, 60 ou 120 sessões depois. Não cria sinais históricos retroativos.",
  caveats: [
    "COMPRA é avaliada pela frequência de retorno positivo e retorno médio posterior.",
    "VENDA representa evitar/sair, não recomendação de venda a descoberto; o painel apenas mede o retorno que ocorreu depois do sinal.",
    "Amostras pequenas não demonstram poder preditivo. Resultados passados não garantem resultados futuros.",
  ],
  horizons: HORIZONS,
  strategies,
};

writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`model-performance: snapshots=${history.length} observations=${observations.length}`);
