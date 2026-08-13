import { profileConfig, QUANT_MODEL_VERSION, validateWeights } from "./config.js";
import { assetDataHealth } from "./data-quality.js";
import { clamp, finite, maximumDrawdown, mean, quantile, returnsFromSeries, rsi, stdev } from "./statistics.js";

const unavailable = (model, reason) => ({ model, available: false, value: null, confidence: 0, inputs: [], formula: null, calculation: null, limitation: reason });
const scoreBand = (value, bands) => {
  if (finite(value) === null) return null;
  for (const [limit, score] of bands) if (value >= limit) return score;
  return bands.at(-1)?.[1] ?? null;
};
const input = (label, value, source, referenceDate, state = "raw") => ({ label, value: finite(value), source, referenceDate, state });

export function technicalSnapshot(series = []) {
  const rows = series.filter((row) => finite(row?.close) !== null).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const closes = rows.map((row) => row.close);
  const last = closes.at(-1) ?? null;
  const ret = (sessions) => closes.length > sessions && closes.at(-1 - sessions) > 0 ? (last / closes.at(-1 - sessions) - 1) * 100 : null;
  const movingAverage = (sessions) => closes.length >= sessions ? mean(closes.slice(-sessions)) : null;
  const distance = (reference) => finite(reference) !== null && reference !== 0 ? (last / reference - 1) * 100 : null;
  const maximum = closes.length ? Math.max(...closes) : null;
  const minimum = closes.length ? Math.min(...closes) : null;
  return {
    sessions: closes.length,
    return1m: ret(20), return3m: ret(60), return6m: ret(126), return12m: ret(252),
    ma20: movingAverage(20), ma50: movingAverage(50), ma200: movingAverage(200), rsi14: rsi(closes, 14),
    distanceFromHighPct: distance(maximum), distanceFromLowPct: distance(minimum),
    source: "B3 COTAHIST", referenceDate: rows.at(-1)?.date ?? null,
  };
}

export function riskSnapshot(series = []) {
  const cleanReturns = returnsFromSeries(series);
  const volatility = (sessions) => cleanReturns.length >= sessions ? stdev(cleanReturns.slice(-sessions)) * Math.sqrt(252) * 100 : null;
  const var95 = cleanReturns.length >= 30 ? -quantile(cleanReturns, .05) * 100 : null;
  return {
    sessions: series.length,
    volatility20Pct: volatility(20), volatility60Pct: volatility(60), volatility126Pct: volatility(126), volatility252Pct: volatility(252),
    historicalVaR95OneDayPct: var95,
    maximumDrawdown: maximumDrawdown(series),
    beta: null,
    betaLimitation: "Dados sincronizados do IBOV não estão disponíveis para a mesma janela.",
    formula: "volatilidade anualizada = desvio-padrão dos retornos diários × √252; VaR histórico 95% = oposto do percentil 5% dos retornos.",
    source: "B3 COTAHIST",
    referenceDate: series.at(-1)?.date ?? null,
  };
}

function dcfModel(asset, profile) {
  const f = asset.fundamentals;
  if (!f) return unavailable("DCF", "Dados insuficientes para cálculo por DCF.");
  const history = (f.history ?? []).map((row) => ({ year: row.year, value: finite(row.cashFlow?.freeCashFlow) })).filter((row) => row.value !== null).slice(0, 5);
  const shares = finite(f.sharesOutstanding);
  if (history.length < 3 || !shares || shares <= 0 || history.some((row) => row.value <= 0)) return unavailable("DCF", "São necessários ao menos três fluxos de caixa livre positivos e quantidade de ações válida.");
  const baseFcf = mean(history.slice(0, 3).map((row) => row.value));
  const observedGrowth = finite(f.revenueGrowth) ?? 0;
  const growth = clamp(observedGrowth, -5, profile.valuation.explicitGrowthCapPct) / 100;
  const discount = profile.valuation.discountRatePct / 100;
  const terminal = profile.valuation.terminalGrowthPct / 100;
  if (discount <= terminal) return unavailable("DCF", "A taxa de desconto precisa ser superior ao crescimento terminal.");
  let present = 0;
  const forecasts = [];
  for (let year = 1; year <= 5; year += 1) {
    const cashFlow = baseFcf * (1 + growth) ** year;
    const discounted = cashFlow / (1 + discount) ** year;
    present += discounted;
    forecasts.push({ year, cashFlow, discounted });
  }
  const terminalValue = forecasts.at(-1).cashFlow * (1 + terminal) / (discount - terminal);
  const terminalPresent = terminalValue / (1 + discount) ** 5;
  const equityValue = present + terminalPresent - Math.max(0, finite(f.netDebt) ?? 0);
  const value = equityValue > 0 ? equityValue / shares : null;
  if (!value) return unavailable("DCF", "O valor patrimonial do fluxo descontado não ficou positivo.");
  return {
    model: "DCF", available: true, value, confidence: Math.min(85, 45 + history.length * 8), weight: 35,
    inputs: [input("FCF médio de 3 anos", baseFcf, "CVM DFP", f.referenceDate), input("Crescimento explícito", growth * 100, "Premissa configurável", null, "estimate"), input("Taxa de desconto", discount * 100, "Premissa configurável", null, "estimate"), input("Crescimento terminal", terminal * 100, "Premissa configurável", null, "estimate"), input("Ações", shares, "CVM", f.referenceDate), input("Dívida líquida", finite(f.netDebt), "CVM", f.referenceDate)],
    formula: "Σ FCFₜ/(1+r)ᵗ + [FCF₅×(1+g)/(r−g)]/(1+r)⁵ − dívida líquida; dividido pelas ações.",
    calculation: { forecasts, terminalValue, terminalPresent, enterprisePresentValue: present + terminalPresent, equityValue },
    limitation: "Estimativa sensível às taxas configuradas e à recorrência do fluxo de caixa.",
  };
}

export function valuationConsensus(asset, profileInput = profileConfig("aggressive")) {
  const profile = profileInput.weights ? profileInput : profileConfig(profileInput);
  const f = asset.fundamentals;
  const models = [];
  if (asset.kind === "fii") {
    const nav = finite(asset.fund?.navPerShare);
    models.push(nav && nav > 0 ? { model: "Valor patrimonial por cota", available: true, value: nav, confidence: asset.fund?.scores?.confidence ?? 60, weight: 100, inputs: [input("VPA/cota", nav, "CVM Informe Mensal FII", asset.fund?.referenceDate)], formula: "valor justo patrimonial = patrimônio líquido ÷ cotas emitidas", calculation: { navPerShare: nav }, limitation: "Não captura qualidade dos imóveis, renda futura ou prêmio/desconto estrutural." } : unavailable("Valor patrimonial por cota", "Dados insuficientes para calcular."));
  } else if (!f) {
    models.push(unavailable("Graham", "Dados insuficientes para calcular."), unavailable("Múltiplo de lucro", "Dados insuficientes para calcular."), unavailable("Múltiplo patrimonial", "Dados insuficientes para calcular."), unavailable("DCF", "Dados insuficientes para cálculo por DCF."));
  } else {
    const eps = finite(f.eps);
    const bvps = finite(f.bookValuePerShare);
    models.push(eps > 0 && bvps > 0 ? { model: "Graham", available: true, value: Math.sqrt(22.5 * eps * bvps), confidence: 72, weight: 25, inputs: [input("LPA", eps, "CVM DFP/ITR", f.referenceDate), input("VPA", bvps, "CVM DFP/ITR", f.referenceDate)], formula: "√(22,5 × LPA × VPA)", calculation: { product: 22.5 * eps * bvps }, limitation: "Inadequado para prejuízo, patrimônio negativo e negócios sem estabilidade." } : unavailable("Graham", "Exige LPA e VPA positivos."));
    models.push(eps > 0 ? { model: "Múltiplo de lucro", available: true, value: eps * profile.valuation.targetPE, confidence: 62, weight: 20, inputs: [input("LPA", eps, "CVM DFP/ITR", f.referenceDate), input("P/L-alvo", profile.valuation.targetPE, "Premissa configurável", null, "estimate")], formula: "LPA × P/L-alvo", calculation: { eps, targetPE: profile.valuation.targetPE }, limitation: "O múltiplo-alvo é premissa e precisa ser comparado ao setor." } : unavailable("Múltiplo de lucro", "Exige lucro por ação positivo."));
    models.push(bvps > 0 ? { model: "Múltiplo patrimonial", available: true, value: bvps * profile.valuation.targetPB, confidence: 58, weight: 20, inputs: [input("VPA", bvps, "CVM DFP/ITR", f.referenceDate), input("P/VP-alvo", profile.valuation.targetPB, "Premissa configurável", null, "estimate")], formula: "VPA × P/VP-alvo", calculation: { bvps, targetPB: profile.valuation.targetPB }, limitation: "Pode enganar em empresas intensivas em intangíveis ou com baixa rentabilidade." } : unavailable("Múltiplo patrimonial", "Exige patrimônio por ação positivo."));
    models.push(dcfModel(asset, profile));
    models.push(unavailable("Fluxo de dividendos", "Histórico anual de dividendos e crescimento estável insuficientes."));
    models.push(unavailable("Múltiplos históricos", "A série histórica de múltiplos ainda não está disponível."));
  }
  const available = models.filter((model) => model.available && finite(model.value) !== null && model.value > 0);
  const simple = mean(available.map((model) => model.value));
  const totalWeight = available.reduce((sum, model) => sum + (model.weight ?? model.confidence), 0);
  const weighted = totalWeight ? available.reduce((sum, model) => sum + model.value * (model.weight ?? model.confidence), 0) / totalWeight : null;
  const confidence = available.length ? Math.round(available.reduce((sum, model) => sum + model.confidence, 0) / available.length * Math.min(1, available.length / 3)) : 0;
  const ordered = available.map((model) => model.value).sort((a, b) => a - b);
  const scenarios = available.length ? [
    { id: "pessimistic", label: "Pessimista", value: ordered[0], premise: "Menor resultado entre os modelos válidos." },
    { id: "base", label: "Base", value: weighted, premise: "Média ponderada pela configuração e confiança dos modelos." },
    { id: "optimistic", label: "Otimista", value: ordered.at(-1), premise: "Maior resultado entre os modelos válidos." },
  ] : [];
  return { modelVersion: QUANT_MODEL_VERSION, models, simple, weighted, confidence, scenarios, probabilities: null, probabilityLimitation: "Probabilidades não são exibidas porque não há modelo estatístico calibrado para esses cenários.", weights: Object.fromEntries(available.map((model) => [model.model, Math.round((model.weight ?? model.confidence) / totalWeight * 100)])) };
}

function consistencyScore(asset) {
  if (asset.kind === "fii") {
    const months = finite(asset.fund?.dyMonthsAvailable);
    return months === null ? null : Math.round(clamp(months / 12 * 100));
  }
  const history = (asset.fundamentals?.history ?? []).slice(0, 5);
  if (history.length < 3) return null;
  const profits = history.map((row) => finite(row.income?.netIncome)).filter((value) => value !== null);
  const cash = history.map((row) => finite(row.cashFlow?.freeCashFlow)).filter((value) => value !== null);
  if (!profits.length && !cash.length) return null;
  return Math.round(mean([profits.length ? profits.filter((value) => value > 0).length / profits.length * 100 : null, cash.length ? cash.filter((value) => value > 0).length / cash.length * 100 : null]));
}

function componentTrace(key, value, formula, source, inputs, limitation = null) {
  return { key, value: finite(value) === null ? null : Math.round(clamp(value)), formula, source, inputs, limitation, state: finite(value) === null ? "unavailable" : "calculated" };
}

export function buildQuantAnalysis(asset, assets = [], anomaly = null, profileInput = "aggressive", overrides = {}) {
  const profile = typeof profileInput === "string" ? profileConfig(profileInput, overrides) : profileInput;
  const valuation = valuationConsensus(asset, profile);
  const technical = technicalSnapshot(anomaly?.series ?? []);
  const risk = riskSnapshot(anomaly?.series ?? []);
  const f = asset.fundamentals;
  const fs = asset.kind === "fii" ? asset.fund?.scores ?? {} : f?.scores ?? {};
  const weightedFair = valuation.weighted;
  const upside = weightedFair && asset.price ? (weightedFair / asset.price - 1) * 100 : null;
  const drawdownAbs = risk.maximumDrawdown ? Math.abs(risk.maximumDrawdown.valuePct) : null;
  const volatility = risk.volatility60Pct ?? risk.volatility20Pct;
  const recentLow = anomaly?.series?.length ? Math.min(...anomaly.series.slice(-20).map((row) => row.close).filter((value) => finite(value) !== null)) : null;
  const configuredStop = asset.price ? asset.price * (1 - profile.limits.drawdownPct / 100) : null;
  const stop = asset.price ? Math.min(asset.price * .99, Math.max(recentLow ?? 0, configuredStop ?? 0)) : null;
  const downside = stop && asset.price ? (asset.price - stop) / asset.price * 100 : null;
  const riskReward = upside !== null && upside > 0 && downside > 0 ? upside / downside : null;
  const momentum = mean([
    technical.return1m === null ? null : clamp(50 + technical.return1m * 2),
    technical.return3m === null ? null : clamp(50 + technical.return3m),
    technical.rsi14 === null ? null : technical.rsi14 > 75 ? 35 : technical.rsi14 < 25 ? 45 : clamp(100 - Math.abs(55 - technical.rsi14) * 2),
  ]);
  const riskScore = mean([volatility === null ? null : clamp(100 - volatility * 1.3), drawdownAbs === null ? null : clamp(100 - drawdownAbs * 1.5), anomaly ? 100 - anomaly.score : null]);
  const liquidity = asset.volume > 0 ? clamp((Math.log10(asset.volume) - 4) / 4 * 100) : null;
  const valuationScore = asset.kind === "fii" ? fs.price : f?.scores?.price;
  const quality = asset.kind === "fii" ? fs.quality : f?.scores?.quality;
  const growth = asset.kind === "fii" ? null : f?.scores?.growth;
  const profitability = asset.kind === "fii" ? mean([fs.income, fs.quality]) : mean([scoreBand(f?.roe, [[25, 95], [18, 85], [12, 70], [8, 55], [-1e9, 20]]), scoreBand(f?.roic, [[20, 95], [15, 82], [10, 68], [5, 48], [-1e9, 20]]), f?.scores?.quality]);
  const debt = asset.kind === "fii" ? fs.risk : f?.financialCompany ? f?.scores?.quality : f?.scores?.debt;
  const consistency = consistencyScore(asset);
  const asymmetry = riskReward === null ? null : clamp(35 + riskReward * 20);
  const components = {
    valuation: componentTrace("valuation", valuationScore, "Score de valuation já auditado no motor fundamental.", asset.kind === "fii" ? "B3 + CVM FII" : "B3 + CVM DFP/ITR", [{ label: "score de preço", value: valuationScore }]),
    quality: componentTrace("quality", quality, "Score de qualidade publicado para a classe do ativo.", "CVM", [{ label: "qualidade", value: quality }]),
    growth: componentTrace("growth", growth, "Combinação de crescimento de receita e lucro, sem converter virada de sinal em percentual.", "CVM DFP", [{ label: "crescimento", value: growth }], asset.kind === "fii" ? "Não aplicável ao FII com os dados atuais." : null),
    profitability: componentTrace("profitability", profitability, "Média das evidências disponíveis de rentabilidade.", "CVM", [{ label: "ROE", value: f?.roe ?? null }, { label: "ROIC", value: f?.roic ?? null }]),
    debt: componentTrace("debt", debt, asset.kind === "fii" ? "Score de risco de passivos e inadimplência." : f?.financialCompany ? "Instituição financeira: usa qualidade, sem múltiplo industrial de dívida." : "Score de alavancagem e liquidez corrente.", "CVM", [{ label: "endividamento/risco", value: debt }]),
    momentum: componentTrace("momentum", momentum, "Média normalizada de retorno 20d, retorno 60d e RSI14.", "B3 COTAHIST", [{ label: "retorno 20d", value: technical.return1m }, { label: "retorno 60d", value: technical.return3m }, { label: "RSI14", value: technical.rsi14 }]),
    risk: componentTrace("risk", riskScore, "Média de 100−1,3×volatilidade, 100−1,5×drawdown e segurança contra anomalias.", "B3 COTAHIST", [{ label: "volatilidade anualizada", value: volatility }, { label: "drawdown máximo", value: risk.maximumDrawdown?.valuePct ?? null }, { label: "anomalia", value: anomaly?.score ?? null }]),
    liquidity: componentTrace("liquidity", liquidity, "normalização logarítmica do volume financeiro diário entre 10⁴ e 10⁸.", "B3 COTAHIST", [{ label: "volume", value: asset.volume }]),
    consistency: componentTrace("consistency", consistency, asset.kind === "fii" ? "Meses com DY disponível ÷ 12." : "Média da recorrência de lucro e FCF positivos nos anos disponíveis.", "CVM", [{ label: "consistência", value: consistency }]),
    asymmetry: componentTrace("asymmetry", asymmetry, "35 + 20 × relação risco/retorno, limitada a 0–100.", "Cálculo B3 Score", [{ label: "upside", value: upside }, { label: "downside", value: downside }, { label: "R:R", value: riskReward }]),
  };
  const fundamentalReference = asset.kind === "fii" ? asset.fund?.referenceDate : f?.referenceDate;
  for (const [key, component] of Object.entries(components)) {
    const marketDerived = ["momentum", "risk", "liquidity", "asymmetry"].includes(key);
    component.referenceDate = marketDerived ? (anomaly?.lastDate ?? asset.date ?? null) : (fundamentalReference ?? null);
    component.confidence = component.value === null ? 0 : marketDerived ? Math.round(Math.min(100, (technical.sessions || 1) / 60 * 100)) : (fs.confidence ?? 50);
    component.quality = component.source?.includes("CVM") || component.source?.includes("B3") ? "official/derived" : "derived";
  }
  const valid = Object.entries(profile.weights).filter(([key]) => components[key]?.value !== null);
  const availableWeight = valid.reduce((sum, [, weight]) => sum + weight, 0);
  const score = availableWeight ? Math.round(valid.reduce((sum, [key, weight]) => sum + components[key].value * weight, 0) / availableWeight) : null;
  const health = assetDataHealth(asset, anomaly);
  const sourceQuality = mean(Object.values(health).map((item) => item.confidence));
  const coverage = availableWeight;
  const confidence = Math.round(clamp((sourceQuality ?? 0) * .45 + coverage * .4 + (100 - (anomaly?.score ?? 0)) * .15));
  const safetyMargin = profile.limits.safetyMarginPct / 100;
  const entry = weightedFair ? weightedFair * (1 - safetyMargin) : null;
  const classification = score === null || upside === null ? "Dados insuficientes" : upside >= 30 && score >= 75 ? "Muito atrativo" : upside >= 12 && score >= 62 ? "Atrativo" : upside > -8 ? "Neutro" : upside > -22 ? "Caro" : "Muito caro";
  return {
    modelVersion: QUANT_MODEL_VERSION, profile, weightValidation: validateWeights(profile), score, confidence, coverage: Math.round(coverage), classification,
    components, valuation, technical, risk, dataHealth: health,
    levels: { current: asset.price, fair: weightedFair, entry, exit: weightedFair, safetyMarginPct: profile.limits.safetyMarginPct, stop, upsidePct: upside, downsidePct: downside, riskReward },
    limitations: [
      technical.sessions < 126 ? "Histórico local inferior a 126 pregões: métricas de 6 e 12 meses permanecem indisponíveis." : null,
      risk.beta === null ? risk.betaLimitation : null,
      valuation.models.filter((model) => !model.available).length ? "Modelos sem entradas válidas não participam do consenso." : null,
    ].filter(Boolean),
  };
}

export function backtestMomentum(series = []) {
  if (series.length < 126) return { available: false, reason: "Dados insuficientes para backtest: mínimo de 126 pregões." };
  const rows = series.filter((row) => finite(row.close) !== null);
  const trades = [];
  let entry = null;
  for (let index = 50; index < rows.length; index += 1) {
    const ma20 = mean(rows.slice(index - 20, index).map((row) => row.close));
    const ma50 = mean(rows.slice(index - 50, index).map((row) => row.close));
    if (!entry && ma20 > ma50) entry = rows[index];
    if (entry && ma20 < ma50) { trades.push((rows[index].close / entry.close - 1) * 100); entry = null; }
  }
  if (entry) trades.push((rows.at(-1).close / entry.close - 1) * 100);
  if (trades.length < 5) return { available: false, reason: "Poucas operações para estatística minimamente representativa." };
  const wins = trades.filter((value) => value > 0);
  const losses = trades.filter((value) => value <= 0);
  const avgWin = mean(wins) ?? 0;
  const avgLoss = Math.abs(mean(losses) ?? 0);
  const winRate = wins.length / trades.length;
  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  return { available: true, period: { start: rows[0].date, end: rows.at(-1).date }, operations: trades.length, winRatePct: winRate * 100, averageGainPct: avgWin, averageLossPct: avgLoss, expectancyPct: expectancy, profitFactor: grossLoss === 0 ? null : grossProfit / grossLoss, methodology: "Cruzamento MM20/MM50, sem custos e sem otimização. Resultado passado não garante retorno futuro." };
}
