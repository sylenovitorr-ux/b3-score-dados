const present = (value) => Number.isFinite(value);

export const SCORE_STATUS = Object.freeze({ AVAILABLE: "available", INSUFFICIENT: "insufficient_data", NOT_APPLICABLE: "not_applicable", STALE: "stale", ESTIMATED: "estimated" });

export function scoreEligibility(assetOrData, kind = null) {
  const asset = assetOrData?.kind ? assetOrData : { kind: kind ?? "stock", fundamentals: kind === "fii" ? null : assetOrData, fund: kind === "fii" ? assetOrData : null };
  const isFii = asset.kind === "fii";
  const data = isFii ? asset.fund : asset.fundamentals;
  const scores = data?.scores ?? {};
  const keys = isFii ? ["quality", "price", "risk", "income"] : data?.financialCompany ? ["price", "quality", "dividends"] : ["price", "quality", "debt", "dividends"];
  const available = keys.filter((key) => present(scores[key]));
  const missing = keys.filter((key) => !present(scores[key]));
  const coverage = keys.length ? available.length / keys.length : 0;
  const minimumBlocks = data?.financialCompany ? 2 : isFii ? 3 : 3;
  const confidence = present(scores.confidence) ? scores.confidence : (data?.confidenceDetails?.coverage ?? 0);
  const stale = data?.confidenceDetails?.freshness != null && data.confidenceDetails.freshness < 55;
  const eligible = Boolean(data) && available.length >= minimumBlocks && coverage >= .6 && confidence >= 50 && !stale;
  return { eligible, status: !data ? SCORE_STATUS.INSUFFICIENT : stale ? SCORE_STATUS.STALE : eligible ? SCORE_STATUS.AVAILABLE : SCORE_STATUS.INSUFFICIENT, coverage, confidence, required: keys, inputs: available, missing, reason: eligible ? null : !data ? "Fundamentos indisponíveis." : stale ? "Fundamentos muito defasados." : `São necessários ${minimumBlocks} blocos fundamentais aplicáveis; disponíveis: ${available.length}.` };
}

export function overallScoreResult(asset, scores = null) {
  const eligibility = scoreEligibility(asset);
  const value = eligibility.eligible && present(scores?.overall) ? scores.overall : null;
  return { value, confidence: eligibility.confidence, status: value == null ? eligibility.status : SCORE_STATUS.AVAILABLE, inputs: eligibility.inputs, missing: eligibility.missing, sourceDate: asset?.fund?.referenceDate ?? asset?.fundamentals?.referenceDate ?? null, eligibility };
}
