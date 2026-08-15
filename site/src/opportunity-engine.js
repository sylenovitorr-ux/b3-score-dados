const bounded = (value, low = 0, high = 100) => Math.max(low, Math.min(high, value));
const finite = (value) => Number.isFinite(value) ? value : null;
const fmt = (value, digits = 1) => Number(value).toLocaleString("pt-BR", { maximumFractionDigits: digits });

function weightedAverage(parts) {
  const valid = parts.filter((part) => finite(part.value) !== null && part.weight > 0);
  const availableWeight = valid.reduce((sum, part) => sum + part.weight, 0);
  const score = availableWeight ? Math.round(valid.reduce((sum, part) => sum + part.value * part.weight, 0) / availableWeight) : null;
  const components = valid.map((part) => ({ ...part, effectiveWeight: part.weight / availableWeight * 100, contribution: part.value * part.weight / availableWeight }));
  return { score, availableWeight, components };
}

export function fairValueRange(asset) {
  if (asset.kind === "fii" && asset.fund) {
    const f = asset.fund;
    if (!(f.navPerShare > 0)) return null;
    const quality = (f.scores.quality ?? 50) / 100;
    const safety = (f.scores.risk ?? 50) / 100;
    const targetPb = bounded(.78 + quality * .16 + safety * .14, .72, 1.08);
    const base = f.navPerShare * targetPb;
    return { low: base * .88, base, high: base * 1.12, model: "FII patrimonial", method: `VP/cota × P/VP-alvo ${fmt(targetPb, 2)} ajustado por qualidade e risco`, anchors: [{ label: "Patrimônio", value: base, weight: 100 }] };
  }
  const f = asset.fundamentals;
  if (!f) return null;
  const anchors = [];
  const addAnchor = (anchor) => {
    const price = finite(asset?.price);
    // CVM share quantities occasionally arrive in thousands without an
    // explicit scale. Preserve the raw fact, but reject a dimensionally
    // incompatible per-share anchor from the automatic ranking.
    if (price > 0 && anchor.value / price > 10) return;
    anchors.push(anchor);
  };
  if (f.financialCompany) {
    if (f.bookValuePerShare > 0) {
      const targetPb = bounded(.65 + Math.max(0, f.roe ?? 0) / 20, .65, 2.2);
      addAnchor({ value: f.bookValuePerShare * targetPb, label: `VPA × P/VP-alvo ${fmt(targetPb)}`, weight: 70 });
    }
    if (f.eps > 0) {
      const targetPe = bounded(7 + Math.max(0, f.roe ?? 0) * .22 + bounded(f.profitGrowth ?? 0, -5, 15) * .08, 7, 14);
      addAnchor({ value: f.eps * targetPe, label: `LPA × P/L-alvo ${fmt(targetPe)}`, weight: 30 });
    }
  } else {
    if (f.eps > 0) {
      const targetPe = bounded(8 + Math.max(0, f.roe ?? 0) * .35 + bounded(f.revenueGrowth ?? 0, -5, 15) * .15, 7, 18);
      addAnchor({ value: f.eps * targetPe, label: `LPA × P/L-alvo ${fmt(targetPe)}`, weight: 45 });
    }
    if (f.bookValuePerShare > 0) {
      const targetPb = bounded(.65 + Math.max(0, f.roe ?? 0) / 20, .65, 2);
      addAnchor({ value: f.bookValuePerShare * targetPb, label: `VPA × P/VP-alvo ${fmt(targetPb)}`, weight: 25 });
    }
    if (f.ebitdaTTM > 0 && f.sharesOutstanding > 0) {
      const targetEvEbitda = bounded(5 + Math.max(0, f.roic ?? 0) * .12 + bounded(f.revenueGrowth ?? 0, -5, 15) * .08, 4.5, 9);
      const equityValue = f.ebitdaTTM * targetEvEbitda - (f.netDebt ?? 0);
      if (equityValue > 0) addAnchor({ value: equityValue / f.sharesOutstanding, label: `EBITDA × EV/EBITDA-alvo ${fmt(targetEvEbitda)}`, weight: 30 });
    }
  }
  const valid = anchors.filter((anchor) => anchor.value > 0 && Number.isFinite(anchor.value));
  if (!valid.length) return null;
  const totalWeight = valid.reduce((sum, anchor) => sum + anchor.weight, 0);
  const base = valid.reduce((sum, anchor) => sum + anchor.value * anchor.weight, 0) / totalWeight;
  const spread = f.financialCompany ? .15 : .2;
  return { low: base * (1 - spread), base, high: base * (1 + spread), model: f.financialCompany ? "Instituição financeira" : "Empresa não financeira", method: valid.map((anchor) => anchor.label).join(" + "), anchors: valid.map((anchor) => ({ ...anchor, effectiveWeight: Math.round(anchor.weight / totalWeight * 100) })) };
}

export function buildPositionPlan(asset, anomaly = null) {
  const fair = fairValueRange(asset);
  const price = finite(asset?.price);
  if (!fair || !(price > 0)) return null;
  const dailyVolatility = finite(anomaly?.dailyVolatilityPct) ?? Math.max(2, Math.abs(finite(asset.changepct) ?? 0));
  const riskBand = bounded(dailyVolatility / 100 * 2, .04, .12);
  const immediate = price <= fair.low;
  const entryBase = immediate ? price : fair.low;
  const entryLow = entryBase * (1 - riskBand / 2);
  const entryHigh = Math.min(fair.low * 1.03, entryBase * (1 + riskBand / 2));
  const defensiveRisk = bounded(dailyVolatility / 100 * 2.5, .08, .20);
  const defensiveExit = entryLow * (1 - defensiveRisk);
  const potentialPct = (fair.base / price - 1) * 100;
  const marginFromEntryPct = (fair.base / entryHigh - 1) * 100;
  const confidence = asset.kind === "fii" ? asset.fund?.scores?.confidence : asset.fundamentals?.scores?.confidence;
  let horizon = "18–24 meses";
  if ((confidence ?? 0) >= 75 && dailyVolatility < 2) horizon = "12–18 meses";
  if ((confidence ?? 0) < 55 || dailyVolatility >= 3.5) horizon = "24–36 meses";
  const validMargin = marginFromEntryPct >= 10;
  return {
    currentPrice: price, fair, entryLow, entryHigh, targetBase: fair.base, targetHigh: fair.high,
    defensiveExit, dailyVolatility, potentialPct, marginFromEntryPct, horizon,
    status: !validMargin ? "Sem margem matemática suficiente" : immediate ? "Preço dentro da zona calculada" : "Aguardar entrada na faixa",
    tone: !validMargin ? "caution" : immediate ? "ready" : "wait",
    conditions: [
      "Recalcular após novo balanço, informe mensal do FII ou mudança material nos fundamentos.",
      "Suspender a leitura se houver grupamento, desdobramento, provento extraordinário ou fato relevante ainda não refletido.",
      "A saída defensiva é uma referência de risco, não uma ordem automática nem garantia contra perdas."
    ],
    method: `Faixa justa pelo modelo ${fair.model}; entrada limitada pela base conservadora e por ${fmt(riskBand * 100)}% de banda de volatilidade; saída defensiva calibrada em ${fmt(defensiveRisk * 100)}%.`
  };
}

export function buildActionSignal(asset, assets = [], anomaly = null) {
  const plan = buildPositionPlan(asset, anomaly);
  if (!plan) return { code: "unavailable", label: "Dados insuficientes", tone: "neutral", holder: "Revisar os dados", newcomer: "Não iniciar posição", reasons: ["Não há âncoras suficientes para calcular valor justo e margem de segurança."] };
  const opportunity = asset.kind === "fii" ? null : buildOpportunity(asset, assets);
  const scores = asset.kind === "fii" ? asset.fund?.scores : asset.fundamentals?.scores;
  const quality = asset.kind === "fii" ? scores?.overall : opportunity?.fundamental?.score;
  const confidence = scores?.confidence ?? opportunity?.confidence ?? 0;
  const severe = Boolean(opportunity?.penalties?.some((item) => item.severe));
  const valuationBlocked = Boolean(opportunity?.valuationRisk?.blocksPositiveSignal);
  const anomalyScore = anomaly?.score ?? 0;
  const reasons = [`Preço atual ${fmt(plan.potentialPct)}% em relação ao valor justo central.`, `Qualidade ${quality ?? "N/D"}/100 e confiança ${confidence}/100.`];
  if (anomalyScore >= 40) reasons.push(`Movimento com alerta estatístico ${anomalyScore}/100; investigar antes de agir.`);
  if (severe) reasons.push("Há penalidade fundamental grave no histórico disponível.");
  if (valuationBlocked) reasons.push(`${opportunity.valuationRisk.label}: ${opportunity.valuationRisk.reasons.join("; ")}.`);

  if (severe || (quality !== null && quality < 40)) {
    return { code: "reduce", label: "Reavaliar: reduzir ou vender", tone: "sell", holder: "Reavaliar e considerar redução", newcomer: "Evitar nova entrada", reasons, plan, quality, confidence, anomalyScore };
  }
  if (asset.price >= plan.fair.high) {
    return { code: "realize", label: "Boa faixa para realizar ou vender", tone: "sell", holder: "Considerar realização parcial", newcomer: "Não comprar acima da faixa justa", reasons, plan, quality, confidence, anomalyScore };
  }
  if (valuationBlocked) {
    return { code: "wait", label: "Aguardar validação do valuation", tone: "wait", holder: "Manter somente após revisar as premissas", newcomer: "Não iniciar posição só pelo potencial calculado", reasons, plan, quality, confidence, anomalyScore };
  }
  if (asset.price <= plan.fair.low && (quality ?? 0) >= 65 && confidence >= 60 && anomalyScore < 40) {
    return { code: "buy", label: "Boa faixa para comprar", tone: "buy", holder: "Manter ou aportar dentro do limite", newcomer: "Entrada matematicamente favorável", reasons, plan, quality, confidence, anomalyScore };
  }
  if (asset.price <= plan.fair.high && (quality ?? 0) >= 55 && !severe) {
    return { code: "hold", label: "Boa para manter", tone: "hold", holder: "Manter e acompanhar a tese", newcomer: asset.price <= plan.fair.base ? "Entrada parcial, com cautela" : "Aguardar margem melhor", reasons, plan, quality, confidence, anomalyScore };
  }
  return { code: "wait", label: "Aguardar", tone: "wait", holder: "Manter somente se a tese continuar válida", newcomer: "Não iniciar posição agora", reasons, plan, quality, confidence, anomalyScore };
}

// Camada de apresentação: reduz a leitura operacional a três estados sem
// apagar os bloqueios e motivos detalhados do sinal original.
export function buildThreeWayDecision(asset, assets = [], anomaly = null) {
  const signal = buildActionSignal(asset, assets, anomaly);
  if (signal.code === "unavailable") return {
    state: "unavailable", label: "DADOS INSUFICIENTES", tone: "neutral", score: null, coverage: 0, signal,
    inputs: [], formula: "Sem preço atual e valor justo verificável, não há base para gerar a nota de parâmetro.",
  };
  const valuation = finite(signal.plan?.potentialPct) === null ? null : bounded(50 + signal.plan.potentialPct * 1.5);
  const integrity = bounded(100 - (finite(signal.anomalyScore) ?? 0));
  const total = weightedAverage([
    { key: "fundamentos", label: "Fundamentos", value: signal.quality, weight: 40 },
    { key: "valuation", label: "Preço versus justo", value: valuation, weight: 25 },
    { key: "confianca", label: "Confiança dos dados", value: signal.confidence, weight: 20 },
    { key: "integridade", label: "Integridade do movimento", value: integrity, weight: 15 },
  ]);
  const state = signal.code === "buy" ? "buy" : ["reduce", "realize"].includes(signal.code) ? "sell" : "hold";
  const copy = {
    buy: { label: "COMPRAR", tone: "buy", explanation: "A faixa de preço, qualidade, confiança e risco passaram simultaneamente pelos filtros do modelo." },
    hold: { label: "MANTER", tone: "hold", explanation: "O modelo não encontrou simultaneamente condições suficientes para compra nem motivo quantitativo para venda; acompanhe a tese e a faixa de preço." },
    sell: { label: "VENDER", tone: "sell", explanation: "O preço está em faixa de realização ou os filtros identificaram deterioração que pede reavaliação antes de manter exposição." },
  }[state];
  return {
    state, ...copy, score: total.score, coverage: Math.round(total.availableWeight), signal,
    inputs: total.components,
    formula: "Nota = Fundamentos (40%) + preço versus valor justo (25%) + confiança dos dados (20%) + integridade do movimento (15%). Pesos indisponíveis são retirados e os restantes são renormalizados.",
  };
}

export function cashFlowScore(f) {
  const rows = (f.history ?? []).slice(0, 5).map((row) => row.cashFlow?.freeCashFlow).filter(Number.isFinite);
  if (!rows.length) return null;
  const positive = rows.filter((value) => value > 0).length / rows.length * 100;
  return Math.round(bounded(positive + (rows[0] > 0 ? 10 : -10)));
}

export function profitabilityScore(f) {
  const parts = [];
  if (finite(f.roe) !== null) parts.push(bounded(35 + f.roe * 2));
  if (!f.financialCompany && finite(f.roic) !== null) parts.push(bounded(35 + f.roic * 2.2));
  if (finite(f.netMargin) !== null) parts.push(bounded(40 + f.netMargin * 1.7));
  if (finite(f.scores?.quality) !== null) parts.push(f.scores.quality);
  return parts.length ? Math.round(parts.reduce((sum, value) => sum + value, 0) / parts.length) : null;
}

export function fundamentalQuality(f) {
  const profitability = profitabilityScore(f);
  const health = f.scores?.debt ?? (f.financialCompany ? f.scores?.quality : null);
  const cashFlow = cashFlowScore(f);
  const growth = f.scores?.growth ?? null;
  const result = weightedAverage([{ key: "profitability", label: "Lucratividade", value: profitability, weight: 30 }, { key: "health", label: "Saúde financeira", value: health, weight: 25 }, { key: "cashFlow", label: "Fluxo de caixa", value: cashFlow, weight: 20 }, { key: "growth", label: "Crescimento", value: growth, weight: 15 }, { key: "dividends", label: "Dividendos", value: f.scores?.dividends, weight: 10 }]);
  return { score: result.score, coverage: Math.round(result.availableWeight), components: result.components, profitability, health, cashFlow, growth, dividends: f.scores?.dividends ?? null };
}

export function evEbitdaValue(f) {
  return f?.enterpriseValue > 0 && f?.ebitdaTTM > 0 ? f.enterpriseValue / f.ebitdaTTM : null;
}

function peerGroupKey(f) {
  return f?.sector || f?.subsector || f?.industrySegment || null;
}

export function relativeValuation(asset, assets) {
  const key = peerGroupKey(asset.fundamentals);
  if (!key) return { score: null, peerCount: 0, group: null, metrics: [] };
  const peers = assets.filter((row) => row.ticker !== asset.ticker && row.fundamentals && peerGroupKey(row.fundamentals) === key && Boolean(row.fundamentals.financialCompany) === Boolean(asset.fundamentals.financialCompany));
  if (peers.length < 5) return { score: null, peerCount: peers.length, group: key, metrics: [] };
  const metrics = [{ label: "P/L", value: asset.fundamentals.pe, get: (row) => row.fundamentals.pe }, { label: "P/VP", value: asset.fundamentals.pb, get: (row) => row.fundamentals.pb }, { label: "EV/EBITDA", value: evEbitdaValue(asset.fundamentals), get: (row) => evEbitdaValue(row.fundamentals) }].flatMap((metric) => {
    if (!(metric.value > 0)) return [];
    const values = peers.map(metric.get).filter((value) => value > 0);
    if (values.length < 5) return [];
    return [{ label: metric.label, value: metric.value, score: Math.round(values.filter((value) => value >= metric.value).length / values.length * 100), observations: values.length }];
  });
  return { score: metrics.length ? Math.round(metrics.reduce((sum, metric) => sum + metric.score, 0) / metrics.length) : null, peerCount: peers.length, group: key, metrics };
}

export function opportunitySignal(score, penalties) {
  if (penalties.some((item) => item.severe)) return { label: "Desfavorável", tone: "bad" };
  if (score >= 80) return { label: "Favorável", tone: "excellent" };
  if (score >= 70) return { label: "Favorável com ressalvas", tone: "good" };
  if (score >= 50) return { label: "Neutro", tone: "mid" };
  if (score >= 30) return { label: "Cautela", tone: "warn" };
  return { label: "Desfavorável", tone: "bad" };
}

export function valuationRiskAssessment({ fair, potential, confidence, fundamental }) {
  if (!fair || finite(potential) === null) return { code: "unavailable", label: "Risco do valuation indisponível", tone: "neutral", points: null, scoreCap: null, blocksPositiveSignal: true, reasons: ["dados insuficientes para testar a sensibilidade do valor justo"], checks: [] };
  const anchors = (fair.anchors ?? []).filter((anchor) => anchor.value > 0 && Number.isFinite(anchor.value));
  const anchorValues = anchors.map((anchor) => anchor.value);
  const dispersionPct = anchorValues.length >= 2 ? (Math.max(...anchorValues) - Math.min(...anchorValues)) / fair.base * 100 : null;
  const absolutePotential = Math.abs(potential);
  const checks = [
    { key: "anchors", label: "Duas ou mais âncoras independentes", passed: anchors.length >= 2, value: anchors.length },
    { key: "confidence", label: "Confiança dos dados ≥ 70%", passed: confidence >= 70, value: confidence },
    { key: "coverage", label: "Cobertura fundamental ≥ 70%", passed: (fundamental?.coverage ?? 0) >= 70, value: fundamental?.coverage ?? 0 },
    { key: "cashFlow", label: "Fluxo de caixa calculado ≥ 50", passed: (fundamental?.cashFlow ?? -1) >= 50, value: fundamental?.cashFlow ?? null },
  ];
  const supportCount = checks.filter((check) => check.passed).length;
  let points = absolutePotential >= 200 ? 25 : absolutePotential >= 100 ? 16 : absolutePotential >= 75 ? 8 : 0;
  if (anchors.length === 1 && absolutePotential >= 60) points += 8;
  if (dispersionPct !== null && dispersionPct > 60) points += 8;
  if (confidence < 60) points += 6;
  if ((fundamental?.coverage ?? 0) < 70) points += 5;
  const code = points >= 25 ? "very-high" : points >= 18 ? "high" : points >= 8 ? "elevated" : "controlled";
  const labels = { "very-high": "Sensibilidade muito alta", high: "Sensibilidade alta", elevated: "Sensibilidade moderada", controlled: "Sensibilidade controlada" };
  const tones = { "very-high": "bad", high: "warn", elevated: "mid", controlled: "good" };
  const reasons = [];
  if (absolutePotential >= 200) reasons.push(`distância de ${fmt(absolutePotential)}% entre preço e valor justo`);
  else if (absolutePotential >= 100) reasons.push(`distância acima de 100% entre preço e valor justo`);
  else if (absolutePotential >= 75) reasons.push(`distância acima de 75% entre preço e valor justo`);
  if (anchors.length === 1) reasons.push("modelo sustentado por uma única âncora");
  if (dispersionPct !== null && dispersionPct > 60) reasons.push(`âncoras divergem ${fmt(dispersionPct)}% da base`);
  if (confidence < 60) reasons.push("confiança dos dados abaixo de 60%");
  if ((fundamental?.coverage ?? 0) < 70) reasons.push("cobertura fundamental abaixo de 70%");
  if (!reasons.length) reasons.push("distância, cobertura e âncoras dentro das travas configuradas");
  let scoreCap = null;
  if (potential >= 200) scoreCap = 49;
  else if (potential >= 100) scoreCap = supportCount >= 3 ? 69 : 59;
  else if (potential >= 75 && supportCount < 2) scoreCap = 69;
  else if (potential > 0 && code === "high") scoreCap = 69;
  return {
    code, label: labels[code], tone: tones[code], points, scoreCap,
    blocksPositiveSignal: scoreCap !== null,
    reasons, checks, anchorCount: anchors.length, dispersionPct, supportCount,
    sensitivityRange: { low: fair.low, base: fair.base, high: fair.high },
    formula: "risco = distância preço/justo + concentração das âncoras + dispersão + confiança + cobertura; o valor justo bruto não é alterado",
  };
}

export function buildOpportunity(asset, assets) {
  const f = asset.fundamentals;
  if (!f) return null;
  const fundamental = fundamentalQuality(f);
  const fair = fairValueRange(asset);
  const potential = fair?.base && asset.price ? (fair.base / asset.price - 1) * 100 : null;
  const discountScore = finite(potential) === null ? null : Math.round(bounded(50 + potential * 1.2));
  const relative = relativeValuation(asset, assets);
  const valuation = relative.score;
  const confidence = f.scores?.confidence ?? 0;
  const calculation = weightedAverage([{ key: "fundamental", label: "Score Fundamental", value: fundamental.score, weight: 45 }, { key: "discount", label: "Desconto sobre o preço justo", value: discountScore, weight: 25 }, { key: "valuation", label: "Valuation relativo", value: valuation, weight: 20 }, { key: "confidence", label: "Confiança dos dados", value: confidence, weight: 10 }]);
  const history = (f.history ?? []).slice(0, 3);
  const losses = history.filter((row) => finite(row.income?.netIncome) !== null && row.income.netIncome <= 0).length;
  const negativeCash = history.filter((row) => finite(row.cashFlow?.freeCashFlow) !== null && row.cashFlow.freeCashFlow <= 0).length;
  const penalties = [];
  if (finite(f.equity) !== null && f.equity <= 0) penalties.push({ label: "patrimônio líquido não positivo", points: 20, severe: true });
  if (losses >= 2) penalties.push({ label: "prejuízo recorrente", points: 15, severe: true });
  if (negativeCash >= 2) penalties.push({ label: "fluxo de caixa livre negativo recorrente", points: 12, severe: false });
  if (!f.financialCompany && f.netDebtEbitda > 5) penalties.push({ label: "dívida líquida/EBITDA acima de 5", points: 10, severe: false });
  const coverage = Math.round(45 * fundamental.coverage / 100 + (discountScore === null ? 0 : 25) + (valuation === null ? 0 : 20) + 10);
  const rawScore = calculation.score ?? 0;
  const penaltyPoints = penalties.reduce((sum, item) => sum + item.points, 0);
  let score = Math.round(bounded(rawScore - penaltyPoints));
  const caps = [];
  if (coverage < 50) { score = Math.min(score, 59); caps.push("cobertura inferior a 50%"); }
  else if (coverage < 70) { score = Math.min(score, 69); caps.push("cobertura inferior a 70%"); }
  if (confidence < 50) { score = Math.min(score, 59); caps.push("confiança inferior a 50%"); }
  const valuationRisk = valuationRiskAssessment({ fair, potential, confidence, fundamental });
  if (valuationRisk.scoreCap !== null) {
    score = Math.min(score, valuationRisk.scoreCap);
    caps.push(`sensibilidade do valuation: teto ${valuationRisk.scoreCap}`);
  }
  return { score, rawScore, penaltyPoints, caps, signal: opportunitySignal(score, penalties), fundamental, fair, potential, discountScore, valuation, relativeValuation: relative, confidence, coverage, components: calculation.components, penalties, valuationRisk, evEbitda: evEbitdaValue(f) };
}
