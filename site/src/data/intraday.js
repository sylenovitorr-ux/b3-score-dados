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
    bestBid: number(book.bestBid ?? book.bid), bestAsk: number(book.bestAsk ?? book.ask),
    bidVolume: number(book.bidVolume ?? book.totalBidVolume ?? book.buyVolume), askVolume: number(book.askVolume ?? book.totalAskVolume ?? book.sellVolume),
    pressure: number(book.pressure ?? book.imbalance ?? book.bookPressure), support: number(book.support), resistance: number(book.resistance),
    asOf: book.asOf ? String(book.asOf) : null, source: book.source ? String(book.source) : null,
  };
  const hasData = [normalized.bestBid, normalized.bestAsk, normalized.bidVolume, normalized.askVolume, normalized.pressure].some((value) => value !== null);
  return hasData ? normalized : null;
}

function normalizeSeries(series) {
  if (!Array.isArray(series)) return [];
  return series.map((row) => ({ asOf: row?.asOf ? String(row.asOf) : null, price: number(row?.price), volume: number(row?.volume) })).filter((row) => row.asOf && row.price !== null);
}

export function normalizeIntraday(payload, now = new Date()) {
  if (!payload || !Array.isArray(payload.quotes) || payload.status !== "ATUALIZADO") return { available: false, reason: "indisponível", quotes: new Map(), updatedAt: null, delayMinutes: null, source: null, bookStatus: null, bookSource: null };
  const updatedAt = payload.updatedAt ? String(payload.updatedAt) : null;
  const ageMinutes = updatedAt ? (now.getTime() - new Date(updatedAt).getTime()) / 60000 : Infinity;
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map((part) => [part.type, part.value]));
  const today = `${values.year}-${values.month}-${values.day}`;
  const referenceDate = quoteDate(updatedAt);
  if (!Number.isFinite(ageMinutes) || ageMinutes < -5 || ageMinutes > 180 || referenceDate !== today) return { available: false, reason: "arquivo intradiário defasado", quotes: new Map(), updatedAt, ageMinutes, delayMinutes: number(payload.delayMinutes), source: payload.source ? String(payload.source) : null, bookStatus: null, bookSource: null };
  const quotes = new Map(payload.quotes.map((quote) => [String(quote.ticker ?? "").toUpperCase(), { price: number(quote.price), changePct: number(quote.changePct), volume: number(quote.volume), asOf: quote.asOf ? String(quote.asOf) : null, book: normalizeBook(quote.book), series: normalizeSeries(quote.series) }]).filter(([ticker, quote]) => ticker && quote.price !== null));
  return { available: quotes.size > 0, quotes, updatedAt, ageMinutes, delayMinutes: number(payload.delayMinutes), source: payload.source ? String(payload.source) : null, bookStatus: payload.bookStatus ? String(payload.bookStatus) : null, bookSource: payload.bookSource ? String(payload.bookSource) : null };
}

function quoteChanged(asset, quote, intraday) {
  if (!quote) return false;
  const asOf = quote.asOf ?? intraday.updatedAt;
  return asset.price !== quote.price || asset.changepct !== (quote.changePct ?? asset.changepct) || asset.volume !== (quote.volume ?? asset.volume) || asset.intradayAsOf !== asOf;
}

export function applyIntradayQuotesIncremental(assets, intraday) {
  if (!intraday?.available) return { assets, changedTickers: [], changed: false };
  const changedTickers = [];
  const next = assets.map((asset) => {
    const quote = intraday.quotes.get(asset.ticker);
    if (!quoteChanged(asset, quote, intraday)) return asset;
    changedTickers.push(asset.ticker);
    const intradayAsOf = quote.asOf ?? intraday.updatedAt;
    return {
      ...asset,
      officialQuoteDate: asset.officialQuoteDate ?? asset.date ?? null,
      officialPrice: asset.officialPrice ?? asset.price ?? null,
      officialOpen: asset.officialOpen ?? asset.priceopen ?? null,
      officialHigh: asset.officialHigh ?? asset.high ?? null,
      officialLow: asset.officialLow ?? asset.low ?? null,
      officialVolume: asset.officialVolume ?? asset.volume ?? null,
      date: quoteDate(intradayAsOf) ?? asset.date,
      price: quote.price,
      changepct: quote.changePct ?? asset.changepct,
      volume: quote.volume ?? asset.volume,
      book: quote.book ?? asset.book ?? null,
      intraday: true, intradayAsOf, intradaySource: intraday.source, intradayDelayMinutes: intraday.delayMinutes,
      intradaySeries: quote.series, bookStatus: quote.book ? "ATUALIZADO" : intraday.bookStatus, bookSource: quote.book?.source ?? intraday.bookSource,
    };
  });
  return { assets: changedTickers.length ? next : assets, changedTickers, changed: changedTickers.length > 0 };
}

export function applyIntradayQuotes(assets, intraday) {
  return applyIntradayQuotesIncremental(assets, intraday).assets;
}
