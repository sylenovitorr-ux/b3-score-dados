const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

// Só sobrepõe a fotografia diária quando a fonte externa declarar dados válidos.
// Assim, um arquivo ausente/defasado nunca vira uma "cotação ao vivo" fictícia.
export function normalizeIntraday(payload) {
  if (!payload || !Array.isArray(payload.quotes) || payload.status !== "ATUALIZADO") return { available: false, quotes: new Map(), updatedAt: null, delayMinutes: null, source: null };
  const quotes = new Map(payload.quotes.map((quote) => [String(quote.ticker ?? "").toUpperCase(), {
    price: number(quote.price), changePct: number(quote.changePct), volume: number(quote.volume), asOf: quote.asOf ? String(quote.asOf) : null,
  }]).filter(([ticker, quote]) => ticker && quote.price !== null));
  return { available: quotes.size > 0, quotes, updatedAt: payload.updatedAt ? String(payload.updatedAt) : null, delayMinutes: number(payload.delayMinutes), source: payload.source ? String(payload.source) : null };
}

export function applyIntradayQuotes(assets, intraday) {
  if (!intraday?.available) return assets;
  return assets.map((asset) => {
    const quote = intraday.quotes.get(asset.ticker);
    if (!quote) return asset;
    return { ...asset, price: quote.price, changepct: quote.changePct ?? asset.changepct, volume: quote.volume ?? asset.volume, intraday: true, intradayAsOf: quote.asOf ?? intraday.updatedAt };
  });
}
