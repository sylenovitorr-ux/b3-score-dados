const finiteNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const formatMoney = (value, fallback = "—") => {
  const parsed = finiteNumber(value);
  return parsed === null ? fallback : parsed.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

export const formatNumber = (value, digits = 2, fallback = "—") => {
  const parsed = finiteNumber(value);
  return parsed === null ? fallback : parsed.toLocaleString("pt-BR", { maximumFractionDigits: digits });
};

export const formatCompactMoney = (value, fallback = "—") => {
  const parsed = finiteNumber(value);
  return parsed === null ? fallback : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 }).format(parsed);
};

export const formatPercent = (value, sign = true, fallback = "—") => {
  const parsed = finiteNumber(value);
  return parsed === null ? fallback : `${sign && parsed > 0 ? "+" : ""}${formatNumber(parsed)}%`;
};
