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
  if (f.financialCompany) {
    if (f.bookValuePerShare > 0) {
      const targetPb = bounded(.65 + Math.max(0, f.roe ?? 0) / 20, .65, 2.2);
      anchors.push({ value: f.bookValuePerShare * targetPb, label: `VPA × P/VP-alvo ${fmt(targetPb)}`, weight: 70 });
    }
    if (f.eps > 0) {
      const targetPe = bounded(7 + Math.max(0, f.roe ?? 0) * .22 + bounded(f.profitGrowth ?? 0, -5, 15) * .08, 7, 14);
      anchors.push({ value: f.eps * targetPe, label: `LPA × P/L-alvo ${fmt(targetPe)}`, weight: 30 });
    }
  } else {
    if (f.eps > 0) {
      const targetPe = bounded(8 + Math.max(0, f.roe ?? 0) * .35 + bounded(f.revenueGrowth ?? 0, -5, 15) * .15, 7, 18);
      anchors.push({ value: f.eps * targetPe, label: `LPA × P/L-alvo ${fmt(targetPe)}`, weight: 45 });
    }
    if (f.bookValuePerShare > 0) {
      const targetPb = bounded(.65 + Math.max(0, f.roe ?? 0) / 20, .65, 2);
      anchors.push({ value: f.bookValuePerShare * targetPb, label: `VPA × P/VP-alvo ${fmt(targetPb)}`, weight: 25 });
    }
    if (f.ebitdaTTM > 0 && f.sharesOutstanding > 0) {
      const targetEvEbitda = bounded(5 + Math.max(0, f.roic ?? 0) * .12 + bounded(f.revenueGrowth ?? 0, -5, 15) * .08, 4.5, 9);
      const equityValue = f.ebitdaTTM * targetEvEbitda - (f.netDebt ?? 0);
      if (equityValue > 0) anchors.push({ value: equityValue / f.sharesOutstanding, label: `EBITDA × EV/EBITDA-alvo ${fmt(targetEvEbitda)}`, weight: 30 });
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
  const anomalyScore = anomaly?.score ?? 0;
  const reasons = [`Preço atual ${fmt(plan.potentialPct)}% em relação ao valor justo central.`, `Qualidade ${quality ?? "N/D"}/100 e confiança ${confidence}/100.`];
  if (anomalyScore >= 40) reasons.push(`Movimento com alerta estatístico ${anomalyScore}/100; investigar antes de agir.`);
  if (severe) reasons.push("Há penalidade fundamental grave no histórico disponível.");

  if (severe || (quality !== null && quality < 40)) {
    return { code: "reduce", label: "Reavaliar: reduzir ou vender", tone: "sell", holder: "Reavaliar e considerar redução", newcomer: "Evitar nova entrada", reasons, plan, quality, confidence, anomalyScore };
  }
  if (asset.price >= plan.fair.high) {
    return { code: "realize", label: "Boa faixa para realizar ou vender", tone: "sell", holder: "Considerar realização parcial", newcomer: "Não comprar acima da faixa justa", reasons, plan, quality, confidence, anomalyScore };
  }
  if (asset.price <= plan.fair.low && (quality ?? 0) >= 65 && confidence >= 60 && anomalyScore < 40) {
    return { code: "buy", label: "Boa faixa para comprar", tone: "buy", holder: "Manter ou aportar dentro do limite", newcomer: "Entrada matematicamente favorável", reasons, plan, quality, confidence, anomalyScore };
  }
  if (asset.price <= plan.fair.high && (quality ?? 0) >= 55 && !severe) {
    return { code: "hold", label: "Boa para manter", tone: "hold", holder: "Manter e acompanhar a tese", newcomer: asset.price <= plan.fair.base ? "Entrada parcial, com cautela" : "Aguardar margem melhor", reasons, plan, quality, confidence, anomalyScore };
  }
  return { code: "wait", label: "Aguardar", tone: "wait", holder: "Manter somente se a tese continuar válida", newcomer: "Não iniciar posição agora", reasons, plan, quality, confidence, anomalyScore };
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
  return { score, rawScore, penaltyPoints, caps, signal: opportunitySignal(score, penalties), fundamental, fair, potential, discountScore, valuation, relativeValuation: relative, confidence, coverage, components: calculation.components, penalties, evEbitda: evEbitdaValue(f) };
}
