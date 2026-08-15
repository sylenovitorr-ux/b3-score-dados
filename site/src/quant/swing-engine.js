import { clamp, finite, mean, rsi, returnsFromSeries, stdev } from "./statistics.js";

const clean = (series = []) => series.filter((row) => finite(row?.close) !== null).sort((a, b) => String(a.date).localeCompare(String(b.date)));
const avg = (values, window) => values.length >= window ? mean(values.slice(-window)) : null;
const slope = (values, window, lag = 10) => values.length >= window + lag ? (mean(values.slice(-window)) / mean(values.slice(-window - lag, -lag)) - 1) * 100 : null;
const ret = (values, window) => values.length > window ? (values.at(-1) / values.at(-1 - window) - 1) * 100 : null;
const score = (value, low, high) => value === null ? null : clamp((value - low) / (high - low) * 100);

export function swingSnapshot(series = [], anomaly = null) {
  const rows = clean(series), closes = rows.map((row) => row.close), price = closes.at(-1) ?? null;
  const ma20 = avg(closes, 20), ma50 = avg(closes, 50), ma200 = avg(closes, 200);
  const returns = returnsFromSeries(rows);
  const volume20 = rows.length >= 20 ? mean(rows.slice(-20, -1).map((row) => finite(row.volume)).filter((value) => value !== null)) : null;
  const volumeRatio = volume20 && finite(rows.at(-1)?.volume) !== null ? rows.at(-1).volume / volume20 : null;
  return { sessions: rows.length, price, return5: ret(closes, 5), return20: ret(closes, 20), return60: ret(closes, 60), return126: ret(closes, 126), return252: ret(closes, 252), ma20, ma50, ma200, slope20: slope(closes, 20), slope50: slope(closes, 50), slope200: slope(closes, 200), rsi14: rsi(closes, 14), volatility60: returns.length >= 60 ? stdev(returns.slice(-60)) * Math.sqrt(252) * 100 : null, volumeRatio, high20: closes.length >= 20 ? Math.max(...closes.slice(-20)) : null, low20: closes.length >= 20 ? Math.min(...closes.slice(-20)) : null, anomalyScore: anomaly?.score ?? null, referenceDate: rows.at(-1)?.date ?? null, source: "B3 COTAHIST" };
}

export function trendClassification(s) {
  const checks = [s.price > s.ma20, s.ma20 > s.ma50, s.ma50 > s.ma200, s.return60 > 0, s.return126 > 0].filter((value) => value === true).length;
  const negative = [s.price < s.ma20, s.ma20 < s.ma50, s.ma50 < s.ma200, s.return60 < 0, s.return126 < 0].filter((value) => value === true).length;
  if (s.sessions < 126 || s.ma50 === null) return { label: "Dados insuficientes", tone: "neutral", checks, reason: "São necessários ao menos 126 pregões para classificar a tendência de médio prazo." };
  if (checks >= 5) return { label: "Tendência forte", tone: "positive", checks, reason: "Preço e médias estão alinhados, com retornos de 60 e 126 pregões positivos." };
  if (checks >= 3) return { label: "Tendência positiva", tone: "positive", checks, reason: "Há maioria de sinais construtivos, sem alinhamento completo." };
  if (negative >= 4) return { label: "Tendência fortemente negativa", tone: "negative", checks, reason: "Preço, médias e retornos indicam deterioração conjunta." };
  if (negative >= 2) return { label: "Tendência negativa", tone: "negative", checks, reason: "Parte relevante de preço e momentum está deteriorada." };
  return { label: "Neutra", tone: "neutral", checks, reason: "Não há direção consistente nas métricas disponíveis." };
}

export function buildTimingScore(series = [], anomaly = null) {
  const s = swingSnapshot(series, anomaly), trend = trendClassification(s);
  if (s.sessions < 127) return { score: null, coverage: 0, state: "Dados insuficientes", trend, stretched: false, snapshot: s, inputs: [], formula: "São necessários 126 retornos de pregão (127 preços) para a leitura Swing 3–6M.", limitation: "Dados insuficientes para calcular o Timing Score de médio prazo; ausência não é nota zero." };
  const stretched = (s.rsi14 !== null && s.rsi14 >= 75) || (s.return5 !== null && s.return5 > 15) || (s.ma20 && s.price / s.ma20 - 1 > .12) || (s.volumeRatio !== null && s.volumeRatio >= 3);
  const parts = [
    [s.price !== null && s.ma50 !== null ? s.price > s.ma50 ? 100 : 0 : null, 22, "preço versus MM50"],
    [s.slope50 !== null ? s.slope50 > 0 ? 100 : 0 : null, 15, "inclinação MM50"],
    [s.ma50 !== null && s.ma200 !== null ? s.ma50 > s.ma200 ? 100 : 0 : null, 18, "MM50 versus MM200"],
    [s.return60 !== null ? score(s.return60, -15, 20) : null, 15, "retorno 60d"],
    [s.return126 !== null ? score(s.return126, -25, 35) : null, 12, "retorno 126d"],
    [s.rsi14 !== null ? (s.rsi14 >= 45 && s.rsi14 <= 70 ? 100 : s.rsi14 > 75 ? 20 : 45) : null, 10, "RSI14"],
    [s.volumeRatio !== null ? (s.volumeRatio >= .8 && s.volumeRatio <= 2 ? 100 : s.volumeRatio > 3 ? 30 : 55) : null, 8, "volume versus média"],
  ];
  const valid = parts.filter(([value]) => value !== null), weight = valid.reduce((sum, [, w]) => sum + w, 0);
  const value = weight ? Math.round(valid.reduce((sum, [v, w]) => sum + v * w, 0) / weight) : null;
  const state = value === null ? "Dados insuficientes" : stretched ? "Movimento esticado" : trend.tone === "negative" ? "Tendência deteriorando" : value >= 75 ? "Timing favorável" : value >= 55 ? "Timing aceitável" : "Aguardar confirmação";
  return { score: value, coverage: weight, state, trend, stretched, snapshot: s, inputs: valid.map(([value, itemWeight, label]) => ({ label, value, weight: itemWeight, effectiveWeight: weight ? itemWeight / weight * 100 : null })), formula: "Timing Score pondera tendência, retornos, RSI e volume; indicadores ausentes não viram zero e o peso é redistribuído entre entradas válidas.", limitation: "Timing é contexto de entrada, não previsão de valorização nem ordem automática." };
}

export function buildSwingCandidate(asset, quant, anomaly = null) {
  const timing = buildTimingScore(anomaly?.series ?? [], anomaly), quality = quant?.score ?? null, confidence = quant?.confidence ?? null;
  const liquidity = quant?.components?.liquidity?.value ?? null, risk = quant?.components?.risk?.value ?? null;
  const composite = mean([quality, timing.score, confidence, liquidity, risk]);
  const state = composite === null || timing.coverage < 45 ? "Dados insuficientes" : timing.stretched ? "Aguardar" : quality >= 75 && confidence >= 70 && timing.score >= 70 && timing.trend.tone === "positive" ? "Excelente candidato" : quality >= 65 && timing.score >= 55 && timing.trend.tone !== "negative" ? "Bom candidato" : risk !== null && risk < 40 ? "Risco elevado" : "Candidato intermediário";
  const positives = [quality >= 70 ? "qualidade quantitativa suficiente" : null, timing.trend.tone === "positive" ? timing.trend.label : null, timing.score >= 70 ? "timing consistente" : null, liquidity >= 60 ? "liquidez adequada" : null].filter(Boolean);
  const cautions = [timing.stretched ? "Movimento forte, porém entrada potencialmente esticada." : null, confidence !== null && confidence < 60 ? "Nota elevada com baixa cobertura/confiança dos dados." : null, quality >= 70 && timing.trend.tone === "negative" ? "Ativo fundamentalmente atrativo, porém tendência de médio prazo desfavorável." : null].filter(Boolean);
  return { ticker: asset?.ticker, score: composite === null ? null : Math.round(composite), quality, timing, confidence, liquidity, risk, state, positives, cautions, formula: "Candidato Swing combina qualidade do ativo, timing, confiança, liquidez e risco com pesos iguais provisórios; regra pendente de validação por backtest." };
}
