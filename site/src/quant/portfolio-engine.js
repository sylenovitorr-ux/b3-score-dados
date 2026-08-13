import { finite, mean } from "./statistics.js";

export const PORTFOLIO_STORAGE_KEY = "b3-score-positions-v2";
export const PORTFOLIO_SCHEMA_VERSION = 2;

export function migratePortfolio(raw) {
  if (!raw) return { version: PORTFOLIO_SCHEMA_VERSION, positions: [], migratedFrom: null };
  if (raw.version === PORTFOLIO_SCHEMA_VERSION && Array.isArray(raw.positions)) return { ...raw, positions: raw.positions.map(normalizePosition).filter(Boolean) };
  const legacy = Array.isArray(raw) ? raw : Array.isArray(raw.positions) ? raw.positions : [];
  return { version: PORTFOLIO_SCHEMA_VERSION, positions: legacy.map(normalizePosition).filter(Boolean), migratedFrom: raw.version ?? 1 };
}

export function normalizePosition(position) {
  const ticker = String(position?.ticker ?? "").trim().toUpperCase();
  const quantity = finite(Number(position?.quantity));
  const averagePrice = finite(Number(position?.averagePrice ?? position?.price));
  const brokerage = position?.brokerage === "" || position?.brokerage === null || position?.brokerage === undefined ? null : finite(Number(position.brokerage));
  if (!ticker || !(quantity > 0) || !(averagePrice >= 0)) return null;
  return { id: position.id ?? `${ticker}-${position.date ?? "sem-data"}-${Date.now()}`, ticker, quantity, averagePrice, date: position.date ?? null, brokerage, assetType: position.assetType ?? null };
}

const groupWeights = (rows, key) => {
  const total = rows.reduce((sum, row) => sum + row.currentValue, 0);
  const grouped = {};
  for (const row of rows) grouped[row[key] ?? "Não informado"] = (grouped[row[key] ?? "Não informado"] ?? 0) + row.currentValue;
  return Object.entries(grouped).map(([label, value]) => ({ label, value, weightPct: total ? value / total * 100 : null })).sort((a, b) => b.value - a.value);
};

export function calculatePortfolio(positions, assets = [], anomalies = {}, profile = null) {
  const map = new Map(assets.map((asset) => [asset.ticker, asset]));
  const rows = positions.map((position) => {
    const asset = map.get(position.ticker);
    const currentPrice = finite(asset?.price);
    const brokerage = finite(position.brokerage) ?? 0;
    const cost = position.quantity * position.averagePrice + brokerage;
    const currentValue = currentPrice === null ? null : position.quantity * currentPrice;
    const pnl = currentValue === null ? null : currentValue - cost;
    const sector = asset?.kind === "fii" ? asset.fund?.segment : asset?.fundamentals?.sector ?? asset?.fundamentals?.segment;
    return { ...position, asset, currentPrice, cost, currentValue, pnl, returnPct: pnl !== null && cost > 0 ? pnl / cost * 100 : null, className: asset?.kind === "fii" ? "FII" : asset ? "Ação/Unit" : "Dado indisponível", sector: sector || "Não informado", volatilityPct: finite(anomalies?.[position.ticker]?.annualizedVolatilityPct) };
  });
  const valid = rows.filter((row) => row.currentValue !== null);
  const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
  const currentValue = valid.reduce((sum, row) => sum + row.currentValue, 0);
  valid.forEach((row) => { row.weightPct = currentValue ? row.currentValue / currentValue * 100 : null; });
  const sortedWeights = valid.map((row) => row.weightPct).filter((value) => value !== null).sort((a, b) => b - a);
  const top = (count) => sortedWeights.slice(0, count).reduce((sum, value) => sum + value, 0);
  const limit = profile?.limits?.maxAssetPct ?? null;
  const alerts = valid.filter((row) => limit !== null && row.weightPct > limit).map((row) => `${row.ticker} representa ${row.weightPct.toFixed(1)}%, acima do limite configurado de ${limit}%.`);
  return {
    rows, totalCost, currentValue, pnl: currentValue - totalCost, returnPct: totalCost > 0 ? (currentValue / totalCost - 1) * 100 : null,
    top3Pct: top(3), top5Pct: top(5), byClass: groupWeights(valid, "className"), bySector: groupWeights(valid, "sector"), alerts,
    aggregateVolatilityPct: null,
    aggregateVolatilityLimitation: "Correlações sincronizadas entre todos os ativos não estão disponíveis; somar volatilidades produziria um número enganoso.",
    coveragePct: rows.length ? valid.length / rows.length * 100 : 0,
  };
}

export function projection({ initial = 0, monthly = 0, annualRatePct = 0, months = 0 }) {
  const monthlyRate = (1 + annualRatePct / 100) ** (1 / 12) - 1;
  let balance = initial;
  for (let month = 0; month < months; month += 1) balance = balance * (1 + monthlyRate) + monthly;
  const contributed = initial + monthly * months;
  return { balance, contributed, interest: balance - contributed, monthlyRatePct: monthlyRate * 100, formula: "Pₙ = Pₙ₋₁ × (1 + taxa mensal equivalente) + aporte mensal." };
}

export function portfolioIncomeSummary(rows) {
  const yields = rows.map((row) => row.asset?.kind === "fii" ? finite(row.asset.fund?.dy12) : finite(row.asset?.fundamentals?.dividendYield)).filter((value) => value !== null);
  return { weightedYieldPct: mean(yields), limitation: "Estimativa baseada no yield passado disponível; não é promessa de renda futura." };
}
