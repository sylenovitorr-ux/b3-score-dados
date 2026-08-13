const DAY = 86_400_000;

export const DATA_STATUS = Object.freeze({
  current: { code: "ATUALIZADO", label: "Atualizado", tone: "current" },
  stale: { code: "DEFASADO", label: "Defasado", tone: "stale" },
  veryStale: { code: "MUITO_DEFASADO", label: "Muito defasado", tone: "very-stale" },
  unavailable: { code: "INDISPONIVEL", label: "Dado indisponível", tone: "unavailable" },
});

export function ageInDays(referenceDate, now = new Date()) {
  if (!referenceDate) return null;
  const parsed = new Date(referenceDate.length === 10 ? `${referenceDate}T12:00:00Z` : referenceDate);
  return Number.isFinite(parsed.getTime()) ? Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / DAY)) : null;
}

export function freshness(referenceDate, kind = "price", now = new Date()) {
  const age = ageInDays(referenceDate, now);
  if (age === null) return { ...DATA_STATUS.unavailable, ageDays: null, referenceDate: referenceDate ?? null, confidence: 0 };
  const limits = kind === "fundamentals" ? [190, 310] : kind === "macro" ? [45, 100] : kind === "history" ? [8, 20] : [4, 10];
  const status = age <= limits[0] ? DATA_STATUS.current : age <= limits[1] ? DATA_STATUS.stale : DATA_STATUS.veryStale;
  const confidence = status === DATA_STATUS.current ? 100 : status === DATA_STATUS.stale ? 60 : 25;
  return { ...status, ageDays: age, referenceDate, confidence };
}

export function datum(value, meta = {}) {
  const available = value !== null && value !== undefined && !(typeof value === "number" && !Number.isFinite(value));
  const valid = available ? freshness(meta.referenceDate, meta.kind, meta.now) : { ...DATA_STATUS.unavailable, ageDays: null, confidence: 0 };
  return {
    value: available ? value : null,
    state: meta.state ?? (available ? "raw" : "unavailable"),
    source: meta.source ?? null,
    referenceDate: meta.referenceDate ?? null,
    updatedAt: meta.updatedAt ?? null,
    quality: meta.quality ?? (meta.source ? "official" : "unknown"),
    freshness: valid,
    confidence: Math.round((meta.confidence ?? 100) * valid.confidence / 100),
    limitation: meta.limitation ?? null,
  };
}

export function unavailable(reason = "Dado indisponível.") {
  return { value: null, state: "unavailable", source: null, referenceDate: null, updatedAt: null, quality: "unknown", freshness: DATA_STATUS.unavailable, confidence: 0, limitation: reason };
}

export function assetDataHealth(asset, anomaly, updatedAt = null) {
  const fundamentalReference = asset.kind === "fii" ? asset.fund?.referenceDate : asset.fundamentals?.referenceDate;
  return {
    price: datum(asset.price, { source: "B3 COTAHIST", referenceDate: asset.date, updatedAt, kind: "price", quality: "official" }),
    fundamentals: datum(asset.kind === "fii" ? asset.fund : asset.fundamentals, { source: asset.kind === "fii" ? "CVM Informes FII" : "CVM DFP/ITR/FCA", referenceDate: fundamentalReference, updatedAt, kind: "fundamentals", quality: "official", confidence: asset.kind === "fii" ? asset.fund?.scores?.confidence : asset.fundamentals?.scores?.confidence }),
    history: datum(anomaly?.series?.length ? anomaly.series : null, { source: "B3 COTAHIST anual", referenceDate: anomaly?.lastDate, updatedAt, kind: "history", quality: "official", confidence: anomaly?.series?.length ? Math.min(100, anomaly.series.length / 60 * 100) : 0 }),
  };
}
