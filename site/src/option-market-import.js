const REQUIRED = ["ticker", "referenceDate", "source"];
const ALIASES = {
  ticker: ["ticker", "codigo", "código", "symbol"],
  bid: ["bid", "compra", "melhorcompra"],
  ask: ["ask", "venda", "melhorvenda"],
  openInterest: ["openinterest", "oi", "posicoesabertas", "posiçõesabertas"],
  referenceDate: ["referencedate", "data", "datareferencia", "datadereferencia"],
  source: ["source", "fonte"],
};

const clean = (value) => String(value ?? "").trim();
const key = (value) => clean(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const numeric = (value) => {
  const raw = clean(value);
  if (!raw) return null;
  const normalized = raw.includes(",") && !raw.includes(".") ? raw.replace(",", ".") : raw.replace(/,/g, "");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : NaN;
};

export function parseDelimited(text) {
  const lines = String(text ?? "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  return lines.map((line) => line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, "")));
}

export function importOptionMarket(text, importedAt = new Date().toISOString()) {
  const table = parseDelimited(text);
  if (table.length < 2) return { rows: [], errors: ["O arquivo precisa ter cabeçalho e ao menos uma linha de dados."] };
  const headers = table[0].map(key);
  const indexes = Object.fromEntries(Object.entries(ALIASES).map(([field, names]) => [field, headers.findIndex((header) => names.map(key).includes(header))]));
  const missing = REQUIRED.filter((field) => indexes[field] < 0);
  if (missing.length) return { rows: [], errors: [`Colunas obrigatórias ausentes: ${missing.join(", ")}.`] };
  const rows = [];
  const errors = [];
  table.slice(1).forEach((cells, index) => {
    const line = index + 2;
    const ticker = clean(cells[indexes.ticker]).toUpperCase();
    const bid = indexes.bid >= 0 ? numeric(cells[indexes.bid]) : null;
    const ask = indexes.ask >= 0 ? numeric(cells[indexes.ask]) : null;
    const openInterest = indexes.openInterest >= 0 ? numeric(cells[indexes.openInterest]) : null;
    const referenceDate = clean(cells[indexes.referenceDate]).slice(0, 10);
    const source = clean(cells[indexes.source]);
    const lineErrors = [];
    if (!/^[A-Z0-9]{5,15}$/.test(ticker)) lineErrors.push("ticker inválido");
    if (bid !== null && (!(bid >= 0) || Number.isNaN(bid))) lineErrors.push("bid inválido");
    if (ask !== null && (!(ask >= 0) || Number.isNaN(ask))) lineErrors.push("ask inválido");
    if (bid !== null && ask !== null && ask < bid) lineErrors.push("ask menor que bid");
    if (openInterest !== null && (!Number.isInteger(openInterest) || openInterest < 0)) lineErrors.push("open interest inválido");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate) || Number.isNaN(Date.parse(`${referenceDate}T12:00:00Z`))) lineErrors.push("data inválida; use AAAA-MM-DD");
    if (!source) lineErrors.push("fonte vazia");
    if (bid === null && ask === null && openInterest === null) lineErrors.push("nenhum dado de mercado informado");
    if (lineErrors.length) errors.push(`Linha ${line}: ${lineErrors.join("; ")}.`);
    else rows.push({ ticker, bid, ask, openInterest, referenceDate, source, importedAt });
  });
  return { rows, errors };
}

export function marketSnapshotMap(rows) {
  return Object.fromEntries((Array.isArray(rows) ? rows : []).map((row) => [row.ticker, row]));
}

export function snapshotAge(referenceDate, today = new Date()) {
  if (!referenceDate) return { status: "INDISPONÍVEL", days: null };
  const reference = new Date(`${referenceDate}T12:00:00Z`);
  const days = Math.max(0, Math.floor((today.getTime() - reference.getTime()) / 86400000));
  return { days, status: days <= 1 ? "ATUALIZADO" : days <= 3 ? "DEFASADO" : "MUITO DEFASADO" };
}
