const number = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const quoteDate = (value) => {
  if (!value) return null;
  const text = String(value);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
};

function normalizeBook(book) {
  if (!book || typeof book !== "object") return null;
  const normalized = {
    bestBid: number(book.bestBid ?? book.bid),
    bestAsk: number(book.bestAsk ?? book.ask),
    bidVolume: number(book.bidVolume ?? book.totalBidVolume ?? book.buyVolume),
    askVolume: number(book.askVolume ?? book.totalAskVolume ?? book.sellVolume),
    pressure: number(book.pressure ?? book.imbalance ?? book.bookPressure),
    support: number(book.support),
    resistance: number(book.resistance),
    asOf: book.asOf ? String(book.asOf) : null,
    source: book.source ? String(book.source) : null,
  };
  const hasData = [normalized.bestBid, normalized.bestAsk, normalized.bidVolume, normalized.askVolume, normalized.pressure].some((value) => value !== null);
  return hasData ? normalized : null;
}

function normalizeSeries(series) {
  if (!Array.isArray(series)) return [];
  return series.map((row) => ({
    asOf: row?.asOf ? String(row.asOf) : null,
    price: number(row?.price),
    volume: number(row?.volume),
  })).filter((row) => row.asOf && row.price !== null);
}

// Só sobrepõe a fotografia diária quando a fonte externa declarar dados válidos.
// Assim, um arquivo ausente/defasado nunca vira uma "cotação ao vivo" fictícia.
export function normalizeIntraday(payload) {
  if (!payload || !Array.isArray(payload.quotes) || payload.status !== "ATUALIZADO") {
    return { available: false, quotes: new Map(), updatedAt: null, delayMinutes: null, source: null, bookStatus: null, bookSource: null };
  }
  const quotes = new Map(payload.quotes.map((quote) => [String(quote.ticker ?? "").toUpperCase(), {
    price: number(quote.price),
    changePct: number(quote.changePct),
    volume: number(quote.volume),
    asOf: quote.asOf ? String(quote.asOf) : null,
    book: normalizeBook(quote.book),
    series: normalizeSeries(quote.series),
  }]).filter(([ticker, quote]) => ticker && quote.price !== null));
  return {
    available: quotes.size > 0,
    quotes,
    updatedAt: payload.updatedAt ? String(payload.updatedAt) : null,
    delayMinutes: number(payload.delayMinutes),
    source: payload.source ? String(payload.source) : null,
    bookStatus: payload.bookStatus ? String(payload.bookStatus) : null,
    bookSource: payload.bookSource ? String(payload.bookSource) : null,
  };
}

export function applyIntradayQuotes(assets, intraday) {
  if (!intraday?.available) return assets;
  return assets.map((asset) => {
    const quote = intraday.quotes.get(asset.ticker);
    if (!quote) return asset;
    const intradayAsOf = quote.asOf ?? intraday.updatedAt;
    return {
      ...asset,
      officialQuoteDate: asset.officialQuoteDate ?? asset.date ?? null,
      date: quoteDate(intradayAsOf) ?? asset.date,
      price: quote.price,
      changepct: quote.changePct ?? asset.changepct,
      volume: quote.volume ?? asset.volume,
      book: quote.book ?? asset.book ?? null,
      intraday: true,
      intradayAsOf,
      intradaySource: intraday.source,
      intradayDelayMinutes: intraday.delayMinutes,
      intradaySeries: quote.series,
      bookStatus: quote.book ? "ATUALIZADO" : intraday.bookStatus,
      bookSource: quote.book?.source ?? intraday.bookSource,
    };
  });
}
