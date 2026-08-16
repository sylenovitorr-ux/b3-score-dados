const LEGACY = {
  "radar-diario": "radar",
  oportunidades: "opportunities",
  integridade: "integrity",
  opcoes: "options",
  quant: "quant",
  top: "home",
};

export function parseRoute(hash = "") {
  const raw = String(hash).replace(/^#\/?/, "").replace(/\/$/, "");
  if (!raw) return { page: "home", ticker: null };
  if (LEGACY[raw]) return { page: LEGACY[raw], ticker: null };
  const [page, ticker] = raw.split("/");
  const aliases = { oportunidade: "opportunities", oportunidades: "opportunities", swing: "swing", comparar: "compare", comparador: "compare", analisar: "analyze", simulador: "simulator", simuladores: "simulator", opcoes: "options", carteira: "portfolio", metodologia: "methodology", alertas: "integrity", inicio: "home", ativo: "asset" };
  const normalized = aliases[page] ?? page;
  const allowed = new Set(["home", "radar", "opportunities", "swing", "analyze", "asset", "compare", "quant", "simulator", "options", "portfolio", "methodology", "integrity"]);
  return allowed.has(normalized) ? { page: normalized, ticker: ticker?.toUpperCase() || null } : { page: "not-found", ticker: null };
}

export function routeHash(page, ticker = null) {
  const paths = { home: "", radar: "radar", opportunities: "oportunidades", swing: "swing", analyze: "analisar", asset: "ativo", compare: "comparador", quant: "quant", simulator: "simulador", options: "opcoes", portfolio: "carteira", methodology: "metodologia", integrity: "alertas" };
  const path = paths[page] ?? "";
  return `#/${path}${ticker ? `/${String(ticker).toUpperCase()}` : ""}`;
}

export const PRIMARY_NAV = [
  ["home", "Início"], ["radar", "Radar"], ["opportunities", "Valuation"], ["analyze", "Analisar"], ["options", "Opções"], ["portfolio", "Carteira"],
];
