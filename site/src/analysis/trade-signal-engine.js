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
  const available = [score, momentum, risk, valuation, confidence].filter((value) => value != null);
  if (available.length < 3) return { id: "insufficient", label: "DADOS INSUFICIENTES", tone: "na", confidence: 0 };

  const weighted = [
    [score, 0.30],
    [momentum, 0.25],
    [risk, 0.15],
    [valuation, 0.15],
    [confidence, 0.15],
  ].filter(([value]) => value != null);
  const totalWeight = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  let strength = weighted.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight;

  if (bookPressure != null) strength += clamp(bookPressure / 8, -12, 12);
  if (changePct != null) strength += clamp(changePct * 1.5, -6, 6);
  strength = clamp(strength, 0, 100);

  if (score != null && score < 40 && momentum != null && momentum < 45) {
    return { id: "exit", label: "SAÍDA / INVALIDAÇÃO", tone: "bad", confidence: Math.round(strength) };
  }
  if ((bookPressure != null && bookPressure <= -30) || (momentum != null && momentum < 40)) {
    return { id: "protect", label: "PROTEGER / CONSIDERAR PARCIAL", tone: "warn", confidence: Math.round(strength) };
  }
  if (strength >= 72 && (momentum == null || momentum >= 60) && (bookPressure == null || bookPressure >= 15)) {
    return { id: "confirmed", label: "ENTRADA CONFIRMADA", tone: "excellent", confidence: Math.round(strength) };
  }
  if (strength >= 62 && (momentum == null || momentum >= 52)) {
    return { id: "possible", label: "ENTRADA POSSÍVEL", tone: "good", confidence: Math.round(strength) };
  }
  return { id: "watch", label: "OBSERVAR / AGUARDAR", tone: "mid", confidence: Math.round(strength) };
}

function buildLevels(asset, analysis, book) {
  const price = finite(asset?.price);
  if (price == null || price <= 0) return { entryLow: null, entryHigh: null, stop: null, target1: null, target2: null, riskReward1: null, riskReward2: null };

  const high = finite(asset?.high);
  const low = finite(asset?.low);
  const open = finite(asset?.priceopen);
  const prior = finite(asset?.closeyest);
  const intradayRange = high != null && low != null && high > low ? high - low : null;
  const fallbackRange = Math.max(price * 0.012, Math.abs((open ?? price) - (prior ?? price)), price * 0.006);
  const range = intradayRange != null ? Math.max(intradayRange, price * 0.004) : fallbackRange;

  const bestBid = finite(book?.bestBid ?? book?.bid);
  const bestAsk = finite(book?.bestAsk ?? book?.ask);
  const support = finite(book?.support);
  const resistance = finite(book?.resistance);

  const entryLow = bestBid ?? Math.max(price - range * 0.15, price * 0.995);
  const entryHigh = bestAsk ?? Math.min(price + range * 0.15, price * 1.005);
  const stopBase = support != null && support < price ? support : (low != null && low < price ? low : price - range * 0.65);
  const stop = Math.min(stopBase, price - Math.max(range * 0.35, price * 0.004));
  const risk = Math.max(price - stop, price * 0.0025);

  const valuationScore = finite(analysis?.components?.valuation?.value);
  const momentumScore = finite(analysis?.components?.momentum?.value);
  const extension = valuationScore != null && valuationScore >= 65 && momentumScore != null && momentumScore >= 65 ? 0.35 : 0;
  const target1 = resistance != null && resistance > price ? resistance : price + risk * (1.4 + extension);
  const target2 = Math.max(target1 + risk * 0.6, price + risk * (2.1 + extension));

  return {
    entryLow: round(Math.min(entryLow, entryHigh)),
    entryHigh: round(Math.max(entryLow, entryHigh)),
    stop: round(stop),
    target1: round(target1),
    target2: round(target2),
    riskReward1: round((target1 - price) / risk, 1),
    riskReward2: round((target2 - price) / risk, 1),
  };
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
  if (score != null) reasons.push({ kind: score >= 65 ? "positive" : score < 45 ? "negative" : "neutral", label: `Fundamentos ${Math.round(score)}/100` });
  if (momentum != null) reasons.push({ kind: momentum >= 60 ? "positive" : momentum < 45 ? "negative" : "neutral", label: `Momentum ${Math.round(momentum)}/100` });
  if (valuation != null) reasons.push({ kind: valuation >= 60 ? "positive" : valuation < 45 ? "negative" : "neutral", label: `Valuation ${Math.round(valuation)}/100` });
  if (bookPressure != null) reasons.push({ kind: bookPressure >= 15 ? "positive" : bookPressure <= -15 ? "negative" : "neutral", label: `Pressão do book ${Math.round(bookPressure)}` });
  if (asset?.intraday) reasons.push({ kind: "positive", label: `Cotação intradiária${asset.intradayAsOf ? ` • ${asset.intradayAsOf}` : ""}` });
  else reasons.push({ kind: "neutral", label: "Sem cotação intradiária válida; usando último dado disponível" });

  return {
    ...signal,
    ...levels,
    price: finite(asset?.price),
    score,
    momentum,
    risk,
    valuation,
    dataConfidence: confidence,
    bookPressure,
    bestBid: finite(book?.bestBid ?? book?.bid),
    bestAsk: finite(book?.bestAsk ?? book?.ask),
    spread: finite(book?.spread) ?? ((finite(book?.bestBid ?? book?.bid) != null && finite(book?.bestAsk ?? book?.ask) != null) ? round(finite(book?.bestAsk ?? book?.ask) - finite(book?.bestBid ?? book?.bid), 4) : null),
    sourceStatus: asset?.intraday ? "intraday" : "last_available",
    updatedAt: asset?.intradayAsOf ?? asset?.tradetime ?? asset?.date ?? null,
    reasons,
    disclaimer: "Indicativo quantitativo para apoio à decisão. Não executa ordens e não substitui sua análise final.",
  };
}
