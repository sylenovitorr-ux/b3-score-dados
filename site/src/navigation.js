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
  const aliases = { oportunidade: "opportunities", oportunidades: "opportunities", swing: "swing", "candidatas-6m": "swing", candidatas: "swing", "mapa-calor": "heatmap", heatmap: "heatmap", comparar: "compare", comparador: "compare", analisar: "analyze", simulador: "simulator", simuladores: "simulator", opcoes: "options", carteira: "portfolio", metodologia: "methodology", avancadas: "advanced", ferramentas: "advanced", "ferramentas-avancadas": "advanced", alertas: "integrity", inicio: "home", ativo: "asset" };
  const normalized = aliases[page] ?? page;
  const allowed = new Set(["home", "radar", "opportunities", "swing", "heatmap", "analyze", "asset", "compare", "quant", "simulator", "options", "portfolio", "methodology", "integrity", "advanced"]);
  return allowed.has(normalized) ? { page: normalized, ticker: ticker?.toUpperCase() || null } : { page: "not-found", ticker: null };
}

export function routeHash(page, ticker = null) {
  const paths = { home: "", radar: "radar", opportunities: "oportunidades", swing: "candidatas-6m", heatmap: "mapa-calor", analyze: "analisar", asset: "ativo", compare: "comparador", quant: "quant", simulator: "simulador", options: "opcoes", portfolio: "carteira", methodology: "metodologia", integrity: "alertas", advanced: "ferramentas-avancadas" };
  const path = paths[page] ?? "";
  return `#/${path}${ticker ? `/${String(ticker).toUpperCase()}` : ""}`;
}

export const PRIMARY_NAV = [
  ["home", "Início"], ["radar", "Radar"], ["opportunities", "Oportunidades"], ["analyze", "Analisar"], ["compare", "Comparar"], ["portfolio", "Carteira"],
];
