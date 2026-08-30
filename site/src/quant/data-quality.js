const DAY = 86_400_000;

export const DATA_STATUS = Object.freeze({
  current: { code: "ATUALIZADO", label: "Atualizado", tone: "current" },
  stale: { code: "DEFASADO", label: "Defasado", tone: "stale" },
  veryStale: { code: "MUITO_DEFASADO", label: "Muito defasado", tone: "very-stale" },
  unavailable: { code: "INDISPONIVEL", label: "Dado indisponível", tone: "unavailable" },
});

function toDateOnly(value) {
  if (!value) return null;
  const parsed = new Date(String(value).length === 10 ? `${value}T12:00:00Z` : value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 12));
}

export function ageInDays(referenceDate, now = new Date()) {
  const parsed = toDateOnly(referenceDate);
  if (!parsed) return null;
  return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / DAY));
}

export function businessDaysSince(referenceDate, now = new Date()) {
  const start = toDateOnly(referenceDate);
  const end = toDateOnly(now.toISOString());
  if (!start || !end || start >= end) return 0;
  let count = 0;
  const cursor = new Date(start.getTime());
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor <= end) {
    const weekday = cursor.getUTCDay();
    if (weekday >= 1 && weekday <= 5) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export function freshness(referenceDate, kind = "price", now = new Date()) {
  const calendarAge = ageInDays(referenceDate, now);
  if (calendarAge === null) return { ...DATA_STATUS.unavailable, ageDays: null, calendarAgeDays: null, referenceDate: referenceDate ?? null, confidence: 0 };

  const age = kind === "price" ? businessDaysSince(referenceDate, now) : calendarAge;
  const limits = kind === "fundamentals" ? [190, 310] : kind === "macro" ? [45, 100] : kind === "history" ? [8, 20] : [1, 3];
  const status = age <= limits[0] ? DATA_STATUS.current : age <= limits[1] ? DATA_STATUS.stale : DATA_STATUS.veryStale;
  const confidence = status === DATA_STATUS.current ? 100 : status === DATA_STATUS.stale ? 60 : 25;
  return { ...status, ageDays: age, calendarAgeDays: calendarAge, referenceDate, confidence };
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
