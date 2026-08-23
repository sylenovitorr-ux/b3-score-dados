const clean = (value) => String(value ?? "").trim().toUpperCase();

export const assetKindLabel = (asset) => asset?.kind === "fii" ? "FII" : asset?.kind === "unit" ? "UNIT" : "AÇÃO";

export function lotSizeFor(asset, marketMode = "fractional") {
  if (asset?.kind === "fii") return 1;
  return marketMode === "standard" ? 100 : 1;
}

export function maxQuantityFor(asset, marketMode = "fractional") {
  return asset?.kind !== "fii" && marketMode === "fractional" ? 99 : null;
}

export function marketSymbol(asset, marketMode = "fractional") {
  const ticker = clean(asset?.ticker);
  if (!ticker || asset?.kind === "fii" || marketMode !== "fractional") return ticker;
  return ticker.endsWith("F") ? ticker : `${ticker}F`;
}

export function underlyingTicker(value, assets = []) {
  const term = clean(value);
  if (!term) return "";
  if (assets.some((asset) => clean(asset?.ticker) === term)) return term;
  const withoutFractionalSuffix = term.endsWith("F") ? term.slice(0, -1) : term;
  return assets.some((asset) => clean(asset?.ticker) === withoutFractionalSuffix) ? withoutFractionalSuffix : term;
}

export function matchesAssetSearch(asset, value, marketMode = "fractional") {
  const term = clean(value);
  if (!term) return false;
  const base = clean(asset?.ticker);
  const display = marketSymbol(asset, marketMode);
  const name = clean(asset?.name);
  return base.includes(term) || display.includes(term) || name.includes(term);
}
