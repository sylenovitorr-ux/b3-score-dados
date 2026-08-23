import { buildBuySellScore } from "./buy-sell-score.js";

const finite = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round = (value, digits = 2) => value == null ? null : Number(value.toFixed(digits));

function inferBookPressure(book) {
  if (!book) return null;
  const direct = finite(book.pressure ?? book.imbalance ?? book.bookPressure);
  if (direct != null) return Math.max(-100, Math.min(100, direct));
  const bidVolume = finite(book.bidVolume ?? book.totalBidVolume ?? book.buyVolume);
  const askVolume = finite(book.askVolume ?? book.totalAskVolume ?? book.sellVolume);
  if (bidVolume == null || askVolume == null || bidVolume + askVolume <= 0) return null;
  return Math.max(-100, Math.min(100, ((bidVolume - askVolume) / (bidVolume + askVolume)) * 100));
}

function buildLevels(asset, analysis, book) {
  const price = finite(asset?.price);
  if (price == null || price <= 0) return { entryLow: null, entryHigh: null, stop: null, target1: null, target2: null, riskReward1: null, riskReward2: null };
  const high = finite(asset?.high);
  const low = finite(asset?.low);
  const open = finite(asset?.priceopen);
  const prior = finite(asset?.closeyest);
  const intradayRange = high != null && low != null && high > low ? high - low : null;
  const fallbackRange = Math.max(price * .012, Math.abs((open ?? price) - (prior ?? price)), price * .006);
  const range = intradayRange != null ? Math.max(intradayRange, price * .004) : fallbackRange;
  const bestBid = finite(book?.bestBid ?? book?.bid);
  const bestAsk = finite(book?.bestAsk ?? book?.ask);
  const support = finite(book?.support);
  const resistance = finite(book?.resistance);
  const entryLow = bestBid ?? Math.max(price - range * .15, price * .995);
  const entryHigh = bestAsk ?? Math.min(price + range * .15, price * 1.005);
  const stopBase = support != null && support < price ? support : (low != null && low < price ? low : price - range * .65);
  const stop = Math.min(stopBase, price - Math.max(range * .35, price * .004));
  const risk = Math.max(price - stop, price * .0025);
  const valuationScore = finite(analysis?.components?.valuation?.value);
  const momentumScore = finite(analysis?.components?.momentum?.value);
  const extension = valuationScore != null && valuationScore >= 65 && momentumScore != null && momentumScore >= 65 ? .35 : 0;
  const target1 = resistance != null && resistance > price ? resistance : price + risk * (1.4 + extension);
  const target2 = Math.max(target1 + risk * .6, price + risk * (2.1 + extension));
  return { entryLow: round(Math.min(entryLow, entryHigh)), entryHigh: round(Math.max(entryLow, entryHigh)), stop: round(stop), target1: round(target1), target2: round(target2), riskReward1: round((target1 - price) / risk, 1), riskReward2: round((target2 - price) / risk, 1) };
}

export function buildTradeSignal({ asset, analysis, book = null, strategy = "swing" }) {
  const unified = buildBuySellScore({ asset, analysis, strategy });
  const bookPressure = inferBookPressure(book);
  const pressureScore = bookPressure == null ? null : clamp(50 + bookPressure / 2);
  const combinedScore = unified.score == null
    ? null
    : pressureScore == null ? unified.score : Math.round(unified.score * .9 + pressureScore * .1);
  const signal = combinedScore == null ? "unavailable" : combinedScore >= 70 ? "buy" : "sell";
  const label = signal === "buy" ? "COMPRA" : signal === "sell" ? "VENDA" : "NÃO AVALIÁVEL";
  const levels = combinedScore == null ? buildLevels(null, analysis, book) : buildLevels(asset, analysis, book);
  const reasons = unified.parts.map((part) => ({
    kind: part.value >= 70 ? "positive" : "negative",
    label: `${part.label} ${Math.round(part.value)}/100`,
  }));
  if (bookPressure != null) reasons.push({ kind: bookPressure >= 0 ? "positive" : "negative", label: `Pressão do book ${bookPressure > 0 ? "+" : ""}${Math.round(bookPressure)}` });
  reasons.push({ kind: asset?.intraday ? "positive" : "neutral", label: asset?.intraday ? `Cotação intradiária${asset.intradayAsOf ? ` • ${asset.intradayAsOf}` : ""}` : "Usando último dado disponível" });
  return {
    id: signal,
    label,
    tone: signal === "buy" ? "excellent" : signal === "sell" ? "bad" : "na",
    confidence: combinedScore,
    ...levels,
    price: finite(asset?.price),
    score: unified.fundamentalScore,
    baseScore: unified.score,
    combinedScore,
    strategy,
    strategyLabel: unified.strategyLabel,
    momentum: unified.momentum,
    risk: unified.risk,
    valuation: unified.valuation,
    dataConfidence: unified.confidence,
    bookPressure,
    bestBid: finite(book?.bestBid ?? book?.bid),
    bestAsk: finite(book?.bestAsk ?? book?.ask),
    spread: finite(book?.spread) ?? ((finite(book?.bestBid ?? book?.bid) != null && finite(book?.bestAsk ?? book?.ask) != null) ? round(finite(book?.bestAsk ?? book?.ask) - finite(book?.bestBid ?? book?.bid), 4) : null),
    sourceStatus: asset?.intraday ? "intraday" : "last_available",
    updatedAt: asset?.intradayAsOf ?? asset?.tradetime ?? asset?.date ?? null,
    reasons,
    disclaimer: "Sinal algorítmico educacional. Nota 70 ou mais = COMPRA; abaixo de 70 = VENDA. A decisão final é do usuário.",
  };
}
