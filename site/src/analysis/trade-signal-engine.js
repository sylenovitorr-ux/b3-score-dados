const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round = (value, digits = 2) => value == null ? null : Number(value.toFixed(digits));

function inferBookPressure(book) {
  if (!book) return null;
  const direct = finite(book.pressure ?? book.imbalance ?? book.bookPressure);
  if (direct != null) return clamp(direct, -100, 100);
  const bidVolume = finite(book.bidVolume ?? book.totalBidVolume ?? book.buyVolume);
  const askVolume = finite(book.askVolume ?? book.totalAskVolume ?? book.sellVolume);
  if (bidVolume == null || askVolume == null || bidVolume + askVolume <= 0) return null;
  return clamp(((bidVolume - askVolume) / (bidVolume + askVolume)) * 100, -100, 100);
}

function chooseSignal({ score, momentum, risk, valuation, changePct, bookPressure, confidence }) {
  const weighted = [[score, .30], [momentum, .25], [risk, .15], [valuation, .15], [confidence, .15]].filter(([value]) => value != null);
  const totalWeight = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  let strength = totalWeight ? weighted.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight : 0;
  if (bookPressure != null) strength += clamp(bookPressure / 8, -12, 12);
  if (changePct != null) strength += clamp(changePct * 1.5, -6, 6);
  strength = clamp(strength, 0, 100);
  const buy = strength >= 60 && !(momentum != null && momentum < 40) && !(bookPressure != null && bookPressure <= -30);
  return { id: buy ? "buy" : "sell", label: buy ? "COMPRA" : "VENDA", tone: buy ? "excellent" : "bad", confidence: Math.round(strength) };
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

export function buildTradeSignal({ asset, analysis, book = null }) {
  const fundamentals = asset?.kind === "fii" ? asset?.fund ?? {} : asset?.fundamentals ?? {};
  const score = finite(fundamentals?.scores?.overall);
  const momentum = finite(analysis?.components?.momentum?.value);
  const risk = finite(analysis?.components?.risk?.value);
  const valuation = finite(analysis?.components?.valuation?.value);
  const confidence = finite(analysis?.confidence ?? fundamentals?.scores?.confidence);
  const changePct = finite(asset?.changepct);
  const bookPressure = inferBookPressure(book);
  const signal = chooseSignal({ score, momentum, risk, valuation, changePct, bookPressure, confidence });
  const levels = buildLevels(asset, analysis, book);
  const reasons = [];
  if (score != null) reasons.push({ kind: score >= 60 ? "positive" : "negative", label: `Fundamentos ${Math.round(score)}/100` });
  if (momentum != null) reasons.push({ kind: momentum >= 55 ? "positive" : "negative", label: `Momentum ${Math.round(momentum)}/100` });
  if (valuation != null) reasons.push({ kind: valuation >= 55 ? "positive" : "negative", label: `Valuation ${Math.round(valuation)}/100` });
  if (bookPressure != null) reasons.push({ kind: bookPressure >= 0 ? "positive" : "negative", label: `Pressão do book ${Math.round(bookPressure)}` });
  reasons.push({ kind: asset?.intraday ? "positive" : "neutral", label: asset?.intraday ? `Cotação intradiária${asset.intradayAsOf ? ` • ${asset.intradayAsOf}` : ""}` : "Usando último dado disponível" });
  return { ...signal, ...levels, price: finite(asset?.price), score, momentum, risk, valuation, dataConfidence: confidence, bookPressure, bestBid: finite(book?.bestBid ?? book?.bid), bestAsk: finite(book?.bestAsk ?? book?.ask), spread: finite(book?.spread) ?? ((finite(book?.bestBid ?? book?.bid) != null && finite(book?.bestAsk ?? book?.ask) != null) ? round(finite(book?.bestAsk ?? book?.ask) - finite(book?.bestBid ?? book?.bid), 4) : null), sourceStatus: asset?.intraday ? "intraday" : "last_available", updatedAt: asset?.intradayAsOf ?? asset?.tradetime ?? asset?.date ?? null, reasons, disclaimer: "Leitura quantitativa educacional. Não executa ordens." };
}
