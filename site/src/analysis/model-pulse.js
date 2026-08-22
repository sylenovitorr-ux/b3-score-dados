import { buildQuantAnalysis } from "../quant/quant-engine.js";
import { buildBuySellScore } from "./buy-sell-score.js";

const KEY = "b3-score-model-pulse-v1";
const STRATEGIES = ["swing", "long", "dividends"];

export const strategyLabel = (id) => id === "long" ? "Longo Prazo" : id === "dividends" ? "Dividendos" : "Swing Trade";

function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function rowsForStrategy(assets, anomalies, strategy) {
  return assets
    .filter((asset) => asset.kind !== "fii" && asset.fundamentals?.scores?.overall != null)
    .map((asset) => {
      const anomaly = anomalies?.assets?.[asset.ticker] ?? null;
      const analysis = buildQuantAnalysis(asset, assets, anomaly, strategy === "swing" ? "swing_3_6m" : "long_term");
      const score = buildBuySellScore({ asset, analysis, strategy });
      return { ticker: asset.ticker, name: asset.name, price: asset.price, score: score.score, signal: score.signal, label: score.label };
    })
    .filter((row) => row.score != null && (row.signal === "buy" || row.signal === "sell"))
    .sort((a, b) => b.score - a.score);
}

function compact(rows) {
  return Object.fromEntries(rows.map((row) => [row.ticker, { score: row.score, signal: row.signal, price: row.price }]));
}

function localHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((row) => row?.date && row?.strategies) : [];
  } catch {
    localStorage.removeItem(KEY);
    return [];
  }
}

function mergedHistory(remotePayload) {
  const remote = Array.isArray(remotePayload?.history) ? remotePayload.history.filter((row) => row?.date && row?.strategies) : [];
  const local = localHistory();
  const byDate = new Map();
  for (const row of [...local, ...remote]) byDate.set(row.date, row);
  return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function buildModelPulse(assets = [], anomalies = null, remotePayload = null) {
  const current = Object.fromEntries(STRATEGIES.map((strategy) => [strategy, rowsForStrategy(assets, anomalies, strategy)]));
  if (typeof localStorage === "undefined") return { current, previous: null, changes: remotePayload?.events ?? {}, baseline: !remotePayload?.previousReferenceDate };

  const history = mergedHistory(remotePayload);
  const today = localDateKey();
  const previousSnapshot = [...history].reverse().find((row) => row.date !== today) ?? history.at(-1) ?? null;
  const todaySnapshot = history.find((row) => row.date === today) ?? null;
  const baselineSnapshot = previousSnapshot ?? todaySnapshot;

  const changes = {};
  for (const strategy of STRATEGIES) {
    const prior = baselineSnapshot?.strategies?.[strategy] ?? {};
    const rows = current[strategy];
    const withDelta = rows.map((row) => {
      const old = prior[row.ticker];
      return { ...row, previousScore: old?.score ?? null, previousSignal: old?.signal ?? null, delta: old?.score == null ? null : row.score - old.score };
    });
    const remoteEvents = remotePayload?.events?.[strategy] ?? {};
    const rowMap = new Map(withDelta.map((row) => [row.ticker, row]));
    changes[strategy] = {
      newBuys: withDelta.filter((row) => row.signal === "buy" && row.previousSignal === "sell").sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0)),
      newSells: withDelta.filter((row) => row.signal === "sell" && row.previousSignal === "buy").sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)),
      movers: withDelta.filter((row) => row.delta != null && row.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
      top4: withDelta.filter((row) => row.signal === "buy").slice(0, 4),
      buys: withDelta.filter((row) => row.signal === "buy").length,
      sells: withDelta.filter((row) => row.signal === "sell").length,
      enteredTop4: (remoteEvents.enteredTop4 ?? []).map((ticker) => rowMap.get(ticker) ?? { ticker }),
      leftTop4: remoteEvents.leftTop4 ?? [],
    };
  }

  const snapshot = { date: today, generatedAt: new Date().toISOString(), strategies: Object.fromEntries(STRATEGIES.map((strategy) => [strategy, compact(current[strategy])])) };
  const nextHistory = [...history.filter((row) => row.date !== today), snapshot].slice(-30);
  try { localStorage.setItem(KEY, JSON.stringify(nextHistory)); } catch {}

  return {
    current,
    previous: baselineSnapshot,
    changes,
    baseline: !baselineSnapshot || baselineSnapshot.date === today,
    snapshotDate: today,
    officialReferenceDate: remotePayload?.referenceDate ?? null,
    officialPreviousDate: remotePayload?.previousReferenceDate ?? null,
  };
}
