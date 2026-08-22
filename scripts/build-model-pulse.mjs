#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeAsset } from "../site/src/data/normalize-asset.js";
import { buildQuantAnalysis } from "../site/src/quant/quant-engine.js";
import { buildBuySellScore } from "../site/src/analysis/buy-sell-score.js";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "data/model-pulse.json");
const STRATEGIES = ["swing", "long", "dividends"];

const readJson = (path, fallback = null) => {
  try { return JSON.parse(readFileSync(resolve(ROOT, path), "utf8")); } catch { return fallback; }
};

const stocksRaw = readJson("data/b3-fundamentals.json", []);
const anomalies = readJson("data/market-anomalies.json", { assets: {} });
const previous = readJson("data/model-pulse.json", { history: [] });
const assets = stocksRaw.map(normalizeAsset).filter((asset) => asset.ticker && asset.price > 0);
const officialDate = assets.map((asset) => asset.date).filter(Boolean).sort().at(-1) ?? new Date().toISOString().slice(0, 10);

function rowsFor(strategy) {
  return assets
    .filter((asset) => asset.kind !== "fii" && asset.fundamentals?.scores?.overall != null)
    .map((asset) => {
      const anomaly = anomalies?.assets?.[asset.ticker] ?? null;
      const profile = strategy === "swing" ? "swing_3_6m" : "long_term";
      const analysis = buildQuantAnalysis(asset, assets, anomaly, profile);
      const score = buildBuySellScore({ asset, analysis, strategy });
      return {
        ticker: asset.ticker,
        name: asset.name ?? null,
        price: asset.price,
        score: score.score,
        signal: score.signal,
        confidence: score.confidence,
        parts: Object.fromEntries(score.parts.map((part) => [part.key, part.value])),
      };
    })
    .filter((row) => row.score != null && ["buy", "sell"].includes(row.signal))
    .sort((a, b) => b.score - a.score);
}

const strategies = Object.fromEntries(STRATEGIES.map((strategy) => [strategy, rowsFor(strategy)]));
const snapshot = {
  date: officialDate,
  generatedAt: new Date().toISOString(),
  modelVersion: "b3-score-4.0",
  strategies: Object.fromEntries(STRATEGIES.map((strategy) => [strategy, Object.fromEntries(strategies[strategy].map((row) => [row.ticker, {
    score: row.score,
    signal: row.signal,
    price: row.price,
    confidence: row.confidence,
    parts: row.parts,
  }]))])),
};

const oldHistory = Array.isArray(previous?.history) ? previous.history.filter((row) => row?.date && row?.strategies) : [];
const prior = [...oldHistory].reverse().find((row) => row.date !== officialDate) ?? null;
const events = {};

for (const strategy of STRATEGIES) {
  const rows = strategies[strategy];
  const before = prior?.strategies?.[strategy] ?? {};
  const previousTop4 = Object.entries(before)
    .filter(([, value]) => value?.signal === "buy")
    .sort((a, b) => (b[1].score ?? -1) - (a[1].score ?? -1))
    .slice(0, 4)
    .map(([ticker]) => ticker);
  const currentTop4 = rows.filter((row) => row.signal === "buy").slice(0, 4).map((row) => row.ticker);
  const withDelta = rows.map((row) => ({
    ...row,
    previousScore: before[row.ticker]?.score ?? null,
    previousSignal: before[row.ticker]?.signal ?? null,
    delta: before[row.ticker]?.score == null ? null : row.score - before[row.ticker].score,
  }));
  events[strategy] = {
    newBuys: withDelta.filter((row) => row.signal === "buy" && row.previousSignal === "sell").sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0)).slice(0, 20),
    newSells: withDelta.filter((row) => row.signal === "sell" && row.previousSignal === "buy").sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)).slice(0, 20),
    movers: withDelta.filter((row) => row.delta != null && row.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 20),
    enteredTop4: currentTop4.filter((ticker) => !previousTop4.includes(ticker)),
    leftTop4: previousTop4.filter((ticker) => !currentTop4.includes(ticker)),
    top4: currentTop4,
    buys: rows.filter((row) => row.signal === "buy").length,
    sells: rows.filter((row) => row.signal === "sell").length,
    evaluated: rows.length,
  };
}

const history = [...oldHistory.filter((row) => row.date !== officialDate), snapshot].slice(-400);
const payload = {
  generatedAt: snapshot.generatedAt,
  referenceDate: officialDate,
  previousReferenceDate: prior?.date ?? null,
  modelVersion: snapshot.modelVersion,
  events,
  history,
};

writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`model-pulse: date=${officialDate} history=${history.length} swing=${events.swing.evaluated} long=${events.long.evaluated} dividends=${events.dividends.evaluated}`);
