import { upgradeFundamentals } from "../scoring/fundamental-score.js";
import { overallScoreResult } from "../scoring/score-eligibility.js";

const numeric = (value) => { const parsed = Number(value); return value == null || value === "" || !Number.isFinite(parsed) ? null : parsed; };
export function normalizeAsset(raw) {
  const fundamentals = raw.fundamentals ? upgradeFundamentals(raw.fundamentals) : undefined;
  const kind = raw.kind === "fii" ? "fii" : raw.kind === "unit" ? "unit" : "stock";
  const fund = raw.fund ? { ...raw.fund, scores: { ...raw.fund.scores, overall: overallScoreResult({ kind: "fii", fund: raw.fund }, raw.fund.scores).value } } : undefined;
  return { ticker: String(raw.ticker ?? "").toUpperCase(), name: raw.name ? String(raw.name) : undefined, kind, date: raw.date ? String(raw.date) : undefined, price: numeric(raw.price), priceopen: numeric(raw.priceopen), high: numeric(raw.high), low: numeric(raw.low), volume: numeric(raw.volume), closeyest: numeric(raw.closeyest), change: numeric(raw.change), changepct: numeric(raw.changepct), high52: numeric(raw.high52), low52: numeric(raw.low52), tradetime: raw.tradetime ? String(raw.tradetime) : null, securityType: raw.securityType ? String(raw.securityType) : undefined, unitComposition: raw.unitComposition ? String(raw.unitComposition) : null, fundamentals, fund };
}
export function mergeSnapshots(embedded, current) { const merged = new Map(embedded.map((asset) => [asset.ticker, asset])); for (const update of current) { const saved = merged.get(update.ticker); merged.set(update.ticker, { ...saved, ...update, fundamentals: update.fundamentals ?? saved?.fundamentals, fund: update.fund ?? saved?.fund }); } return [...merged.values()]; }
export function isHealthySnapshot(data) { return data.length >= 600 && data.filter((asset) => asset.fundamentals).length >= 250 && data.filter((asset) => asset.fund).length >= 200; }
