"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildActionSignal, buildOpportunity, buildPositionPlan, fairValueRange } from "./opportunity-engine";
import QuantPage from "./QuantPage";
import OptionsLab from "./OptionsLab";
const FILTERS = [
  { id: "all", label: "Todos" },
  { id: "stocks", label: "A\xE7\xF5es" },
  { id: "fiis", label: "FIIs" },
  { id: "fundamentals", label: "Com dados oficiais" },
  { id: "candidates", label: "Radar: candidatas" },
  { id: "buy", label: "Boa para comprar" },
  { id: "hold", label: "Boa para manter" },
  { id: "sell", label: "Boa para realizar / vender" },
  { id: "favorites", label: "\u2605 Favoritos" },
  { id: "gainers", label: "Em alta" },
  { id: "losers", label: "Em baixa" },
  { id: "units", label: "Units" }
];
const CACHE_KEY = "b3-score-cache-v11";
const REMOTE_STOCK_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/b3-fundamentals.json";
const REMOTE_FII_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/fii-catalog.json";
const REMOTE_RADAR_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/daily-radar.json";
const REMOTE_ANOMALY_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/market-anomalies.json";
const n = (value) => {
  const parsed = Number(value);
  return value === null || value === void 0 || value === "" || !Number.isFinite(parsed) ? null : parsed;
};
const money = (value) => value === null ? "\u2014" : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const number = (value, digits = 2) => value === null ? "\u2014" : value.toLocaleString("pt-BR", { maximumFractionDigits: digits });
const compactMoney = (value) => value === null ? "\u2014" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 }).format(value);
const compactNumber = (value) => value === null || value === void 0 ? "\u2014" : new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 2 }).format(value);
const percent = (value, sign = true) => value === null ? "\u2014" : `${sign && value > 0 ? "+" : ""}${number(value)}%`;
const shortDate = (value) => value ? (/* @__PURE__ */ new Date(`${value}T12:00:00`)).toLocaleDateString("pt-BR") : "n\xE3o informada";
const STOCK_WEIGHTS = { price: 25, quality: 35, debt: 25, dividends: 15 };
const FINANCIAL_WEIGHTS = { price: 30, quality: 50, debt: 0, dividends: 20 };
function buildScoreDetails(f, scores) {
  const weights = f.financialCompany ? FINANCIAL_WEIGHTS : STOCK_WEIGHTS;
  const inputs = {
    price: ["P/L", "P/VP", ...f.financialCompany ? [] : ["EV/EBIT"]],
    quality: ["ROE", "ROA", ...f.financialCompany ? [] : ["margens", "crescimento"]],
    debt: f.financialCompany ? [] : ["d\xEDvida l\xEDquida/EBIT", "liquidez corrente"],
    dividends: ["dividend yield", "regularidade e payout"]
  };
  const rationale = {
    price: "Compara o pre\xE7o da empresa com lucro, patrim\xF4nio e resultado operacional.",
    quality: "Mede rentabilidade, efici\xEAncia e evolu\xE7\xE3o dos resultados publicados.",
    debt: f.financialCompany ? "N\xE3o aplic\xE1vel a bancos: dep\xF3sitos e capta\xE7\xE3o fazem parte da opera\xE7\xE3o." : "Avalia alavancagem e capacidade de cumprir compromissos de curto prazo.",
    dividends: f.dividendYield !== null ? "Usa proventos oficiais da B3, frequ\xEAncia em 24 meses e payout estimado." : "S\xF3 entra quando proventos, classe da a\xE7\xE3o e quantidade de a\xE7\xF5es estiverem vinculados."
  };
  const values = {
    price: scores.price,
    quality: scores.quality,
    debt: f.financialCompany ? null : scores.debt,
    dividends: scores.dividends
  };
  const availableWeight = Object.keys(values).reduce((sum, key) => values[key] === null ? sum : sum + weights[key], 0);
  return Object.fromEntries(Object.keys(values).map((key) => [key, {
    weight: weights[key],
    effectiveWeight: values[key] === null || !availableWeight ? 0 : Math.round(weights[key] / availableWeight * 100),
    score: values[key],
    inputs: inputs[key],
    rationale: rationale[key]
  }]));
}
function upgradeFundamentals(f) {
  const qualityParts = [f.scores.quality, f.scores.growth ?? null].filter((value) => value !== null);
  const upgradedScores = {
    ...f.scores,
    quality: qualityParts.length ? Math.round(qualityParts.reduce((sum, value) => sum + value, 0) / qualityParts.length) : null,
    debt: f.financialCompany ? null : f.scores.debt
  };
  const scoreDetails = buildScoreDetails(f, upgradedScores);
  const weighted = Object.values(scoreDetails).filter((detail) => detail.score !== null && detail.effectiveWeight > 0);
  upgradedScores.overall = weighted.length ? Math.round(weighted.reduce((sum, detail) => sum + (detail.score ?? 0) * detail.effectiveWeight, 0) / weighted.reduce((sum, detail) => sum + detail.effectiveWeight, 0)) : upgradedScores.overall;
  if (f.confidenceDetails) return { ...f, scores: upgradedScores, scoreDetails };
  const values = {
    pe: f.pe,
    pb: f.pb,
    evEbit: f.evEbit,
    roe: f.roe,
    roa: f.roa,
    grossMargin: f.grossMargin,
    ebitMargin: f.ebitMargin,
    netMargin: f.netMargin,
    netDebtEbit: f.netDebtEbit,
    netDebtEbitda: f.netDebtEbitda,
    currentRatio: f.currentRatio,
    revenueGrowth: f.revenueGrowth,
    profitGrowth: f.profitGrowth,
    eps: f.eps,
    bookValuePerShare: f.bookValuePerShare,
    ebitda: f.ebitdaTTM,
    roic: f.roic
  };
  const nonApplicable = new Set(f.financialCompany ? ["evEbit", "grossMargin", "ebitMargin", "netMargin", "netDebtEbit", "netDebtEbitda", "currentRatio", "ebitda", "roic"] : []);
  const applicable = f.financialCompany ? ["pe", "pb", "roe", "roa", "revenueGrowth", "profitGrowth"] : ["pe", "pb", "evEbit", "roe", "roa", "netMargin", "netDebtEbit", "currentRatio", "revenueGrowth", "profitGrowth"];
  const available = applicable.filter((key) => values[key] !== null && values[key] !== void 0).length;
  const coverage = Math.round(available / applicable.length * 100);
  const age = Math.floor((Date.now() - (/* @__PURE__ */ new Date(`${f.referenceDate}T12:00:00`)).getTime()) / 864e5);
  const freshness = age <= 150 ? 100 : age <= 210 ? 90 : age <= 300 ? 75 : age <= 450 ? 55 : 25;
  const linkage = f.cnpj && f.cvmCode ? 100 : 85;
  const estimation = f.marketCapEstimated ? 85 : 100;
  const confidence = Math.round(coverage * 0.55 + freshness * 0.2 + linkage * 0.1 + 10 + estimation * 0.05);
  const metricStates = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, nonApplicable.has(key) ? "not_applicable" : value === null || value === void 0 ? "not_found" : f.marketCapEstimated && ["pe", "pb", "evEbit", "eps"].includes(key) ? "estimated" : freshness < 55 ? "stale" : "available"]));
  return { ...f, metricStates, confidenceDetails: { coverage, freshness, linkage, consolidation: 100, estimation, available, applicable: applicable.length }, scores: { ...upgradedScores, confidence }, scoreDetails };
}
function normalize(raw) {
  const fundamentals = raw.fundamentals ? upgradeFundamentals(raw.fundamentals) : void 0;
  return { ticker: String(raw.ticker ?? "").toUpperCase(), name: raw.name ? String(raw.name) : void 0, kind: raw.kind === "fii" ? "fii" : raw.kind === "unit" ? "unit" : "stock", date: raw.date ? String(raw.date) : void 0, price: n(raw.price), priceopen: n(raw.priceopen), high: n(raw.high), low: n(raw.low), volume: n(raw.volume), closeyest: n(raw.closeyest), change: n(raw.change), changepct: n(raw.changepct), high52: n(raw.high52), low52: n(raw.low52), tradetime: raw.tradetime ? String(raw.tradetime) : null, securityType: raw.securityType ? String(raw.securityType) : void 0, unitComposition: raw.unitComposition ? String(raw.unitComposition) : null, fundamentals, fund: raw.fund };
}
function mergeSnapshots(embedded, current) {
  const merged = new Map(embedded.map((asset) => [asset.ticker, asset]));
  for (const update of current) {
    const saved = merged.get(update.ticker);
    merged.set(update.ticker, {
      ...saved,
      ...update,
      fundamentals: update.fundamentals ?? saved?.fundamentals,
      fund: update.fund ?? saved?.fund
    });
  }
  return [...merged.values()];
}
function fallbackScore(asset) {
  const available = [asset.changepct, asset.volume].filter((v) => v !== null).length;
  const momentum = asset.changepct === null ? 50 : Math.max(10, Math.min(90, 55 + asset.changepct * 5));
  const liquidity = asset.volume === null ? 50 : asset.volume >= 1e8 ? 92 : asset.volume >= 2e7 ? 80 : asset.volume >= 5e6 ? 65 : asset.volume >= 1e6 ? 50 : 30;
  return { price: Math.round((momentum + liquidity) / 2), quality: null, debt: null, growth: null, dividends: null, overall: Math.round((momentum + liquidity) / 2), confidence: Math.round(available / 11 * 100) };
}
const scoreLabel = (score) => score >= 80 ? "Muito forte" : score >= 65 ? "Favor\xE1vel" : score >= 50 ? "Misto" : score >= 35 ? "Aten\xE7\xE3o" : "Fr\xE1gil";
const scoreTone = (score) => score === null || score === void 0 ? "na" : score >= 80 ? "excellent" : score >= 65 ? "good" : score >= 50 ? "mid" : score >= 35 ? "warn" : "bad";
const confidenceTone = (value) => value >= 80 ? "high" : value >= 60 ? "medium" : "low";
const assetScore = (asset) => (asset.fund?.scores ?? asset.fundamentals?.scores ?? fallbackScore(asset)).overall;
const healthySnapshot = (data) => data.length >= 600 && data.filter((asset) => asset.fundamentals).length >= 250 && data.filter((asset) => asset.fund).length >= 200;
const SCORE_LEGEND = [
  { range: "80\u2013100", label: "Excelente", tone: "excellent" },
  { range: "65\u201379", label: "Boa", tone: "good" },
  { range: "50\u201364", label: "Intermedi\xE1ria", tone: "mid" },
  { range: "35\u201349", label: "Aten\xE7\xE3o", tone: "warn" },
  { range: "0\u201334", label: "Fraca", tone: "bad" },
  { range: "N/D", label: "Dados insuficientes", tone: "na" }
];
const DEFAULT_INVESTOR_PROFILE = {
  objective: "balanced",
  horizon: "long",
  risk: "moderate",
  maxAsset: 10,
  maxSector: 25
};
const PROFILE_OPTIONS = {
  objective: {
    balanced: "Equilibrado",
    dividends: "Dividendos",
    growth: "Crescimento",
    value: "Valor"
  },
  horizon: {
    medium: "3 a 5 anos",
    long: "Mais de 5 anos"
  },
  risk: {
    conservative: "Conservador",
    moderate: "Moderado",
    bold: "Arrojado"
  }
};
const DECISION_META = {
  candidate: { label: "Candidata", tone: "excellent", icon: "✓" },
  watch: { label: "Observar", tone: "good", icon: "◉" },
  attention: { label: "Atenção", tone: "warn", icon: "!" },
  avoid: { label: "Evitar", tone: "bad", icon: "×" },
  unavailable: { label: "Não avaliável", tone: "na", icon: "?" }
};
const median = (values) => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const bounded = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
function peerComparison(asset, assets) {
  if (!assets?.length) return null;
  const isFii = asset.kind === "fii";
  const group = isFii ? asset.fund?.segment : asset.fundamentals?.sector;
  if (!group) return null;
  const peers = assets.filter((item) => item.ticker !== asset.ticker && (isFii ? item.kind === "fii" && item.fund?.segment === group : item.kind !== "fii" && item.fundamentals?.sector === group));
  if (peers.length < 2) return null;
  if (isFii) {
    return {
      group,
      count: peers.length + 1,
      rows: [
        { label: "P/VP", asset: asset.fund?.pb, peer: median(peers.map((item) => item.fund?.pb)), format: number },
        { label: "DY 12m", asset: asset.fund?.dy12, peer: median(peers.map((item) => item.fund?.dy12)), format: (value) => percent(value, false) },
        { label: "Vacância", asset: asset.fund?.vacancy, peer: median(peers.map((item) => item.fund?.vacancy)), format: (value) => percent(value, false) }
      ].filter((row) => row.asset !== null && row.asset !== void 0 && row.peer !== null)
    };
  }
  return {
    group,
    count: peers.length + 1,
    rows: [
      { label: "P/L", asset: asset.fundamentals?.pe, peer: median(peers.map((item) => item.fundamentals?.pe).filter((value) => value > 0)), format: number },
      { label: "P/VP", asset: asset.fundamentals?.pb, peer: median(peers.map((item) => item.fundamentals?.pb).filter((value) => value > 0)), format: number },
      { label: "ROE", asset: asset.fundamentals?.roe, peer: median(peers.map((item) => item.fundamentals?.roe)), format: (value) => percent(value, false) }
    ].filter((row) => row.asset !== null && row.asset !== void 0 && row.peer !== null)
  };
}
function decisionPillars(asset) {
  if (asset.kind === "fii" && asset.fund) {
    const scores = asset.fund.scores;
    return [
      { key: "quality", label: "Qualidade", value: scores.quality },
      { key: "price", label: "Preço", value: scores.price },
      { key: "safety", label: "Segurança", value: scores.risk },
      { key: "income", label: "Renda", value: scores.income },
      { key: "liquidity", label: "Liquidez", value: scores.liquidity }
    ];
  }
  const scores = asset.fundamentals?.scores;
  if (!scores) return [];
  return [
    { key: "quality", label: "Qualidade", value: scores.quality },
    { key: "price", label: "Preço", value: scores.price },
    { key: "safety", label: "Segurança", value: scores.debt },
    { key: "growth", label: "Crescimento", value: scores.growth },
    { key: "income", label: "Proventos", value: scores.dividends }
  ];
}
function buildDecision(asset, profile = DEFAULT_INVESTOR_PROFILE, assets = []) {
  const isFii = asset.kind === "fii";
  const data = isFii ? asset.fund : asset.fundamentals;
  const scores = data?.scores;
  const confidence = scores?.confidence ?? 0;
  const pillars = decisionPillars(asset);
  const available = pillars.filter((pillar) => pillar.value !== null && pillar.value !== void 0);
  const weightsByGoal = {
    balanced: { quality: 25, price: 20, safety: 25, growth: 15, income: 15, liquidity: 15 },
    dividends: { quality: 25, price: 15, safety: 20, growth: 5, income: 30, liquidity: 10 },
    growth: { quality: 30, price: 15, safety: 20, growth: 30, income: 5, liquidity: 10 },
    value: { quality: 25, price: 35, safety: 20, growth: 15, income: 5, liquidity: 10 }
  };
  const weights = weightsByGoal[profile.objective] ?? weightsByGoal.balanced;
  const totalWeight = available.reduce((sum, pillar) => sum + (weights[pillar.key] ?? 10), 0);
  let fitScore = totalWeight ? Math.round(available.reduce((sum, pillar) => sum + pillar.value * (weights[pillar.key] ?? 10), 0) / totalWeight) : 0;
  const strengths = [];
  const risks = [];
  const blockers = [];
  for (const pillar of available) {
    if (pillar.value >= 70) strengths.push(`${pillar.label} ${pillar.value}/100`);
    if (pillar.value < 40) risks.push(`${pillar.label} ${pillar.value}/100`);
  }
  if (!data || confidence < 50 || available.length < 3) blockers.push("dados insuficientes para uma decisão responsável");
  if (isFii && data) {
    if (data.netAssets !== null && data.netAssets <= 0) blockers.push("patrimônio líquido não positivo");
    if (data.leverage !== null && data.leverage > 60) blockers.push(`passivos elevados: ${percent(data.leverage, false)} do PL`);
    if (data.vacancy !== null && data.vacancy > 35) risks.push(`vacância de ${percent(data.vacancy, false)}`);
    if (data.dy12 !== null && data.dy12 > 18) risks.push(`DY muito alto: ${percent(data.dy12, false)}`);
  } else if (data) {
    if (data.equity !== null && data.equity <= 0) blockers.push("patrimônio líquido não positivo");
    if (data.netIncomeTTM !== null && data.netIncomeTTM <= 0) risks.push("prejuízo nos últimos 12 meses");
    if (!data.financialCompany && data.netDebtEbitda !== null && data.netDebtEbitda > 5) blockers.push(`dívida líquida/EBITDA de ${number(data.netDebtEbitda)}`);
    if (data.roe !== null && data.roe < 3) risks.push(`ROE baixo: ${percent(data.roe, false)}`);
    if (data.netMargin !== null && data.netMargin < 1) risks.push(`margem líquida estreita: ${percent(data.netMargin, false)}`);
  }
  if (profile.risk === "conservative") {
    const safety = available.find((pillar) => pillar.key === "safety")?.value;
    if (safety !== void 0 && safety !== null && safety < 60) fitScore -= 10;
    if ((asset.volume ?? 0) < 1e5) fitScore -= 8;
  } else if (profile.risk === "bold") {
    fitScore += 3;
  }
  fitScore = bounded(fitScore);
  const fair = fairValueRange(asset);
  const margin = fair?.base && asset.price ? (fair.base / asset.price - 1) * 100 : null;
  if (margin !== null && margin >= 15) strengths.push(`margem de segurança estimada de ${percent(margin, false)}`);
  if (margin !== null && margin < -10) risks.push(`preço ${percent(Math.abs(margin), false)} acima do valor-base estimado`);
  let status = "watch";
  if (blockers.length && (confidence < 50 || !data || available.length < 3)) status = "unavailable";
  else if (blockers.length || fitScore < 38) status = "avoid";
  else if (fitScore < 55 || confidence < 60 || risks.length >= 3) status = "attention";
  else if (fitScore >= 70 && confidence >= 65 && margin !== null && margin >= 10 && !risks.some((risk) => risk.includes("prejuízo"))) status = "candidate";
  const peer = peerComparison(asset, assets);
  const monitor = isFii ? ["recorrência dos rendimentos", "vacância, inadimplência e passivos", "próximo informe mensal/trimestral"] : ["próximo resultado trimestral", "evolução das margens e do lucro", "dívida e geração de caixa"];
  const invalidators = isFii ? ["queda recorrente dos rendimentos", "alta relevante de vacância ou inadimplência", "aumento de passivos sem melhora da renda"] : ["dois resultados seguidos com piora operacional", "dívida superar a capacidade de geração de caixa", "lucro ou margem deteriorarem sem sinal de recuperação"];
  return {
    status,
    meta: DECISION_META[status],
    fitScore,
    confidence,
    pillars,
    strengths: strengths.slice(0, 4),
    risks: risks.slice(0, 5),
    blockers,
    fair,
    margin,
    peer,
    monitor,
    invalidators
  };
}
function ScoreRing({ value, size = "normal" }) {
  return <div className={`score-ring ${size} ${scoreTone(value)}`} style={{ "--score": `${value * 3.6}deg` }} role="img" aria-label={`Nota ${value} de 100: ${scoreLabel(value)}`} title={`Nota ${value}/100 \u2014 ${scoreLabel(value)}`}><strong>{value}</strong>{size === "normal" && <span>/100</span>}</div>;
}
function PortfolioSimulator({ assets, asOf }) {
  const [tickers, setTickers] = useState([]);
  const [candidate, setCandidate] = useState("");
  const [capital, setCapital] = useState(5e3);
  const [monthly, setMonthly] = useState(300);
  const [months, setMonths] = useState(60);
  const [strategy, setStrategy] = useState("equal");
  const [reinvestProceeds, setReinvestProceeds] = useState(true);
  const [simulateSale, setSimulateSale] = useState(true);
  const [costRate, setCostRate] = useState(0.1);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = JSON.parse(localStorage.getItem("b3-score-portfolio-v1") ?? "null");
        if (saved) {
          setTickers(saved.tickers ?? []);
          setCapital(saved.capital ?? 5e3);
          setMonthly(saved.monthly ?? 300);
          setMonths(saved.months ?? 60);
          setStrategy(saved.strategy ?? "equal");
          setReinvestProceeds(saved.reinvestProceeds ?? true);
          setSimulateSale(saved.simulateSale ?? true);
          setCostRate(saved.costRate ?? 0.1);
        }
      } catch {
        localStorage.removeItem("b3-score-portfolio-v1");
      }
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (ready) localStorage.setItem("b3-score-portfolio-v1", JSON.stringify({ tickers, capital, monthly, months, strategy, reinvestProceeds, simulateSale, costRate }));
  }, [tickers, capital, monthly, months, strategy, reinvestProceeds, simulateSale, costRate, ready]);
  const eligible = useMemo(() => assets.filter((asset) => asset.price !== null && asset.price > 0).sort((a, b) => a.ticker.localeCompare(b.ticker)), [assets]);
  const selectedAssets = useMemo(() => tickers.map((ticker) => eligible.find((asset) => asset.ticker === ticker)).filter(Boolean), [tickers, eligible]);
  const simulation = useMemo(() => {
    const weights = selectedAssets.map((asset) => strategy === "score" ? Math.max(20, assetScore(asset)) : 1);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const rows = selectedAssets.map((asset, index) => {
      const target = totalWeight ? capital * weights[index] / totalWeight : 0;
      const quantity = Math.floor(target / (asset.price ?? Infinity));
      const invested2 = quantity * (asset.price ?? 0);
      const scores = asset.fund?.scores ?? asset.fundamentals?.scores ?? fallbackScore(asset);
      return { asset, target, quantity, invested: invested2, score: scores.overall, confidence: scores.confidence };
    });
    const invested = rows.reduce((sum, row) => sum + row.invested, 0);
    const weightedScore = invested ? Math.round(rows.reduce((sum, row) => sum + row.score * row.invested, 0) / invested) : 0;
    const confidence = invested ? Math.round(rows.reduce((sum, row) => sum + row.confidence * row.invested, 0) / invested) : 0;
    const maxWeight = invested ? Math.max(0, ...rows.map((row) => row.invested / invested * 100)) : 0;
    return { rows, invested, leftover: Math.max(0, capital - invested), weightedScore, confidence, maxWeight };
  }, [selectedAssets, capital, strategy]);
  const contributed = capital + monthly * months;
  const projectionBasis = useMemo(() => {
    const rows = simulation.rows;
    const total = rows.reduce((sum, row) => sum + row.invested, 0);
    const withYield = rows.map((row) => ({ ...row, yield: row.asset.kind === "fii" ? row.asset.fund?.dy12 ?? null : row.asset.fundamentals?.dividendYield ?? null })).filter((row) => typeof row.yield === "number" && Number.isFinite(row.yield) && row.yield >= 0);
    const covered = withYield.reduce((sum, row) => sum + row.invested, 0);
    const dividendYield = covered ? withYield.reduce((sum, row) => sum + (row.yield ?? 0) * row.invested, 0) / covered : null;
    const taxRate = total ? rows.reduce((sum, row) => sum + (row.asset.kind === "fii" ? 20 : 15) * row.invested, 0) / total : 15;
    return { dividendYield, yieldCoverage: total ? covered / total * 100 : 0, taxRate };
  }, [simulation.rows]);
  const projectScenario = (annual) => {
    const monthlyGrowth = Math.pow(1 + annual / 100, 1 / 12) - 1;
    const monthlyYield = (projectionBasis.dividendYield ?? 0) / 100 / 12;
    let investedBalance = capital;
    let proceeds = 0;
    let reinvested = 0;
    for (let month = 0; month < months; month += 1) {
      investedBalance += monthly;
      investedBalance *= 1 + monthlyGrowth;
      const income = investedBalance * monthlyYield;
      proceeds += income;
      if (reinvestProceeds) {
        investedBalance += income;
        reinvested += income;
      }
    }
    const cashProceeds = reinvestProceeds ? 0 : proceeds;
    const appreciation = Math.max(0, investedBalance - contributed - reinvested);
    const tax = simulateSale ? appreciation * projectionBasis.taxRate / 100 : 0;
    const costs = simulateSale ? investedBalance * Math.max(0, costRate) / 100 : 0;
    return { investedBalance, appreciation, proceeds, tax, costs, net: investedBalance + cashProceeds - tax - costs };
  };
  const add = () => {
    if (candidate && !tickers.includes(candidate)) setTickers((current) => [...current, candidate]);
    setCandidate("");
  };
  return <section className="portfolio-section" id="carteira">
    <div className="portfolio-heading"><div><span className="eyebrow">CARTEIRA VIRTUAL</span><h2>Simule antes de investir.</h2><p>Distribua um valor entre ações e FIIs usando os últimos preços disponíveis. Tudo fica salvo somente neste aparelho.</p></div><div className="educational-badge">SIMULAÇÃO EDUCACIONAL</div></div>
    <div className="portfolio-layout"><div className="portfolio-builder">
      <div className="portfolio-controls"><label>Valor inicial <span>R$</span><input type="number" min="0" step="100" value={capital} onChange={(event) => setCapital(Math.max(0, Number(event.target.value)))} /></label><label>Aporte mensal <span>R$</span><input type="number" min="0" step="50" value={monthly} onChange={(event) => setMonthly(Math.max(0, Number(event.target.value)))} /></label><label>Prazo <span>meses</span><input type="number" min="1" max="600" value={months} onChange={(event) => setMonths(Math.max(1, Math.min(600, Number(event.target.value))))} /></label><label>Distribuição<select value={strategy} onChange={(event) => setStrategy(event.target.value)}><option value="equal">Divisão igual</option><option value="score">Proporcional ao score</option></select></label></div>
      <div className="asset-picker"><select aria-label="Ativo para adicionar" value={candidate} onChange={(event) => setCandidate(event.target.value)}><option value="">Escolha uma ação ou FII...</option>{eligible.filter((asset) => !tickers.includes(asset.ticker)).map((asset) => <option value={asset.ticker} key={asset.ticker}>{asset.ticker} — {asset.name || asset.fund?.name || asset.fundamentals?.companyName || asset.kind}</option>)}</select><button disabled={!candidate} onClick={add}>+ Adicionar</button></div>
      {simulation.rows.length ? <div className="portfolio-table"><div className="portfolio-table-head"><span>Ativo</span><span>Preço</span><span>Quantidade</span><span>Aplicado</span><span>Nota</span><span /></div>{simulation.rows.map((row) => <div className="portfolio-row" key={row.asset.ticker}><b className="portfolio-asset">{row.asset.ticker}<small>{row.asset.kind === "fii" ? "FII" : row.asset.kind === "unit" ? "UNIT" : "A\xC7\xC3O"}</small></b><span className="portfolio-price" data-label="Preço">{money(row.asset.price)}</span><strong className="portfolio-quantity" data-label="Quantidade">{row.quantity}</strong><span className="portfolio-invested" data-label="Aplicado">{money(row.invested)}</span><i className={`portfolio-score ${scoreTone(row.score)}`} data-label="Nota">{row.score}/100</i><button className="portfolio-remove" aria-label={`Remover ${row.asset.ticker}`} onClick={() => setTickers((current) => current.filter((ticker) => ticker !== row.asset.ticker))}>×</button></div>)}</div> : <div className="portfolio-empty"><b>Sua simulação está vazia.</b><span>Escolha pelo menos um ativo para calcular quantidades, sobra e score médio.</span></div>}
    </div><aside className="portfolio-summary"><span className="eyebrow">RESUMO DA COMPRA</span><div className="summary-grid"><div><span>Valor aplicado</span><b>{money(simulation.invested)}</b></div><div><span>Sobra estimada</span><b>{money(simulation.leftover)}</b></div><div><span>Score ponderado</span><b className={scoreTone(simulation.weightedScore)}>{simulation.rows.length ? `${simulation.weightedScore}/100` : "\u2014"}</b></div><div><span>Confiança média</span><b className={confidenceTone(simulation.confidence)}>{simulation.rows.length ? `${simulation.confidence}%` : "\u2014"}</b></div></div>{simulation.maxWeight > 40 && <p className="concentration-alert">Atenção: um ativo representa aproximadamente {number(simulation.maxWeight, 0)}% do valor aplicado.</p>}<small>Ações: {shortDate(asOf.stockPriceAsOf ?? void 0)} • FIIs: {shortDate(asOf.fiiPriceAsOf ?? void 0)}. Quantidades inteiras, sem taxas.</small></aside></div>
    <div className="scenario-section"><div className="scenario-intro"><span className="eyebrow">PROJEÇÃO POR CENÁRIOS</span><h3>Resultado bruto e líquido.</h3><p>A taxa de cada cenário representa valorização anual hipotética. Os proventos são estimados separadamente pelo DY dos últimos 12 meses da carteira.</p></div>
      <div className="projection-settings">
        <label className="switch-setting"><input type="checkbox" checked={reinvestProceeds} onChange={(event) => setReinvestProceeds(event.target.checked)} /><span><b>Reinvestir proventos</b><small>Usa os recebimentos para comprar mais ativos.</small></span></label>
        <label className="switch-setting"><input type="checkbox" checked={simulateSale} onChange={(event) => setSimulateSale(event.target.checked)} /><span><b>Simular venda no final</b><small>Aplica IR e custos somente sobre a venda hipotética.</small></span></label>
        <label className="cost-setting"><span>Custos estimados na venda</span><div><input type="number" min="0" max="5" step=".01" value={costRate} onChange={(event) => setCostRate(Math.max(0, Math.min(5, Number(event.target.value))))} /><b>%</b></div></label>
      </div>
      <div className="projection-status"><span>DY estimado da carteira <b>{projectionBasis.dividendYield === null ? "N/D" : percent(projectionBasis.dividendYield, false)}</b></span><span>Cobertura do DY <b>{number(projectionBasis.yieldCoverage, 0)}%</b></span><span>IR simplificado na venda <b>{number(projectionBasis.taxRate, 1)}%</b></span></div>
      <div className="scenario-grid">{[{ label: "Conservador", rate: 4 }, { label: "Base", rate: 8 }, { label: "Otimista", rate: 12 }].map((scenario) => {
    const result = projectScenario(scenario.rate);
    return <article key={scenario.label} className="scenario-card"><div className="scenario-card-top"><span>{scenario.label} • {scenario.rate}% a.a.</span><small>RESULTADO LÍQUIDO ESTIMADO</small><b>{money(result.net)}</b></div><div className="scenario-quick"><span>Aportado <b>{money(contributed)}</b></span><span>Ganho líquido <b className={result.net - contributed >= 0 ? "up" : "down"}>{money(result.net - contributed)}</b></span></div><details><summary>Ver cálculo completo <i>⌄</i></summary><dl><div><dt>Total aportado</dt><dd>{money(contributed)}</dd></div><div><dt>Valorização bruta</dt><dd>{money(result.appreciation)}</dd></div><div><dt>Proventos estimados</dt><dd>{projectionBasis.dividendYield === null ? "N/D" : money(result.proceeds)}</dd></div><div className="deduction"><dt>IR estimado na venda</dt><dd>{simulateSale ? `\u2212 ${money(result.tax)}` : "R$ 0,00"}</dd></div><div className="deduction"><dt>Custos estimados</dt><dd>{simulateSale ? `\u2212 ${money(result.costs)}` : "R$ 0,00"}</dd></div><div className="net-row"><dt>Resultado líquido</dt><dd>{money(result.net)}</dd></div></dl></details></article>;
  })}</div>
      <p className="projection-disclaimer"><b>Estimativa educacional:</b> o IR usa uma alíquota simplificada ponderada de 15% para ações e 20% para FIIs, apenas sobre valorização positiva na venda simulada. Não considera isenção mensal, compensação de prejuízos, day trade, JCP, mudanças legais nem situação fiscal individual. Proventos passados não garantem pagamentos futuros.</p>
    </div>
  </section>;
}
const ANALYSIS_GUIDES = {
  stock: {
    title: "Como analisar uma a\xE7\xE3o",
    intro: "Comece pelo neg\xF3cio, passe pela qualidade dos resultados e s\xF3 ent\xE3o avalie o pre\xE7o. Um indicador isolado nunca conta a hist\xF3ria inteira.",
    steps: [
      { title: "Entenda o neg\xF3cio", text: "Veja setor, segmento, fontes de receita e se a empresa \xE9 simples de compreender.", metrics: "Setor \u2022 receita \u2022 modelo de neg\xF3cio" },
      { title: "Confira lucro e efici\xEAncia", text: "Procure lucro recorrente, margens est\xE1veis e retorno consistente sobre o capital.", metrics: "ROE \u2022 ROIC \u2022 margens \u2022 lucro" },
      { title: "Avalie o pre\xE7o", text: "Compare m\xFAltiplos com o hist\xF3rico da empresa e concorrentes do mesmo setor.", metrics: "P/L \u2022 P/VP \u2022 EV/EBIT" },
      { title: "Me\xE7a o endividamento", text: "Cheque se a d\xEDvida cabe na gera\xE7\xE3o de caixa e se h\xE1 folga para compromissos de curto prazo.", metrics: "D\xEDv. l\xEDquida/EBITDA \u2022 liquidez" },
      { title: "Observe crescimento", text: "Receita e lucro devem crescer com qualidade; saltos pontuais podem n\xE3o se repetir.", metrics: "CAGR \u2022 evolu\xE7\xE3o anual \u2022 TTM" },
      { title: "Revise proventos e riscos", text: "Dividendos sustent\xE1veis v\xEAm de caixa e lucro. Considere concentra\xE7\xE3o, governan\xE7a e ciclicidade.", metrics: "DY \u2022 payout \u2022 regularidade" }
    ]
  },
  fii: {
    title: "Como analisar um FII",
    intro: "Em fundos imobili\xE1rios, renda e patrim\xF4nio importam tanto quanto o pre\xE7o. Compare apenas fundos com estrat\xE9gia e segmento parecidos.",
    steps: [
      { title: "Identifique o tipo de fundo", text: "Entenda mandato, segmento, gest\xE3o e de onde vem a renda distribu\xEDda.", metrics: "Tijolo ou papel \u2022 segmento \u2022 gest\xE3o" },
      { title: "Compare pre\xE7o e patrim\xF4nio", text: "P/VP ajuda a enxergar \xE1gio ou desconto, mas o valor dos im\xF3veis e cr\xE9ditos tamb\xE9m precisa ser saud\xE1vel.", metrics: "P/VP \u2022 VP por cota \u2022 patrim\xF4nio" },
      { title: "Avalie a renda", text: "Prefira rendimentos recorrentes e verifique se houve ganho n\xE3o recorrente elevando o DY.", metrics: "DY 12 meses \u2022 hist\xF3rico mensal" },
      { title: "Cheque a qualidade dos ativos", text: "Veja vac\xE2ncia, quantidade de im\xF3veis, localiza\xE7\xE3o e concentra\xE7\xE3o em locat\xE1rios ou devedores.", metrics: "Vac\xE2ncia \u2022 im\xF3veis \u2022 concentra\xE7\xE3o" },
      { title: "Analise riscos e obriga\xE7\xF5es", text: "Compare passivos com o patrim\xF4nio e observe inadimpl\xEAncia, alavancagem e vencimentos.", metrics: "Passivos/PL \u2022 inadimpl\xEAncia" },
      { title: "Confirme liquidez e diversifica\xE7\xE3o", text: "Liquidez facilita a sa\xEDda. Evite concentrar a carteira em um \xFAnico fundo ou segmento.", metrics: "Volume \u2022 cotistas \u2022 segmento" }
    ]
  }
};
function AnalysisGuide() {
  const [kind, setKind] = useState("stock");
  const guide = ANALYSIS_GUIDES[kind];
  return <section className="analysis-guide" id="guia-analise">
    <div className="analysis-guide-heading">
      <div><span className="eyebrow">GUIA PRÁTICO</span><h2>Passo a passo para analisar</h2><p>Use este roteiro antes de olhar a nota. A nota organiza os dados; a decisão continua sendo sua.</p></div>
      <div className="guide-tabs" role="tablist" aria-label="Escolha o tipo de ativo">
        <button role="tab" aria-selected={kind === "stock"} className={kind === "stock" ? "active" : ""} onClick={() => setKind("stock")}>Ação</button>
        <button role="tab" aria-selected={kind === "fii"} className={kind === "fii" ? "active" : ""} onClick={() => setKind("fii")}>FII</button>
      </div>
    </div>
    <div className="guide-summary"><span>{kind === "stock" ? "A\xC7\xC3O" : "FUNDO IMOBILI\xC1RIO"}</span><div><h3>{guide.title}</h3><p>{guide.intro}</p></div></div>
    <ol className="guide-steps">
      {guide.steps.map((step, index) => <li key={step.title}><span className="guide-number">{String(index + 1).padStart(2, "0")}</span><div><h3>{step.title}</h3><p>{step.text}</p><small>{step.metrics}</small></div></li>)}
    </ol>
    <div className="guide-check"><b>Antes de decidir</b><span>Confira a data, a confiança e a fonte dos dados. Compare empresas com empresas e FIIs com FIIs. Nota alta não é recomendação de compra.</span></div>
  </section>;
}
function InvestorProfile({ profile, onChange }) {
  const update = (key, value) => onChange({ ...profile, [key]: value });
  return <section className="investor-profile" id="perfil-investidor">
    <div className="profile-heading"><div><span className="eyebrow">SEU RADAR</span><h2>Defina como você investe</h2><p>O perfil muda os pesos da análise, mas nunca apaga riscos nem transforma a nota em recomendação.</p></div><span className="profile-saved">✓ salvo neste aparelho</span></div>
    <div className="profile-controls">
      <label><span>Objetivo</span><select value={profile.objective} onChange={(event) => update("objective", event.target.value)}>{Object.entries(PROFILE_OPTIONS.objective).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>Prazo</span><select value={profile.horizon} onChange={(event) => update("horizon", event.target.value)}>{Object.entries(PROFILE_OPTIONS.horizon).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>Tolerância ao risco</span><select value={profile.risk} onChange={(event) => update("risk", event.target.value)}>{Object.entries(PROFILE_OPTIONS.risk).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>Máximo por ativo</span><div className="profile-number"><input type="number" min="1" max="50" value={profile.maxAsset} onChange={(event) => update("maxAsset", bounded(Number(event.target.value), 1, 50))} /><b>%</b></div></label>
      <label><span>Máximo por setor</span><div className="profile-number"><input type="number" min="5" max="100" value={profile.maxSector} onChange={(event) => update("maxSector", bounded(Number(event.target.value), 5, 100))} /><b>%</b></div></label>
    </div>
    <div className="profile-reading"><b>Como o Radar vai ler</b><span>{profile.objective === "dividends" ? "Dará mais peso à renda sustentável, sem ignorar qualidade e segurança." : profile.objective === "growth" ? "Dará mais peso à qualidade e ao crescimento de receita e lucro." : profile.objective === "value" ? "Dará mais peso ao preço e à margem de segurança, exigindo confirmação dos fundamentos." : "Equilibrará qualidade, preço, segurança, crescimento e renda."}</span></div>
    <p className="profile-method-note">Perfil simplificado para fins educacionais; não substitui o suitability de uma instituição autorizada. <a href="https://www.gov.br/cvm/pt-br/assuntos/noticias/2025/cvm-publica-estudo-sobre-o-processo-de-analise-do-perfil-do-investidor-suitability-e-a-eficacia-da-resolucao-cvm-30" target="_blank" rel="noreferrer">Entenda a adequação ao perfil na CVM ↗</a></p>
  </section>;
}
function DecisionRadar({ asset, profile, assets }) {
  const decision = buildDecision(asset, profile, assets);
  return <section className={`decision-radar ${decision.meta.tone}`} id="decisao-ativo">
    <div className="decision-head"><div><span className="eyebrow">RADAR DE DECISÃO • LEITURA EDUCACIONAL</span><h3>{decision.meta.icon} {decision.meta.label}</h3><p>Compatibilidade com seu perfil: <b>{decision.fitScore}/100</b> • confiança dos dados: <b>{decision.confidence}%</b></p></div><div className="decision-price"><span>Cotação analisada</span><strong>{money(asset.price)}</strong>{decision.margin !== null && <small className={decision.margin >= 0 ? "up" : "down"}>{decision.margin >= 0 ? "+" : ""}{number(decision.margin)}% até o valor-base</small>}</div></div>
    <div className="decision-pillar-grid">{decision.pillars.map((pillar) => <article className={scoreTone(pillar.value)} key={pillar.key}><span>{pillar.label}</span><strong>{pillar.value ?? "N/D"}</strong><i><em style={{ width: `${pillar.value ?? 0}%` }} /></i></article>)}</div>
    {decision.fair ? <div className="fair-value"><div><span>Faixa conservadora</span><b>{money(decision.fair.low)}</b></div><div className="base"><span>Valor-base estimado</span><b>{money(decision.fair.base)}</b></div><div><span>Faixa otimista</span><b>{money(decision.fair.high)}</b></div><p><b>Método simplificado:</b> {decision.fair.method}. É uma faixa educacional baseada nos dados disponíveis, não um preço-alvo profissional.</p></div> : <div className="decision-missing">Não foi possível estimar uma faixa de valor com os dados atuais.</div>}
    <div className="decision-thesis">
      <article className="positive"><b>Por que pode interessar</b>{decision.strengths.length ? decision.strengths.map((item) => <span key={item}>✓ {item}</span>) : <span>Nenhuma força relevante confirmada.</span>}</article>
      <article className="negative"><b>Riscos e contrapontos</b>{[...decision.blockers, ...decision.risks].length ? [...decision.blockers, ...decision.risks].map((item) => <span key={item}>! {item}</span>) : <span>Nenhum alerta forte nos dados disponíveis.</span>}</article>
      <article><b>O que acompanhar</b>{decision.monitor.map((item) => <span key={item}>→ {item}</span>)}</article>
      <article><b>O que invalidaria a tese</b>{decision.invalidators.map((item) => <span key={item}>× {item}</span>)}</article>
    </div>
    {decision.peer && decision.peer.rows.length > 0 && <div className="peer-comparison"><div><b>Comparação com pares</b><span>{decision.peer.group} • {decision.peer.count} ativos com dados comparáveis</span></div><div className="peer-table"><span>Indicador</span><span>{asset.ticker}</span><span>Mediana do grupo</span>{decision.peer.rows.map((row) => <><b key={`${row.label}-label`}>{row.label}</b><strong key={`${row.label}-asset`}>{row.format(row.asset)}</strong><em key={`${row.label}-peer`}>{row.format(row.peer)}</em></>)}</div></div>}
    <div className="decision-fit"><b>Encaixe na carteira</b><span>Limites definidos: até {profile.maxAsset}% por ativo e {profile.maxSector}% por setor. O app ainda não conhece suas posições reais; confirme a concentração no simulador antes de comprar.</span></div>
  </section>;
}
function AssetCard({ asset, favorite, onFavorite, onOpen, assets, anomaly }) {
  const scores = asset.fund?.scores ?? asset.fundamentals?.scores ?? fallbackScore(asset);
  const signal = buildActionSignal(asset, assets, anomaly);
  const direction = (asset.changepct ?? 0) > 0 ? "up" : (asset.changepct ?? 0) < 0 ? "down" : "flat";
  const preview = asset.kind === "fii" ? [{ label: "P/VP", value: asset.fund?.pb, text: number(asset.fund?.pb ?? null, 2) }, { label: "DY 12m", value: asset.fund?.dy12, text: percent(asset.fund?.dy12 ?? null, false) }, { label: "Liquidez", value: asset.volume, text: compactMoney(asset.volume) }] : [{ label: "P/L", value: asset.fundamentals?.pe, text: number(asset.fundamentals?.pe ?? null, 1) }, { label: "P/VP", value: asset.fundamentals?.pb, text: number(asset.fundamentals?.pb ?? null, 1) }, { label: "ROE", value: asset.fundamentals?.roe, text: percent(asset.fundamentals?.roe ?? null, false) }];
  const visiblePreview = preview.filter((item) => item.value !== null && item.value !== void 0);
  return <article className="asset-card" tabIndex={0} role="button" aria-label={`Abrir an\xE1lise de ${asset.ticker}, nota ${scores.overall} de 100`} onClick={onOpen} onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && onOpen()}>
    <div className="card-head"><div><strong className="ticker">{asset.ticker}</strong><span className="asset-kind">{asset.name || (asset.kind === "unit" ? "UNIT" : "A\xC7\xC3O B3")}</span></div><button className={`favorite ${favorite ? "active" : ""}`} onClick={(event) => {
    event.stopPropagation();
    onFavorite();
  }} aria-label="Alternar favorito">★</button></div>
    <div className="card-body"><div><strong className="asset-price">{money(asset.price)}</strong><span className={`change ${direction}`}>{direction === "up" ? "\u2197" : direction === "down" ? "\u2198" : "\u2192"} {percent(asset.changepct)}</span></div><ScoreRing value={scores.overall} size="small" /></div>
    <div className="card-decision-row"><span className={`action-chip ${signal.tone}`}>{signal.label}</span><small>confiança {signal.confidence ?? 0}/100</small></div>
    <div className="card-meta">{visiblePreview.length ? visiblePreview.map((item) => <span key={item.label}>{item.label} <b>{item.text}</b></span>) : <span><b>Preço e liquidez disponíveis</b></span>}</div>
    <div className="open-hint"><span>{asset.fund ? `FII \u2022 CVM ${shortDate(asset.fund.referenceDate ?? void 0)}` : asset.fundamentals ? `CVM \u2022 ${shortDate(asset.fundamentals.referenceDate)}` : "Sem v\xEDnculo oficial"}</span><b>Ver análise →</b></div>
  </article>;
}
const categoryMeta = [
  { key: "price", label: "Pre\xE7o", description: "P/L, P/VP e EV/EBIT" },
  { key: "quality", label: "Qualidade", description: "Rentabilidade, margens e crescimento" },
  { key: "debt", label: "Endividamento", description: "Alavancagem e liquidez" },
  { key: "dividends", label: "Dividendos", description: "Yield, regularidade e sustentabilidade" }
];
const assessment = (tone, label, meaning, analysis, caution, rationale) => ({ tone, label, meaning, analysis, caution, rationale });
function stockEvidence(f) {
  const strengths = [];
  const risks = [];
  if (f.roe !== null) (f.roe >= 12 ? strengths : f.roe < 5 ? risks : []).push(`ROE de ${percent(f.roe, false)}`);
  if (f.netMargin !== null) (f.netMargin >= 7 ? strengths : f.netMargin < 2 ? risks : []).push(`margem l\xEDquida de ${percent(f.netMargin, false)}`);
  if (!f.financialCompany && f.netDebtEbitda !== null && f.netDebtEbitda !== void 0) {
    (f.netDebtEbitda <= 2 ? strengths : f.netDebtEbitda > 3 ? risks : []).push(`d\xEDvida l\xEDquida/EBITDA de ${number(f.netDebtEbitda)}`);
  }
  if (f.revenueGrowth !== null) (f.revenueGrowth >= 5 ? strengths : f.revenueGrowth < 0 ? risks : []).push(`receita em ${percent(f.revenueGrowth)}`);
  const parts = [];
  if (strengths.length) parts.push(`Pontos favor\xE1veis: ${strengths.slice(0, 2).join(" e ")}`);
  if (risks.length) parts.push(`Pontos de aten\xE7\xE3o: ${risks.slice(0, 2).join(" e ")}`);
  return parts.join(". ") || "Os demais indicadores dispon\xEDveis n\xE3o formam um sinal forte de confirma\xE7\xE3o ou alerta.";
}
function interpretMetric(label, context, kind) {
  if (!context) return assessment("na", "N\xE3o avali\xE1vel", "O valor n\xE3o possui contexto suficiente.", "A an\xE1lise exige dados vinculados e compar\xE1veis.", "N\xE3o use este campo isoladamente.", "N\xE3o h\xE1 base suficiente para classificar.");
  if (kind === "fii") {
    const f2 = context;
    const informative = (meaning, analysisText) => assessment("informative", "Informativo", meaning, analysisText, "Compare com FIIs do mesmo segmento e com o hist\xF3rico do pr\xF3prio fundo.", `A confian\xE7a geral desta an\xE1lise \xE9 ${f2.scores.confidence}%.`);
    if (label === "P/VP") {
      const value = f2.pb;
      if (value === null || value <= 0) return assessment("na", "N\xE3o avali\xE1vel", "Compara a cota\xE7\xE3o com o patrim\xF4nio por cota.", "Valores sem patrim\xF4nio positivo n\xE3o permitem leitura normal.", "O patrim\xF4nio pode conter avalia\xE7\xF5es defasadas ou ativos de baixa liquidez.", "P/VP ausente ou inv\xE1lido.");
      const tone = value < 0.75 ? "attention" : value <= 1.05 ? "good" : value <= 1.2 ? "neutral" : value <= 1.5 ? "attention" : "bad";
      const tag = tone === "good" ? "Bom" : tone === "neutral" ? "Neutro" : tone === "attention" ? "Aten\xE7\xE3o" : "Ruim";
      return assessment(tone, tag, "Mostra quanto o mercado paga por R$ 1 de patrim\xF4nio do fundo.", "Pr\xF3ximo de 1 indica pre\xE7o semelhante ao valor patrimonial; desconto pode ser oportunidade ou refletir risco.", "P/VP n\xE3o mede qualidade dos im\xF3veis, vac\xE2ncia nem capacidade de distribuir renda.", `P/VP de ${number(value)}; DY 12m de ${percent(f2.dy12, false)} e passivos/PL de ${percent(f2.leverage, false)} ajudam a confirmar a leitura.`);
    }
    if (label === "DY 12 meses" || label === "DY do m\xEAs") {
      const value = label === "DY 12 meses" ? f2.dy12 : f2.dyMonth;
      if (value === null) return assessment("na", "N\xE3o avali\xE1vel", "Mede a renda distribu\xEDda em rela\xE7\xE3o ao pre\xE7o.", "Sem uma janela completa, n\xE3o h\xE1 compara\xE7\xE3o segura.", "Rendimento passado n\xE3o garante pagamentos futuros.", "O informe n\xE3o trouxe todos os valores necess\xE1rios.");
      const annual = label === "DY 12 meses" ? value : value * 12;
      const tone = annual > 18 ? "attention" : annual >= 8 ? "good" : annual >= 5 ? "neutral" : "attention";
      return assessment(tone, tone === "good" ? "Bom" : tone === "neutral" ? "Neutro" : "Aten\xE7\xE3o", "Mede quanto o fundo distribuiu em rela\xE7\xE3o \xE0 cota\xE7\xE3o.", "Compare a renda com vac\xE2ncia, inadimpl\xEAncia, passivos e recorr\xEAncia dos pagamentos.", "DY muito alto pode vir de evento n\xE3o recorrente ou queda forte da cota\xE7\xE3o.", `Equivalente anual observado de ${percent(annual, false)}; vac\xE2ncia de ${percent(f2.vacancy, false)} e passivos/PL de ${percent(f2.leverage, false)}.`);
    }
    if (label === "Passivos/PL") {
      const value = f2.leverage;
      if (value === null) return informative("Rela\xE7\xE3o entre passivos e patrim\xF4nio.", "Quanto menor, menor tende a ser a press\xE3o financeira.");
      const tone = value <= 15 ? "excellent" : value <= 30 ? "good" : value <= 50 ? "attention" : "bad";
      return assessment(tone, tone === "excellent" ? "Excelente" : tone === "good" ? "Bom" : tone === "attention" ? "Aten\xE7\xE3o" : "Ruim", "Indica o peso dos passivos sobre o patrim\xF4nio.", "Valores menores oferecem mais folga; valores altos exigem verificar vencimentos e custo da d\xEDvida.", "A composi\xE7\xE3o e o prazo dos passivos importam tanto quanto o percentual.", `Passivos equivalem a ${percent(value, false)} do PL; P/VP est\xE1 em ${number(f2.pb)}.`);
    }
    if (label === "Vac\xE2ncia" || label === "Inadimpl\xEAncia" || label === "Maior concentra\xE7\xE3o") {
      const value = label === "Vac\xE2ncia" ? f2.vacancy : label === "Inadimpl\xEAncia" ? f2.defaultRate : f2.maxTenantConcentration;
      if (value === null) return informative(`${label} informada pelo fundo.`, "N\xE3o h\xE1 valor suficiente para classificar.");
      const tone = value <= 5 ? "excellent" : value <= 10 ? "good" : value <= 20 ? "neutral" : value <= 35 ? "attention" : "bad";
      return assessment(tone, tone === "excellent" ? "Excelente" : tone === "good" ? "Bom" : tone === "neutral" ? "Neutro" : tone === "attention" ? "Aten\xE7\xE3o" : "Ruim", `${label} mostra uma fonte relevante de risco operacional do fundo.`, "Quanto menor, melhor; compare com im\xF3veis, segmento e estabilidade dos rendimentos.", "Um \xFAnico trimestre pode n\xE3o representar a condi\xE7\xE3o estrutural do portf\xF3lio.", `${label} de ${percent(value, false)}, com ${number(f2.properties, 0)} im\xF3veis informados.`);
    }
    if (label === "Liquidez di\xE1ria") {
      const value = context.scores.liquidity;
      return assessment(value !== null && value >= 65 ? "good" : value !== null && value < 35 ? "attention" : "neutral", value !== null && value >= 65 ? "Boa" : value !== null && value < 35 ? "Aten\xE7\xE3o" : "Neutra", "Mostra a facilidade estimada de negociar cotas.", "Maior liquidez normalmente reduz dificuldade e diferen\xE7a entre compra e venda.", "Liquidez passada pode cair em per\xEDodos de estresse.", `O pilar de liquidez do FII recebeu ${value ?? "N/D"} de 100.`);
    }
    return informative(
      label === "Valor patrimonial/cota" ? "Parcela do patrim\xF4nio atribu\xEDda a cada cota." : label === "Patrim\xF4nio l\xEDquido" ? "Valor cont\xE1bil l\xEDquido do fundo." : label === "Cotistas" ? "Quantidade de investidores do fundo." : label === "Im\xF3veis informados" ? "Quantidade de im\xF3veis identificados no informe." : "Dado oficial utilizado como contexto.",
      "Este n\xFAmero ajuda na compara\xE7\xE3o, mas n\xE3o \xE9 bom ou ruim isoladamente."
    );
  }
  const f = context;
  const evidence = stockEvidence(f);
  const info = (meaning, analysisText) => assessment("informative", "Informativo", meaning, analysisText, "Compare com empresas do mesmo setor e com o hist\xF3rico da companhia.", evidence);
  if (label === "P/L") {
    const value = f.pe;
    if (value === null || value <= 0) return assessment("na", "N\xE3o avali\xE1vel", "Mostra quanto o mercado paga por cada R$ 1 de lucro anual.", "P/L negativo ou ausente normalmente indica preju\xEDzo ou lucro n\xE3o compar\xE1vel.", "N\xE3o interprete um P/L negativo como a\xE7\xE3o barata.", `Lucro l\xEDquido de ${compactMoney(f.netIncomeTTM)}. ${evidence}`);
    let tone = value <= 8 ? "excellent" : value <= 15 ? "good" : value <= 25 ? "neutral" : value <= 40 ? "attention" : "bad";
    if (f.roe !== null && f.roe < 5 || !f.financialCompany && f.netDebtEbitda !== null && f.netDebtEbitda !== void 0 && f.netDebtEbitda > 4) tone = tone === "excellent" ? "neutral" : tone === "good" ? "attention" : tone;
    const names = { excellent: "Excelente", good: "Bom", neutral: "Neutro", attention: "Aten\xE7\xE3o", bad: "Ruim", informative: "Informativo", na: "N\xE3o avali\xE1vel" };
    return assessment(tone, names[tone], "Mostra quantos reais o mercado paga por R$ 1 de lucro dos \xFAltimos 12 meses.", "Em tese, quanto menor e positivo, mais barato; a leitura melhora quando lucro, margens e d\xEDvida s\xE3o saud\xE1veis.", "Lucro extraordin\xE1rio ou em queda pode produzir um P/L artificialmente baixo.", `P/L de ${number(value)}. ${evidence}`);
  }
  if (label === "P/VP") {
    const value = f.pb;
    if (value === null || value <= 0) return assessment("na", "N\xE3o avali\xE1vel", "Compara o valor de mercado com o patrim\xF4nio l\xEDquido.", "Patrim\xF4nio negativo invalida a leitura tradicional.", "Ativos cont\xE1beis podem n\xE3o refletir valor econ\xF4mico ou qualidade.", evidence);
    const tone = value <= 1 ? "excellent" : value <= 2 ? "good" : value <= 3 ? "neutral" : value <= 5 ? "attention" : "bad";
    return assessment(tone, tone === "excellent" ? "Excelente" : tone === "good" ? "Bom" : tone === "neutral" ? "Neutro" : tone === "attention" ? "Aten\xE7\xE3o" : "Ruim", "Indica quanto o mercado paga por R$ 1 de patrim\xF4nio l\xEDquido.", "Perto ou abaixo de 1 pode indicar desconto; empresas muito rent\xE1veis justificam m\xFAltiplos maiores.", "Patrim\xF4nio barato n\xE3o significa neg\xF3cio lucrativo.", `P/VP de ${number(value)} e ROE de ${percent(f.roe, false)}. ${evidence}`);
  }
  if (label === "EV/EBIT") {
    const value = f.evEbit;
    if (value === null || value <= 0) return assessment("na", "N\xE3o avali\xE1vel", "Relaciona o valor da opera\xE7\xE3o ao resultado operacional.", "EBIT negativo impede a leitura convencional.", "Compare somente neg\xF3cios com estrutura operacional semelhante.", evidence);
    const tone = value <= 6 ? "excellent" : value <= 10 ? "good" : value <= 16 ? "neutral" : value <= 25 ? "attention" : "bad";
    return assessment(tone, tone === "excellent" ? "Excelente" : tone === "good" ? "Bom" : tone === "neutral" ? "Neutro" : tone === "attention" ? "Aten\xE7\xE3o" : "Ruim", "Mostra quantas vezes o resultado operacional est\xE1 contido no valor da firma.", "Menor e positivo tende a indicar valuation mais baixo, j\xE1 considerando d\xEDvida l\xEDquida.", "EBIT c\xEDclico ou n\xE3o recorrente pode distorcer o m\xFAltiplo.", `EV/EBIT de ${number(value)} e d\xEDvida l\xEDquida/EBITDA de ${number(f.netDebtEbitda ?? null)}. ${evidence}`);
  }
  if (label === "ROE" || label === "ROA" || label === "ROIC") {
    const value = label === "ROE" ? f.roe : label === "ROA" ? f.roa : f.roic ?? null;
    if (value === null) return assessment("na", "N\xE3o avali\xE1vel", "Mede rentabilidade sobre uma base de capital.", "Faltam lucro ou base patrimonial compar\xE1vel.", "Rentabilidade de um per\xEDodo n\xE3o garante repeti\xE7\xE3o.", evidence);
    const good = label === "ROA" ? 8 : 15;
    const excellent = label === "ROA" ? 12 : 22;
    const tone = value >= excellent ? "excellent" : value >= good ? "good" : value >= 7 ? "neutral" : value >= 0 ? "attention" : "bad";
    return assessment(tone, tone === "excellent" ? "Excelente" : tone === "good" ? "Bom" : tone === "neutral" ? "Neutro" : tone === "attention" ? "Aten\xE7\xE3o" : "Ruim", `${label} mede a efici\xEAncia da empresa em gerar resultado sobre ${label === "ROE" ? "o patrim\xF4nio dos acionistas" : label === "ROA" ? "os ativos" : "o capital investido"}.`, "Quanto maior e sustent\xE1vel, melhor; compare com o setor e com v\xE1rios exerc\xEDcios.", "Alavancagem, venda de ativos ou lucro extraordin\xE1rio podem elevar o percentual.", `${label} de ${percent(value, false)}. ${evidence}`);
  }
  if (label.startsWith("Margem")) {
    const value = label === "Margem bruta" ? f.grossMargin : label === "Margem EBIT" ? f.ebitMargin : f.netMargin;
    if (value === null) return assessment("na", "N\xE3o avali\xE1vel", "Mostra quanto da receita permanece em uma etapa do resultado.", "Falta receita ou resultado compar\xE1vel.", "Margens variam muito entre setores.", evidence);
    const thresholds = label === "Margem bruta" ? [40, 25, 15, 5] : label === "Margem EBIT" ? [20, 12, 6, 0] : [15, 8, 3, 0];
    const tone = value >= thresholds[0] ? "excellent" : value >= thresholds[1] ? "good" : value >= thresholds[2] ? "neutral" : value >= thresholds[3] ? "attention" : "bad";
    return assessment(tone, tone === "excellent" ? "Excelente" : tone === "good" ? "Bom" : tone === "neutral" ? "Neutra" : tone === "attention" ? "Aten\xE7\xE3o" : "Ruim", `${label} mostra quanto sobra de cada R$ 100 de receita nessa etapa.`, "Margem maior e est\xE1vel sugere efici\xEAncia e poder de precifica\xE7\xE3o.", "A compara\xE7\xE3o correta \xE9 com concorrentes do mesmo setor e com o hist\xF3rico.", `${label} de ${percent(value, false)}. ${evidence}`);
  }
  if (label === "D\xEDvida l\xEDq./EBIT" || label === "D\xEDvida l\xEDq./EBITDA") {
    const value = label === "D\xEDvida l\xEDq./EBIT" ? f.netDebtEbit : f.netDebtEbitda ?? null;
    if (value === null) return assessment("na", "N\xE3o avali\xE1vel", "Estima quantos anos de resultado seriam necess\xE1rios para cobrir a d\xEDvida l\xEDquida.", "Resultado negativo ou conta ausente impede leitura segura.", "O cronograma e o custo da d\xEDvida tamb\xE9m precisam ser observados.", evidence);
    const tone = value <= 0 ? "excellent" : value <= 1.5 ? "good" : value <= 3 ? "neutral" : value <= 4 ? "attention" : "bad";
    return assessment(tone, tone === "excellent" ? "Excelente" : tone === "good" ? "Bom" : tone === "neutral" ? "Neutra" : tone === "attention" ? "Aten\xE7\xE3o" : "Ruim", "Compara a d\xEDvida l\xEDquida com a capacidade operacional de gera\xE7\xE3o de resultado.", "Quanto menor, melhor; valor negativo geralmente significa caixa l\xEDquido.", "Neg\xF3cios est\xE1veis toleram mais d\xEDvida que neg\xF3cios c\xEDclicos.", `${label} de ${number(value)}. ${evidence}`);
  }
  if (label === "Liquidez corrente") {
    const value = f.currentRatio;
    if (value === null) return assessment("na", "N\xE3o avali\xE1vel", "Compara ativos e obriga\xE7\xF5es de curto prazo.", "Faltam contas circulantes compar\xE1veis.", "Liquidez alta pode incluir estoques ou receb\xEDveis dif\xEDceis de realizar.", evidence);
    const tone = value >= 1.5 ? "good" : value >= 1 ? "neutral" : value >= 0.7 ? "attention" : "bad";
    return assessment(tone, tone === "good" ? "Boa" : tone === "neutral" ? "Neutra" : tone === "attention" ? "Aten\xE7\xE3o" : "Ruim", "Indica a cobertura das d\xEDvidas de curto prazo pelos ativos circulantes.", "Acima de 1 sugere cobertura cont\xE1bil; abaixo de 1 exige an\xE1lise do ciclo de caixa.", "O indicador n\xE3o mostra a qualidade de estoques e contas a receber.", `Liquidez corrente de ${number(value)}. ${evidence}`);
  }
  if (label === "Cresc. receita" || label === "Cresc. lucro") {
    const value = label === "Cresc. receita" ? f.revenueGrowth : f.profitGrowth;
    if (value === null) return assessment("na", "N\xE3o compar\xE1vel", "Compara o exerc\xEDcio atual com o anterior.", "Viradas entre lucro e preju\xEDzo n\xE3o s\xE3o convertidas em percentuais enganosos.", "Um \xFAnico ano n\xE3o define uma tend\xEAncia.", evidence);
    const tone = value >= 20 ? "excellent" : value >= 8 ? "good" : value >= 0 ? "neutral" : value >= -10 ? "attention" : "bad";
    return assessment(tone, tone === "excellent" ? "Excelente" : tone === "good" ? "Bom" : tone === "neutral" ? "Neutro" : tone === "attention" ? "Aten\xE7\xE3o" : "Ruim", `Mostra a varia\xE7\xE3o anual de ${label === "Cresc. receita" ? "vendas" : "lucro"}.`, "Crescimento saud\xE1vel deve ser recorrente e acompanhado por margens e caixa.", "Aquisi\xE7\xF5es, infla\xE7\xE3o e base de compara\xE7\xE3o podem distorcer a varia\xE7\xE3o.", `${label} de ${percent(value)}. ${evidence}`);
  }
  if (label === "Dividend yield 12m") {
    const value = f.dividendYield;
    if (value === null) return assessment("na", "N\xE3o avali\xE1vel", "Relaciona proventos dos \xFAltimos 12 meses com a cota\xE7\xE3o.", "A B3 n\xE3o forneceu eventos suficientes para essa classe.", "Aus\xEAncia no app n\xE3o prova que a empresa nunca distribuiu proventos.", evidence);
    const tone = value > 15 ? "attention" : value >= 6 ? "good" : value >= 2 ? "neutral" : "attention";
    return assessment(tone, tone === "good" ? "Bom" : tone === "neutral" ? "Neutro" : "Aten\xE7\xE3o", "Mostra o retorno passado em proventos sobre o pre\xE7o atual.", "Avalie junto com payout, lucro, endividamento e regularidade.", "DY elevado pode refletir evento extraordin\xE1rio ou queda da cota\xE7\xE3o.", `DY de ${percent(value, false)}, payout de ${percent(f.payout ?? null, false)} e lucro de ${compactMoney(f.netIncomeTTM)}.`);
  }
  if (label === "Payout") {
    const value = f.payout ?? null;
    if (value === null || value < 0) return assessment("na", "N\xE3o avali\xE1vel", "Mostra a parcela estimada do lucro distribu\xEDda.", "Sem lucro por a\xE7\xE3o positivo n\xE3o h\xE1 payout compar\xE1vel.", "O c\xE1lculo por classe pode diferir do payout societ\xE1rio divulgado.", evidence);
    const tone = value <= 70 ? "good" : value <= 100 ? "neutral" : value <= 130 ? "attention" : "bad";
    return assessment(tone, tone === "good" ? "Bom" : tone === "neutral" ? "Neutro" : tone === "attention" ? "Aten\xE7\xE3o" : "Ruim", "Indica quanto do lucro estimado foi destinado a proventos.", "Faixas moderadas tendem a equilibrar renda e reinvestimento.", "Acima de 100% pode ser tempor\xE1rio, n\xE3o recorrente ou consumir reservas.", `Payout estimado de ${percent(value, false)} e DY de ${percent(f.dividendYield, false)}. ${evidence}`);
  }
  if (label === "Regularidade 24m") {
    const value = f.dividendRegularity ?? null;
    if (value === null) return assessment("na", "N\xE3o avali\xE1vel", "Mede em quantos meses houve proventos.", "N\xE3o h\xE1 janela oficial suficiente.", "Regularidade n\xE3o garante manuten\xE7\xE3o dos valores.", evidence);
    const tone = value >= 40 ? "good" : value >= 20 ? "neutral" : "attention";
    return assessment(tone, tone === "good" ? "Boa" : tone === "neutral" ? "Neutra" : "Aten\xE7\xE3o", "Mostra a frequ\xEAncia dos pagamentos em 24 meses.", "Maior frequ\xEAncia facilita avaliar consist\xEAncia, mas n\xE3o substitui sustentabilidade.", "Empresas podem pagar dividendos anuais e ainda serem boas pagadoras.", `${f.dividendMonths24m ?? 0} meses com proventos em 24. ${evidence}`);
  }
  if (label === "Lucro l\xEDquido 12m" || label === "EBITDA 12m") {
    const value = label === "Lucro l\xEDquido 12m" ? f.netIncomeTTM : f.ebitdaTTM ?? null;
    if (value === null) return assessment("na", "N\xE3o avali\xE1vel", "Resultado acumulado dos \xFAltimos 12 meses.", "A conta n\xE3o foi identificada com seguran\xE7a.", "O tamanho absoluto deve ser comparado com receita, capital e hist\xF3rico.", evidence);
    return assessment(value > 0 ? "good" : "bad", value > 0 ? "Positivo" : "Negativo", `Mostra o ${label === "Lucro l\xEDquido 12m" ? "resultado final" : "resultado operacional antes de juros, impostos, deprecia\xE7\xE3o e amortiza\xE7\xE3o"}.`, "O sinal \xE9 importante, mas margens e evolu\xE7\xE3o explicam melhor a qualidade.", "Resultado positivo pode conter itens n\xE3o recorrentes.", `${label} de ${compactMoney(value)}. ${evidence}`);
  }
  return info(
    label === "LPA" ? "Lucro dos \xFAltimos 12 meses atribu\xEDdo a cada a\xE7\xE3o." : label === "VPA" ? "Patrim\xF4nio l\xEDquido atribu\xEDdo a cada a\xE7\xE3o." : label === "Valor de mercado" ? "Valor estimado de todas as a\xE7\xF5es da companhia." : label === "Proventos por a\xE7\xE3o 12m" ? "Soma dos proventos em dinheiro por a\xE7\xE3o no per\xEDodo." : "Valor oficial usado como contexto da an\xE1lise.",
    "O n\xFAmero \xE9 \xFAtil para compara\xE7\xE3o e para outras f\xF3rmulas, mas n\xE3o define sozinho se a a\xE7\xE3o est\xE1 barata ou tem qualidade."
  );
}
function MarketOverview({ asset, marketCap }) {
  const rangeReady = asset.low52 !== null && asset.high52 !== null && asset.price !== null && asset.high52 > asset.low52;
  const rangePosition = rangeReady ? Math.max(0, Math.min(100, (asset.price - asset.low52) / (asset.high52 - asset.low52) * 100)) : 0;
  const items = [
    { label: "Abertura", value: money(asset.priceopen) },
    { label: "M\xE1xima do dia", value: money(asset.high) },
    { label: "M\xEDnima do dia", value: money(asset.low) },
    { label: "Volume financeiro", value: compactMoney(asset.volume) },
    { label: "Fechamento anterior", value: money(asset.closeyest) },
    { label: "Valor de mercado", value: compactMoney(marketCap ?? null) }
  ].filter((item) => item.value !== "\u2014");
  return <section className="market-overview" id="visao-geral-ativo">
    <div className="section-heading"><h3>Visão geral de mercado</h3><span>fechamento B3 de {shortDate(asset.date)}</span></div>
    <div className="market-overview-grid">{items.map((item) => <article key={item.label}><span>{item.label}</span><strong>{item.value}</strong></article>)}</div>
    {rangeReady && <div className="detail-range"><div><span>Mínima em 52 semanas</span><b>{money(asset.low52)}</b></div><div className="detail-range-track"><i style={{ width: `${rangePosition}%` }} /><em style={{ left: `${rangePosition}%` }} /></div><div><span>Máxima em 52 semanas</span><b>{money(asset.high52)}</b></div></div>}
  </section>;
}
function MetricExplorer({ metrics, kind, context }) {
  const valid = metrics.filter((metric) => metric.value !== "\u2014" && !metric.value.startsWith("N/A"));
  const missing = metrics.filter((metric) => metric.value === "\u2014" || metric.value.startsWith("N/A"));
  const groups = kind === "stock" ? [
    { title: "Valuation", subtitle: "Pre\xE7o em rela\xE7\xE3o aos resultados e ao patrim\xF4nio", labels: ["P/L", "P/VP", "EV/EBIT", "LPA", "VPA", "Valor de mercado"] },
    { title: "Rentabilidade e margens", subtitle: "Qualidade e efici\xEAncia do neg\xF3cio", labels: ["ROE", "ROA", "ROIC", "Margem bruta", "Margem EBIT", "Margem l\xEDquida", "EBITDA 12m", "Lucro l\xEDquido 12m"] },
    { title: "Endividamento", subtitle: "Capacidade financeira e estrutura de capital", labels: ["D\xEDvida l\xEDq./EBIT", "D\xEDvida l\xEDq./EBITDA", "Liquidez corrente"] },
    { title: "Crescimento", subtitle: "Compara\xE7\xE3o dispon\xEDvel nos demonstrativos oficiais", labels: ["Cresc. receita", "Cresc. lucro"] },
    { title: "Dividendos", subtitle: "Proventos em dinheiro publicados pela B3", labels: ["Dividend yield 12m", "Proventos por a\xE7\xE3o 12m", "Regularidade 24m", "Payout"] }
  ] : [
    { title: "Pre\xE7o e patrim\xF4nio", subtitle: "Cota\xE7\xE3o comparada ao valor patrimonial", labels: ["P/VP", "Valor patrimonial/cota", "Patrim\xF4nio l\xEDquido"] },
    { title: "Renda", subtitle: "Rendimentos informados pelo fundo", labels: ["DY 12 meses", "DY do m\xEAs"] },
    { title: "Im\xF3veis e risco", subtitle: "Estrutura, ocupa\xE7\xE3o e concentra\xE7\xE3o", labels: ["Passivos/PL", "Vac\xE2ncia", "Inadimpl\xEAncia", "Im\xF3veis informados", "Maior concentra\xE7\xE3o"] },
    { title: "Liquidez e p\xFAblico", subtitle: "Negocia\xE7\xE3o e base de investidores", labels: ["Liquidez di\xE1ria", "Cotistas"] }
  ];
  const stateLabel = (metric) => metric.state === "estimated" ? "Estimado" : metric.state === "stale" ? "Antigo" : metric.state === "not_applicable" ? "N\xE3o aplic\xE1vel" : metric.state === "not_found" ? "N\xE3o encontrado" : metric.state === "official" ? "Oficial" : "Calculado";
  return <section className="detail-section metric-explorer" id="indicadores-ativo">
    <div className="section-heading"><h3>Indicadores e fórmulas</h3><span>{valid.length} valores calculados</span></div>
    <p className="section-intro">Cada indicador recebe uma leitura educativa baseada no próprio valor e nos demais dados disponíveis. Toque para entender, analisar e auditar o cálculo.</p>
    <div className="metric-groups">{groups.map((group) => {
    const groupMetrics = valid.filter((metric) => group.labels.includes(metric.label));
    if (!groupMetrics.length) return null;
    return <section className="metric-group" key={group.title}><div className="metric-group-title"><div><b>{group.title}</b><span>{group.subtitle}</span></div><i>{groupMetrics.length}</i></div><div className="formula-grid audit-grid">{groupMetrics.map((metric) => {
      const reading = interpretMetric(metric.label, context, kind);
      return <details className={`metric-card ${reading.tone}`} key={metric.label}><summary><div><span>{metric.label}</span><strong>{metric.value}</strong><em className={`assessment-chip ${reading.tone}`}>{reading.label}</em></div><i className={`metric-state ${metric.state ?? "calculated"}`}>{stateLabel(metric)}</i><b>Entender e auditar</b></summary><div className="metric-audit"><section className={`metric-reading ${reading.tone}`}><h4>{reading.label}: como interpretar</h4><p><b>O que significa</b>{reading.meaning}</p><p><b>Como analisar</b>{reading.analysis}</p><p><b>Ponto de atenção</b>{reading.caution}</p><p><b>Por que recebeu esta leitura</b>{reading.rationale}</p></section><p><b>Fórmula</b>{metric.formula}</p>{metric.inputs?.length ? <dl>{metric.inputs.map((input) => <div key={input.label}><dt>{input.label}</dt><dd>{input.value}</dd></div>)}</dl> : null}<small><b>Período:</b> {metric.period || metric.source}</small><small><b>Fonte:</b> {metric.source}{metric.note ? ` \u2022 ${metric.note}` : ""}</small></div></details>;
    })}</div></section>;
  })}</div>
    {missing.length > 0 && <details className="missing-metrics"><summary>{missing.length} indicadores não calculados — ver motivos</summary><div>{missing.map((metric) => <article key={metric.label}><b>{metric.label}</b><span>{metric.value.startsWith("N/A") ? metric.value : "N/D \u2014 conta ou per\xEDodo n\xE3o identificado com seguran\xE7a"}</span></article>)}</div></details>}
  </section>;
}
function AccountingAudit({ fundamentals: f }) {
  const audit = f.audit;
  if (!audit) return null;
  const ttmEntries = Object.entries(audit.ttm ?? {});
  const validated = ttmEntries.filter(([, item]) => item.state === "validated_ttm").length;
  const reconciliation = audit.balanceReconciliation;
  const growthLabel = (state) => ({
    turnaround: "Preju\xEDzo \u2192 lucro",
    profit_to_loss: "Lucro \u2192 preju\xEDzo",
    loss_reduced: "Preju\xEDzo reduzido",
    loss_increased: "Preju\xEDzo ampliado",
    normal: "Varia\xE7\xE3o percentual comum"
  })[state ?? ""] ?? "N\xE3o compar\xE1vel";
  return <section className="accounting-audit">
    <div className="section-heading"><h3>Validações contábeis</h3><span>motor {audit.methodVersion || "3.0"}</span></div>
    <div className="accounting-audit-grid">
      <article className={validated ? "audit-ok" : "audit-warn"}><span>TTM</span><strong>{validated ? `${validated}/${ttmEntries.length} contas validadas` : "DFP anual utilizada"}</strong><small>{validated ? "DFP + ITR atual \u2212 comparativa com datas compat\xEDveis" : "O rob\xF4 n\xE3o combinou per\xEDodos incompat\xEDveis."}</small></article>
      <article className={reconciliation?.balanced ? "audit-ok" : reconciliation?.balanced === false ? "audit-error" : "audit-warn"}><span>Conciliação do balanço</span><strong>{reconciliation?.balanced ? "Equa\xE7\xE3o conciliada" : reconciliation?.balanced === false ? "Diferen\xE7a detectada" : "Dados insuficientes"}</strong><small>{reconciliation?.difference !== null && reconciliation?.difference !== void 0 ? `Diferen\xE7a: ${compactMoney(reconciliation.difference)}` : "Ativo = passivos + patrim\xF4nio l\xEDquido"}</small></article>
      <article><span>Escopo</span><strong>{audit.scope === "consolidated" ? "Somente consolidado" : audit.scope === "individual" ? "Somente individual" : "N\xE3o informado"}</strong><small>{audit.scope === "individual" ? "Fallback oficial: o conjunto consolidado estava incompleto. Nenhum escopo foi misturado." : "Demonstrativos individuais n\xE3o s\xE3o misturados."}</small></article>
      <article><span>Crescimento do lucro</span><strong>{growthLabel(audit.growthStates?.profit)}</strong><small>Viradas de sinal não são apresentadas como percentuais absurdos.</small></article>
    </div>
    {(audit.documents?.length ?? 0) > 0 && <details className="document-audit"><summary>Versões e reapresentações da CVM</summary><div>{audit.documents.map((document2) => <article key={document2.documentType}><b>{document2.documentType} {shortDate(document2.referenceDate)}</b><span>versão {document2.selectedVersion ?? "N/D"} • {document2.scope === "consolidated" ? "consolidado" : document2.scope}</span><small>{document2.reissued ? `Reapresentado; vers\xF5es substitu\xEDdas: ${document2.supersededVersions.join(", ")}` : "Sem vers\xE3o anterior identificada para a mesma refer\xEAncia."}</small></article>)}</div></details>}
  </section>;
}
function DividendHistory({ fundamentals: f }) {
  const events = f.dividendEvents ?? [];
  if (!events.length) return null;
  return <section className="dividend-history">
    <div className="section-heading"><h3>Proventos recentes</h3><span>B3 • classe do ativo</span></div>
    <p className="section-intro">Valores brutos por ação. “Data com” é o último dia informado pela B3 para ter direito ao evento.</p>
    <div className="dividend-event-list">{events.slice(0, 10).map((event, index) => <article key={`${event.lastDateWith}-${event.type}-${index}`}>
      <div><b>{event.type}</b><span>{event.shareType}</span></div>
      <strong>{money(event.valuePerShare)}</strong>
      <dl><div><dt>Data com</dt><dd>{shortDate(event.lastDateWith)}</dd></div><div><dt>Data ex</dt><dd>{event.exDate ? shortDate(event.exDate) : "n\xE3o informado"}</dd></div><div><dt>Pagamento</dt><dd>{event.paymentDate ? shortDate(event.paymentDate) : "n\xE3o informado"}</dd></div></dl>
    </article>)}</div>
    <small className="source-caption">Fonte: consulta oficial “Dividendos e outros eventos corporativos” da B3. Eventos repetidos com a mesma classe, tipo, valor e data são consolidados.</small>
  </section>;
}
function CompanyAndStatements({ fundamentals: f }) {
  const [statement, setStatement] = useState("income");
  const [historyLimit, setHistoryLimit] = useState(5);
  const resultRows = [
    { label: "Receita l\xEDquida \u2014 12m", value: f.revenueTTM, text: compactMoney(f.revenueTTM), growth: f.revenueGrowth },
    { label: "Lucro bruto \u2014 12m", value: f.grossProfitTTM, text: compactMoney(f.grossProfitTTM), growth: null },
    { label: "EBIT \u2014 12m", value: f.ebitTTM, text: compactMoney(f.ebitTTM), growth: null },
    { label: "Lucro l\xEDquido \u2014 12m", value: f.netIncomeTTM, text: compactMoney(f.netIncomeTTM), growth: f.profitGrowth }
  ].filter((item) => item.value !== null);
  const balanceRows = [
    { label: "Ativo total", value: f.assets },
    { label: "Ativo circulante", value: f.currentAssets ?? null },
    { label: "Patrim\xF4nio l\xEDquido", value: f.equity },
    { label: "D\xEDvida bruta", value: f.financialCompany ? null : f.grossDebt },
    { label: "Caixa e aplica\xE7\xF5es", value: f.financialCompany ? null : f.cashAndInvestments },
    { label: "D\xEDvida l\xEDquida", value: f.financialCompany ? null : f.netDebt }
  ].filter((item) => item.value !== null);
  const summary = [
    ["Patrim\xF4nio l\xEDquido", compactMoney(f.equity)],
    ["Ativos", compactMoney(f.assets)],
    ["Ativo circulante", compactMoney(f.currentAssets ?? null)],
    ["D\xEDvida bruta", f.financialCompany ? "N/A banco" : compactMoney(f.grossDebt)],
    ["Disponibilidade", f.financialCompany ? "N/A banco" : compactMoney(f.cashAndInvestments)],
    ["D\xEDvida l\xEDquida", f.financialCompany ? "N/A banco" : compactMoney(f.netDebt)],
    ["Valor de mercado", compactMoney(f.marketCap)],
    ["Valor da firma", f.financialCompany ? "N/A banco" : compactMoney(f.enterpriseValue ?? null)],
    ["Total de pap\xE9is", compactNumber(f.sharesOutstanding)],
    ["Free float", f.freeFloat === null || f.freeFloat === void 0 ? "N/D" : percent(f.freeFloat, false)]
  ].filter(([, value]) => value !== "\u2014");
  const history = f.history ?? [];
  const quarterlyHistory = f.quarters ?? [];
  const visibleHistory = history.slice(0, historyLimit);
  const accountingScopeLabel = f.audit?.scope === "individual" ? "individual" : "consolidado";
  const accountingScopePlural = f.audit?.scope === "individual" ? "individuais" : "consolidados";
  const tableConfig = {
    income: {
      title: "DRE",
      rows: [
        ["Receita l\xEDquida", "revenue", "money"],
        ["Custos", "costs", "money"],
        ["Lucro bruto", "grossProfit", "money"],
        ["Despesas/receitas operacionais", "operatingExpenses", "money"],
        ["EBITDA", "ebitda", "money"],
        ["Deprecia\xE7\xE3o e amortiza\xE7\xE3o", "depreciationAmortization", "money"],
        ["EBIT", "ebit", "money"],
        ["Resultado financeiro", "financialResult", "money"],
        ["Impostos", "taxes", "money"],
        ["Lucro l\xEDquido", "netIncome", "money"],
        ["Lucro da controladora", "controllerIncome", "money"],
        ["N\xE3o controladores", "nonControllerIncome", "money"],
        ["ROE", "roe", "percent"],
        ["Margem bruta", "grossMargin", "percent"],
        ["Margem EBIT", "ebitMargin", "percent"],
        ["Margem l\xEDquida", "netMargin", "percent"]
      ]
    },
    cashFlow: {
      title: "Fluxo de caixa",
      rows: [
        ["Caixa l\xEDquido operacional", "operating", "money"],
        ["Caixa l\xEDquido de investimentos", "investing", "money"],
        ["Fluxo de caixa livre", "freeCashFlow", "money"],
        ["Caixa l\xEDquido de financiamentos", "financing", "money"],
        ["Varia\xE7\xE3o cambial", "currencyEffect", "money"],
        ["Aumento/redu\xE7\xE3o de caixa", "cashChange", "money"],
        ["Saldo inicial de caixa", "openingCash", "money"],
        ["Saldo final de caixa", "closingCash", "money"]
      ]
    },
    balance: {
      title: "Balan\xE7o patrimonial",
      rows: [
        ["Ativo total", "assets", "money"],
        ["Ativo circulante", "currentAssets", "money"],
        ["Aplica\xE7\xF5es financeiras", "financialInvestments", "money"],
        ["Caixa e equivalentes", "cash", "money"],
        ["Contas a receber", "receivables", "money"],
        ["Estoques", "inventory", "money"],
        ["Ativo n\xE3o circulante", "nonCurrentAssets", "money"],
        ["Realiz\xE1vel a longo prazo", "longTermAssets", "money"],
        ["Investimentos", "investments", "money"],
        ["Imobilizado", "propertyPlantEquipment", "money"],
        ["Intang\xEDvel", "intangibles", "money"],
        ["Passivo total", "liabilities", "money"],
        ["Passivo circulante", "currentLiabilities", "money"],
        ["Passivo n\xE3o circulante", "nonCurrentLiabilities", "money"],
        ["Patrim\xF4nio l\xEDquido", "equity", "money"],
        ["Capital social", "shareCapital", "money"],
        ["Reservas de capital", "capitalReserves", "money"],
        ["Reservas de lucros", "profitReserves", "money"],
        ["Participa\xE7\xE3o de n\xE3o controladores", "nonControllingInterest", "money"],
        ["D\xEDvida bruta", "grossDebt", "money"],
        ["D\xEDvida l\xEDquida", "netDebt", "money"]
      ]
    }
  };
  const config = tableConfig[statement];
  const visibleRows = config.rows.filter(([, key]) => visibleHistory.some((year) => year[statement][key] !== null && year[statement][key] !== void 0));
  const classification = [
    ["Segmento de listagem", f.listingSegment || f.segment || "N/D"],
    ["Setor de atua\xE7\xE3o", f.sector || "N/D"],
    ["Subsetor de atua\xE7\xE3o", f.subsector || "N/D"],
    ["Segmento de atua\xE7\xE3o", f.industrySegment || "N/D"]
  ];
  return <>
    <section className="company-overview" id="empresa-ativo"><div><span className="eyebrow">EMPRESA</span><h3>{f.companyName}</h3><p>Cadastro da companhia e classificação disponível nas fontes oficiais.</p></div><dl><div><dt>CNPJ</dt><dd>{f.cnpj}</dd></div><div><dt>Código CVM</dt><dd>{f.cvmCode || "n\xE3o informado"}</dd></div><div><dt>Documento usado</dt><dd>{f.filingType}</dd></div><div><dt>Período</dt><dd>{f.periodLabel}</dd></div>{classification.map(([label, value]) => <div key={label} className={value === "N/D" ? "unavailable" : ""}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
    <section className="fundamental-summary"><div className="section-heading"><h3>Estrutura financeira</h3><span>posição em {shortDate(f.referenceDate)}</span></div><div className="fundamental-summary-grid">{summary.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div><p className="source-caption">Balanço: CVM DFP/ITR. Valor de mercado e valor da firma usam o fechamento B3 indicado no topo. N/D significa que a fonte vinculada não publica o campo com segurança.</p></section>
    <DividendHistory fundamentals={f} />
    {f.audit && <AccountingAudit fundamentals={f} />}
    <section className="financial-overview" id="demonstrativos-ativo"><div className="section-heading"><h3>Demonstrativos financeiros</h3><span>posição em {shortDate(f.referenceDate)}</span></div><p className="section-intro">Resumo dos últimos 12 meses e histórico anual {accountingScopeLabel} publicado pela CVM. O mesmo escopo é mantido em toda a análise.</p><div className="financial-columns"><article><div className="financial-title"><b>Resultado</b><span>últimos 12 meses</span></div>{resultRows.map((row) => <div className="financial-row" key={row.label}><span>{row.label}</span><strong>{row.text}</strong>{row.growth !== null && <i className={(row.growth ?? 0) >= 0 ? "up" : "down"}>{percent(row.growth)}</i>}</div>)}</article><article><div className="financial-title"><b>Balanço patrimonial</b><span>última posição disponível</span></div>{balanceRows.map((row) => <div className="financial-row" key={row.label}><span>{row.label}</span><strong>{compactMoney(row.value)}</strong></div>)}</article></div>
      {quarterlyHistory.length > 0 && <div className="quarterly-history"><div className="statement-toolbar"><div><b>Trimestres isolados</b><span>1T reportado; 2T, 3T e 4T derivados de períodos acumulados validados</span></div></div><div className="statement-table-wrap"><table className="statement-table"><caption>Valores trimestrais isolados em reais. Nenhum trimestre é combinado quando as datas do período são incompatíveis.</caption><thead><tr><th scope="col">Conta</th>{quarterlyHistory.flatMap((year) => year.quarters.map((quarter) => <th scope="col" key={`${year.year}-${quarter.quarter}`}>{quarter.quarter}T{year.year}<small>{quarter.states.revenue === "reported" ? "reportado" : "derivado"}</small></th>))}</tr></thead><tbody>{[["Receita l\xEDquida", "revenue"], ["Lucro bruto", "grossProfit"], ["EBIT", "ebit"], ["Lucro l\xEDquido", "netIncome"]].map(([label, key]) => <tr key={key}><th scope="row">{label}</th>{quarterlyHistory.flatMap((year) => year.quarters.map((quarter) => <td key={`${year.year}-${quarter.quarter}`}><strong>{compactMoney(quarter.income[key] ?? null)}</strong><small>{quarter.states[key] === "invalid_period" ? "per\xEDodo rejeitado" : quarter.states[key] === "reported" ? "CVM" : "c\xE1lculo validado"}</small></td>))}</tr>)}</tbody></table></div></div>}
      <div className="statement-toolbar"><div><b>Histórico anual auditável</b><span>até 10 exercícios • valores {accountingScopePlural} • CVM DFP</span></div><div className="statement-controls"><div role="group" aria-label="Quantidade de exercícios"><button className={historyLimit === 5 ? "active" : ""} onClick={() => setHistoryLimit(5)}>5 anos</button><button className={historyLimit === 10 ? "active" : ""} onClick={() => setHistoryLimit(10)}>10 anos</button></div><div role="tablist" aria-label="Tipo de demonstrativo">{["income", "cashFlow", "balance"].map((key) => <button role="tab" aria-selected={statement === key} className={statement === key ? "active" : ""} onClick={() => setStatement(key)} key={key}>{tableConfig[key].title}</button>)}</div></div></div>
      {visibleHistory.length && visibleRows.length ? <div className="statement-table-wrap"><table className="statement-table"><caption>Valores em reais. AH mostra a variação em relação ao exercício anterior. Cada coluna corresponde a uma DFP {accountingScopeLabel}.</caption><thead><tr><th scope="col">{config.title}</th>{visibleHistory.map((year) => <th scope="col" key={year.year}>{year.year}<small>DFP • {shortDate(year.referenceDate)}</small></th>)}</tr></thead><tbody>{visibleRows.map(([label, key, format]) => <tr key={key}><th scope="row">{label}</th>{visibleHistory.map((year) => {
    const value = year[statement][key];
    const variation = (statement === "income" ? year.incomeGrowth : statement === "cashFlow" ? year.cashFlowGrowth : year.balanceGrowth)[key];
    return <td key={year.year}><strong>{format === "percent" ? percent(value ?? null, false) : compactMoney(value ?? null)}</strong>{variation !== null && variation !== void 0 && <small className={variation >= 0 ? "up" : "down"}>{percent(variation)}</small>}</td>;
  })}</tr>)}</tbody></table></div> : <div className="history-pending"><b>Histórico anual aguardando o novo processamento</b><span>O robô agora baixa até 10 anos de DFP. A tabela será preenchida somente com exercícios oficiais identificados e conciliados.</span></div>}
    </section>
  </>;
}
const fiiCategoryMeta = [
  { key: "price", label: "Pre\xE7o", description: "Pre\xE7o sobre valor patrimonial" },
  { key: "income", label: "Renda", description: "Dividend yield informado em 12 meses" },
  { key: "quality", label: "Im\xF3veis", description: "Vac\xE2ncia e diversifica\xE7\xE3o" },
  { key: "risk", label: "Risco", description: "Passivos e inadimpl\xEAncia" },
  { key: "liquidity", label: "Liquidez", description: "Volume financeiro na B3" }
];
function ScoreWhy({ scores, categories, details }) {
  const values = scores;
  const available = categories.map((category) => ({ ...category, value: values[category.key] })).filter((item) => item.value !== null);
  const strong = available.filter((item) => item.value >= 65);
  const attention = available.filter((item) => item.value < 45);
  const balanced = available.filter((item) => item.value >= 45 && item.value < 65);
  const equation = details ? Object.entries(details).filter(([, detail]) => detail.score !== null && detail.effectiveWeight > 0).map(([, detail]) => `${detail.score}\xD7${detail.effectiveWeight}%`).join(" + ") + ` = ${scores.overall}` : available.length ? `(${available.map((item) => item.value).join(" + ")}) \xF7 ${available.length} = ${scores.overall}` : "Sem blocos suficientes";
  return <section className="score-why"><div className="section-heading"><h3>Por que recebeu {scores.overall}/100?</h3><span>explicação da nota</span></div><p className="score-equation">A nota combina somente pilares aplicáveis e disponíveis: <b>{equation}</b>. Confiança: <b className={`confidence-value ${confidenceTone(scores.confidence)}`}>{scores.confidence}%</b>.</p><div className="why-grid">
    <article className="positive"><b>↑ Ajudaram a nota</b>{strong.length ? strong.map((item) => <span key={item.key}>{item.label}: <strong>{item.value}</strong> — {item.description}</span>) : <span>Nenhum bloco acima de 65.</span>}</article>
    <article className="balanced"><b>→ Ficaram no meio</b>{balanced.length ? balanced.map((item) => <span key={item.key}>{item.label}: <strong>{item.value}</strong> — {item.description}</span>) : <span>Nenhum bloco entre 45 e 64.</span>}</article>
    <article className="attention"><b>↓ Puxaram para baixo</b>{attention.length ? attention.map((item) => <span key={item.key}>{item.label}: <strong>{item.value}</strong> — {item.description}</span>) : <span>Nenhum bloco abaixo de 45.</span>}</article>
  </div><p className="missing-score"><b>Cobertura:</b> {available.length} de {categories.length} blocos calculados. A confiança cai quando faltam dados, sem preencher lacunas com zero.</p></section>;
}
function StockScorePillars({ fundamentals: f }) {
  const details = f.scoreDetails ?? buildScoreDetails(f, f.scores);
  return <div className="score-pillar-grid">{categoryMeta.map((category) => {
    const detail = details[category.key];
    return <details className={scoreTone(detail.score)} key={category.key}>
      <summary><span>{category.label}<small>{detail.score === null ? f.financialCompany && category.key === "debt" ? "N\xE3o aplic\xE1vel" : "Dados insuficientes" : `${detail.effectiveWeight}% do score`}</small></span><strong>{detail.score ?? "N/D"}</strong></summary>
      <div><p>{detail.rationale}</p><b>Indicadores considerados</b><span>{detail.inputs.join(" \u2022 ") || "Nenhum indicador aplic\xE1vel"}</span><small>Peso-base: {detail.weight}%{detail.score !== null ? ` \u2022 peso efetivo ap\xF3s renormaliza\xE7\xE3o: ${detail.effectiveWeight}%` : ""}</small></div>
    </details>;
  })}</div>;
}
function ConfidenceBreakdown({ fundamentals: f }) {
  const details = f.confidenceDetails;
  if (!details) return null;
  const rows = [
    ["Cobertura", details.coverage, `${details.available} de ${details.applicable} indicadores aplic\xE1veis`],
    ["Atualiza\xE7\xE3o", details.freshness, `balan\xE7o de ${shortDate(f.referenceDate)}`],
    ["V\xEDnculo", details.linkage, "ticker, CNPJ e c\xF3digo CVM"],
    ["Escopo cont\xE1bil", details.consolidation, f.audit?.scope === "individual" ? "demonstra\xE7\xF5es individuais oficiais, sem mistura" : "demonstra\xE7\xF5es consolidadas"],
    ["Sem aproxima\xE7\xF5es", details.estimation, f.marketCapEstimated ? "uma classe usou pre\xE7o aproximado" : "cota\xE7\xF5es das classes dispon\xEDveis"]
  ];
  const stateCounts = Object.values(f.metricStates ?? {}).reduce((acc, state) => {
    acc[state] = (acc[state] ?? 0) + 1;
    return acc;
  }, {});
  return <section className="confidence-breakdown"><div className="section-heading"><h3>Como a confiança foi calculada</h3><span>qualidade e completude</span></div><p className="section-intro">A confiança não prevê valorização. Ela mede cobertura, atualização, vínculo correto e uso de aproximações.</p><div className="confidence-grid">{rows.map(([label, value, note]) => <article key={label}><div><span>{label}</span><b className={confidenceTone(value)}>{value}%</b></div><i><em style={{ width: `${value}%` }} /></i><small>{note}</small></article>)}</div><div className="data-state-legend"><span className="available">✓ {stateCounts.available ?? 0} disponíveis</span><span className="estimated">≈ {stateCounts.estimated ?? 0} estimados</span><span className="stale">◷ {stateCounts.stale ?? 0} antigos</span><span className="not-applicable">— {stateCounts.not_applicable ?? 0} não aplicáveis</span><span className="not-found">? {stateCounts.not_found ?? 0} não encontrados</span></div></section>;
}
function PositionPlan({ asset, anomaly }) {
  const plan = buildPositionPlan(asset, anomaly);
  if (!plan) return <section className="position-plan unavailable"><div><span className="eyebrow">PLANO MATEMÁTICO</span><h3>Dados insuficientes para estimar faixas</h3></div><p>O app precisa de preço atual e ao menos uma âncora verificável de valor justo.</p></section>;
  return <section className={`position-plan ${plan.tone}`} id="plano-ativo"><div className="position-plan-head"><div><span className="eyebrow">PLANO MATEMÁTICO DO ATIVO</span><h3>Entrada, saída e tempo de reavaliação</h3><p>Faixas condicionais calculadas com valuation, confiança e volatilidade. Não são ordens automáticas.</p></div><i>{plan.status}</i></div>
    <div className="position-plan-grid"><article><span>Preço atual</span><b>{money(plan.currentPrice)}</b><small>B3 {shortDate(asset.date)}</small></article><article><span>Valor justo</span><b>{money(plan.fair.base)}</b><small>faixa {money(plan.fair.low)} – {money(plan.fair.high)}</small></article><article className="entry"><span>Zona de entrada</span><b>{money(plan.entryLow)} – {money(plan.entryHigh)}</b><small>{plan.tone === "wait" ? "aguardar essa faixa" : "margem calculada"}</small></article><article className="target"><span>Saída por valor</span><b>{money(plan.targetBase)}</b><small>cenário superior {money(plan.targetHigh)}</small></article><article className="defensive"><span>Saída defensiva</span><b>{money(plan.defensiveExit)}</b><small>referência de controle de risco</small></article><article><span>Janela mínima</span><b>{plan.horizon}</b><small>reavaliar antes se os dados mudarem</small></article></div>
    <details className="position-method"><summary>Como estas faixas foram calculadas <i>⌄</i></summary><div><p>{plan.method}</p><p>Potencial do preço atual até o justo: <b>{percent(plan.potentialPct)}</b>. Margem da entrada superior até o alvo: <b>{percent(plan.marginFromEntryPct)}</b>.</p>{plan.conditions.map((item) => <span key={item}>• {item}</span>)}</div></details>
  </section>;
}
function ActionReading({ asset, assets, anomaly }) {
  const signal = buildActionSignal(asset, assets, anomaly);
  return <section className={`action-reading ${signal.tone}`} id="leitura-ativo"><div className="action-reading-main"><span className="eyebrow">LEITURA DO SISTEMA</span><h3>{signal.label}</h3><p>Classificação matemática, não ordem personalizada. Ela muda quando preço, fundamentos, confiança ou anomalias mudam.</p></div><div className="action-audiences"><article><span>Se já possui</span><b>{signal.holder}</b></article><article><span>Se ainda não possui</span><b>{signal.newcomer}</b></article></div><details><summary>Por que o sistema chegou a esta leitura? <i>⌄</i></summary><div>{signal.reasons.map((reason) => <p key={reason}>• {reason}</p>)}<small>“Vender” pode significar realização por preço ou redução por deterioração. Confira qual motivo foi acionado antes de decidir.</small></div></details></section>;
}
function FiiDetail({ asset, favorite, onFavorite, onClose, profile, assets, anomaly }) {
  const f = asset.fund;
  const metrics = [
    { label: "P/VP", value: number(f.pb), formula: "Cota\xE7\xE3o \xF7 valor patrimonial por cota", source: `CVM ${shortDate(f.referenceDate ?? void 0)} + B3 ${shortDate(asset.date)}` },
    { label: "DY 12 meses", value: percent(f.dy12, false), formula: "Soma dos DY mensais informados pelo fundo", source: `${f.dyMonthsAvailable} meses dispon\xEDveis na CVM` },
    { label: "DY do m\xEAs", value: percent(f.dyMonth, false), formula: "Dividend yield mensal informado \xE0 CVM", source: `informe de ${shortDate(f.referenceDate ?? void 0)}` },
    { label: "Valor patrimonial/cota", value: money(f.navPerShare), formula: "Patrim\xF4nio l\xEDquido \xF7 cotas emitidas", source: `posi\xE7\xE3o em ${shortDate(f.referenceDate ?? void 0)}` },
    { label: "Patrim\xF4nio l\xEDquido", value: compactMoney(f.netAssets), formula: "Patrim\xF4nio l\xEDquido declarado pelo fundo", source: `informe mensal entregue em ${shortDate(f.deliveryDate ?? void 0)}` },
    { label: "Cotistas", value: number(f.holders, 0), formula: "Quantidade de cotistas declarada", source: `informe de ${shortDate(f.referenceDate ?? void 0)}` },
    { label: "Passivos/PL", value: percent(f.leverage, false), formula: "Total de passivos \xF7 patrim\xF4nio l\xEDquido", source: `informe mensal de ${shortDate(f.referenceDate ?? void 0)}` },
    { label: "Vac\xE2ncia", value: percent(f.vacancy, false), formula: "M\xE9dia ponderada pela receita dos im\xF3veis informados", source: `informe trimestral de ${shortDate(f.quarterDate ?? void 0)}` },
    { label: "Inadimpl\xEAncia", value: percent(f.defaultRate, false), formula: "M\xE9dia ponderada pela receita dos im\xF3veis informados", source: `informe trimestral de ${shortDate(f.quarterDate ?? void 0)}` },
    { label: "Im\xF3veis informados", value: number(f.properties, 0), formula: "Contagem dos im\xF3veis estruturados no informe", source: `informe trimestral de ${shortDate(f.quarterDate ?? void 0)}` },
    { label: "Maior concentra\xE7\xE3o", value: percent(f.maxTenantConcentration, false), formula: "Maior participa\xE7\xE3o de receita entre locat\xE1rios declarados", source: `informe trimestral de ${shortDate(f.quarterDate ?? void 0)}` },
    { label: "Liquidez di\xE1ria", value: compactMoney(asset.volume), formula: "Volume financeiro negociado no preg\xE3o", source: `fechamento B3 de ${shortDate(asset.date)}` }
  ];
  const links = { google: `https://www.google.com/finance/quote/${encodeURIComponent(asset.ticker)}:BVMF?hl=pt-BR`, b3: `https://sistemaswebb3-listados.b3.com.br/fundsListedPage/?language=pt-br`, cvm: "https://dados.cvm.gov.br/dataset/fii-doc-inf_mensal" };
  return <div className="modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && onClose()}><section className="detail-sheet" role="dialog" aria-modal="true" aria-label={`An\xE1lise do FII ${asset.ticker}`}>
    <div className="sheet-handle" /><div className="detail-top"><button className="back-btn" onClick={onClose}>← Voltar</button><button className={`favorite large ${favorite ? "active" : ""}`} onClick={onFavorite}>★</button></div>
	    <div className="detail-title"><div><span className="asset-kind">FUNDO IMOBILIÁRIO{f.segment ? ` \u2022 ${f.segment}` : ""}</span><h2>{asset.ticker}</h2><small>{f.name}{f.cnpj ? ` \u2022 ${f.cnpj}` : ""}</small></div><div className="detail-quote"><strong>{money(asset.price)}</strong><span className={(asset.changepct ?? 0) >= 0 ? "change up" : "change down"}>{percent(asset.changepct)} • B3 {shortDate(asset.date)}</span></div></div>
	    <nav className="detail-jump-nav" aria-label="Seções da análise"><a href="#leitura-ativo">Leitura</a><a href="#plano-ativo">Plano</a><a href="#visao-geral-ativo">Visão geral</a><a href="#indicadores-ativo">Indicadores</a><a href="#fontes-ativo">Fontes</a></nav>
	    <ActionReading asset={asset} assets={assets} anomaly={anomaly} />
	    <PositionPlan asset={asset} anomaly={anomaly} />
	    <div className="score-hero fii-score"><ScoreRing value={f.scores.overall} /><div><span className="eyebrow">SCORE EXCLUSIVO PARA FII</span><h3>{scoreLabel(f.scores.overall)}</h3><p>Confiança de <b className={`confidence-value ${confidenceTone(f.scores.confidence)}`}>{f.scores.confidence}%</b>. A tela mostra apenas indicadores com valor verificável.</p></div></div>
	    <div className="score-categories">{fiiCategoryMeta.filter((category) => f.scores[category.key] !== null).map((category) => {
    const value = f.scores[category.key];
    return <article className={scoreTone(value)} key={category.key}><span>{category.label}</span><strong>{value}</strong><small>{category.description}</small></article>;
  })}</div><ScoreWhy scores={f.scores} categories={fiiCategoryMeta} />
	    <DecisionRadar asset={asset} profile={profile} assets={assets} />
	    <MarketOverview asset={asset} />
	    <MetricExplorer metrics={metrics} kind="fii" context={f} />
	    <section className="statement-strip">{[{ label: "Segmento", value: f.segment }, { label: "Gest\xE3o", value: f.managementType }, { label: "Administrador", value: f.administrator }, { label: "P\xFAblico-alvo", value: f.targetAudience }].filter((item) => item.value).map((item) => <div key={item.label}><span>{item.label}</span><b>{item.value}</b></div>)}</section>
	    <div className="data-stamp"><b>Preço: {shortDate(asset.date)}</b><span>Informe mensal: {shortDate(f.referenceDate ?? void 0)} • trimestral: {shortDate(f.quarterDate ?? void 0)}</span></div>
	    <section className="source-section" id="fontes-ativo"><h3>Audite nas fontes</h3><div className="source-links"><a href={links.google} target="_blank" rel="noreferrer">Google Finance ↗</a><a href={links.b3} target="_blank" rel="noreferrer">Fundo na B3 ↗</a><a href={links.cvm} target="_blank" rel="noreferrer">Informe na CVM ↗</a></div></section>
    <div className="honest-note"><b>Leitura importante</b><p>DY passado não garante rendimentos futuros. Quando um informe não permite calcular um indicador com segurança, esse cartão é ocultado e a confiança da nota diminui.</p></div>
  </section></div>;
}
function ExecutiveSummary({ asset, assets, profile }) {
  const opportunity = buildOpportunity(asset, assets);
  if (!opportunity) return null;
  const decision = buildDecision(asset, profile, assets);
  const positives = decision.strengths.length ? decision.strengths : ["nenhum ponto forte atingiu o limite de destaque"];
  const cautions = [...decision.blockers, ...decision.risks].slice(0, 4);
  return <section className="executive-summary" id="resumo-ativo"><div className="executive-heading"><div><span className="eyebrow">RESUMO EXECUTIVO</span><h3>O essencial antes dos detalhes</h3><p>Leitura automática baseada somente nos dados disponíveis. Abra a auditoria para conferir pesos, cobertura e penalidades.</p></div><i className={`system-signal ${opportunity.signal.tone}`}>{opportunity.signal.label}</i></div>
    <div className="executive-kpis"><article><span>Score Fundamental</span><b>{opportunity.fundamental.score ?? "N/D"}<small>/100</small></b><em>qualidade sem considerar o preço</em></article><article className="primary"><span>Score de Oportunidade</span><b>{opportunity.score}<small>/100</small></b><em>nota bruta {opportunity.rawScore} • cobertura {opportunity.coverage}%</em></article><article><span>Preço atual</span><b>{money(asset.price)}</b><em>B3 {shortDate(asset.date)}</em></article><article><span>Faixa justa</span><b>{money(opportunity.fair.low)} – {money(opportunity.fair.high)}</b><em>base {money(opportunity.fair.base)} • {percent(opportunity.potential)}</em></article><article><span>Confiança</span><b>{opportunity.confidence}<small>%</small></b><em>{opportunity.fair.model}</em></article></div>
    <div className="executive-thesis"><article className="positive"><b>Pontos favoráveis</b>{positives.map((item) => <span key={item}>{item}</span>)}</article><article className="caution"><b>Riscos e ressalvas</b>{cautions.length ? cautions.map((item) => <span key={item}>{item}</span>) : <span>nenhuma trava grave foi acionada pelos dados disponíveis</span>}</article></div>
    <details className="executive-audit"><summary>Ver composição e travas do Score <i>⌄</i></summary><div><section className="executive-components">{opportunity.components.map((component) => <article key={component.key}><div><span>{component.label}</span><b>{Math.round(component.value)}/100</b></div><i><em style={{ width: `${component.value}%` }} /></i><small>peso efetivo {number(component.effectiveWeight, 1)}% • contribuição {number(component.contribution, 1)}</small></article>)}</section><section className="executive-calculation"><article><b>Modelo de preço justo</b><p>{opportunity.fair.model}: {opportunity.fair.method}.</p>{opportunity.fair.anchors.map((anchor) => <span key={anchor.label}>{anchor.label}: {money(anchor.value)}{anchor.effectiveWeight ? ` • peso ${anchor.effectiveWeight}%` : ""}</span>)}</article><article><b>Ajustes da nota</b><p>Nota bruta {opportunity.rawScore} − penalidades {opportunity.penaltyPoints} = nota final {opportunity.score}.</p>{opportunity.penalties.map((item) => <span key={item.label}>−{item.points}: {item.label}</span>)}{opportunity.caps.map((item) => <span key={item}>Teto aplicado: {item}</span>)}{!opportunity.penalties.length && !opportunity.caps.length && <span>Sem penalidades ou tetos acionados.</span>}</article></section></div></details>
  </section>;
}
function Detail({ asset, favorite, onFavorite, onClose, profile, assets, anomaly }) {
  if (asset.kind === "fii" && asset.fund) return <FiiDetail asset={asset} favorite={favorite} onFavorite={onFavorite} onClose={onClose} profile={profile} assets={assets} anomaly={anomaly} />;
  const f = asset.fundamentals;
  const scores = f?.scores ?? fallbackScore(asset);
  const metricState = (key) => {
    const state = f?.metricStates?.[key];
    return state === "estimated" ? "estimated" : state === "stale" ? "stale" : state === "not_applicable" ? "not_applicable" : state === "not_found" ? "not_found" : "calculated";
  };
  const audited = (label, value, formula, source, key, inputs, note) => ({
    label,
    value,
    formula,
    source,
    note,
    inputs,
    state: metricState(key),
    period: f?.periodLabel
  });
  const metrics = f ? [
    audited("P/L", number(f.pe), "Valor de mercado \xF7 lucro l\xEDquido 12m", `CVM ${shortDate(f.referenceDate)} + B3 ${shortDate(asset.date)}`, "pe", [{ label: "Valor de mercado", value: compactMoney(f.marketCap) }, { label: "Lucro l\xEDquido 12m", value: compactMoney(f.netIncomeTTM) }]),
    audited("P/VP", number(f.pb), "Valor de mercado \xF7 patrim\xF4nio l\xEDquido", `CVM ${shortDate(f.referenceDate)} + B3 ${shortDate(asset.date)}`, "pb", [{ label: "Valor de mercado", value: compactMoney(f.marketCap) }, { label: "Patrim\xF4nio l\xEDquido", value: compactMoney(f.equity) }]),
    audited("EV/EBIT", number(f.evEbit), "(Valor de mercado + d\xEDvida l\xEDquida) \xF7 EBIT 12m", f.periodLabel, "evEbit", [{ label: "Valor da firma", value: compactMoney(f.enterpriseValue ?? null) }, { label: "EBIT 12m", value: compactMoney(f.ebitTTM) }]),
    audited("ROE", percent(f.roe, false), "Lucro l\xEDquido 12m \xF7 patrim\xF4nio l\xEDquido", f.periodLabel, "roe", [{ label: "Lucro l\xEDquido 12m", value: compactMoney(f.netIncomeTTM) }, { label: "Patrim\xF4nio l\xEDquido", value: compactMoney(f.equity) }]),
    audited("ROA", percent(f.roa, false), "Lucro l\xEDquido 12m \xF7 ativo total", f.periodLabel, "roa", [{ label: "Lucro l\xEDquido 12m", value: compactMoney(f.netIncomeTTM) }, { label: "Ativo total", value: compactMoney(f.assets) }]),
    audited("ROIC", f.financialCompany ? "N/A banco" : percent(f.roic ?? null, false), "EBIT ap\xF3s impostos efetivos \xF7 capital investido", f.periodLabel, "roic", [{ label: "EBIT 12m", value: compactMoney(f.ebitTTM) }, { label: "PL + d\xEDvida l\xEDquida", value: compactMoney(f.equity !== null && f.netDebt !== null ? f.equity + f.netDebt : null) }]),
    audited("Margem bruta", percent(f.grossMargin, false), "Lucro bruto 12m \xF7 receita 12m", f.periodLabel, "grossMargin", [{ label: "Lucro bruto", value: compactMoney(f.grossProfitTTM) }, { label: "Receita", value: compactMoney(f.revenueTTM) }]),
    audited("Margem EBIT", percent(f.ebitMargin, false), "EBIT 12m \xF7 receita 12m", f.periodLabel, "ebitMargin", [{ label: "EBIT", value: compactMoney(f.ebitTTM) }, { label: "Receita", value: compactMoney(f.revenueTTM) }]),
    audited("Margem l\xEDquida", percent(f.netMargin, false), "Lucro l\xEDquido 12m \xF7 receita 12m", f.periodLabel, "netMargin", [{ label: "Lucro l\xEDquido", value: compactMoney(f.netIncomeTTM) }, { label: "Receita", value: compactMoney(f.revenueTTM) }], f.financialCompany ? "Comparabilidade limitada para bancos" : void 0),
    audited("D\xEDvida l\xEDq./EBIT", f.financialCompany ? "N/A banco" : number(f.netDebtEbit), "D\xEDvida l\xEDquida \xF7 EBIT 12m", f.periodLabel, "netDebtEbit", [{ label: "D\xEDvida l\xEDquida", value: compactMoney(f.netDebt) }, { label: "EBIT", value: compactMoney(f.ebitTTM) }]),
    audited("D\xEDvida l\xEDq./EBITDA", f.financialCompany ? "N/A banco" : number(f.netDebtEbitda ?? null), "D\xEDvida l\xEDquida \xF7 EBITDA 12m", f.periodLabel, "netDebtEbitda", [{ label: "D\xEDvida l\xEDquida", value: compactMoney(f.netDebt) }, { label: "EBITDA", value: compactMoney(f.ebitdaTTM ?? null) }]),
    audited("Liquidez corrente", f.financialCompany ? "N/A banco" : number(f.currentRatio), "Ativo circulante \xF7 passivo circulante", `posi\xE7\xE3o em ${shortDate(f.referenceDate)}`, "currentRatio", [{ label: "Ativo circulante", value: compactMoney(f.currentAssets ?? null) }, { label: "Passivo circulante", value: compactMoney(f.currentLiabilities ?? null) }]),
    audited("Cresc. receita", percent(f.revenueGrowth), "Receita do exerc\xEDcio \xF7 receita anterior \u2212 1", "DFP anual comparativa", "revenueGrowth", []),
    audited("Cresc. lucro", percent(f.profitGrowth), "Lucro do exerc\xEDcio \xF7 lucro anterior \u2212 1", "DFP anual comparativa", "profitGrowth", []),
    audited("Dividend yield 12m", percent(f.dividendYield, false), "Proventos por a\xE7\xE3o dos \xFAltimos 12 meses \xF7 cota\xE7\xE3o atual", `B3 at\xE9 ${shortDate(f.dividendSourceDate ?? void 0)}`, "dividendYield", [{ label: "Proventos por a\xE7\xE3o 12m", value: money(f.dividendsPerShare12m ?? null) }, { label: "Cota\xE7\xE3o", value: money(asset.price) }]),
    audited("Proventos por a\xE7\xE3o 12m", money(f.dividendsPerShare12m ?? null), "Soma dos proventos em dinheiro aplic\xE1veis \xE0 classe do ativo", `B3 at\xE9 ${shortDate(f.dividendSourceDate ?? void 0)}`, "dividendYield", [{ label: "Eventos dispon\xEDveis", value: number(f.dividendEvents?.length ?? 0, 0) }]),
    audited("Regularidade 24m", percent(f.dividendRegularity ?? null, false), "Meses com pelo menos um provento \xF7 24 meses", "Eventos oficiais B3", "dividendRegularity", [{ label: "Meses com provento", value: `${f.dividendMonths24m ?? 0} de 24` }]),
    audited("Payout", percent(f.payout ?? null, false), "Proventos por a\xE7\xE3o 12m \xF7 lucro por a\xE7\xE3o 12m", "B3 + CVM", "payout", [{ label: "Proventos por a\xE7\xE3o", value: money(f.dividendsPerShare12m ?? null) }, { label: "LPA", value: money(f.eps) }], "Estimativa por classe; diferen\xE7as entre ON, PN e units s\xE3o preservadas."),
    audited("LPA", money(f.eps), "Lucro l\xEDquido 12m \xF7 a\xE7\xF5es em circula\xE7\xE3o", f.periodLabel, "eps", [{ label: "Lucro l\xEDquido", value: compactMoney(f.netIncomeTTM) }, { label: "A\xE7\xF5es", value: compactNumber(f.sharesOutstanding) }]),
    audited("VPA", money(f.bookValuePerShare), "Patrim\xF4nio l\xEDquido \xF7 a\xE7\xF5es em circula\xE7\xE3o", `posi\xE7\xE3o em ${shortDate(f.referenceDate)}`, "bookValuePerShare", [{ label: "Patrim\xF4nio l\xEDquido", value: compactMoney(f.equity) }, { label: "A\xE7\xF5es", value: compactNumber(f.sharesOutstanding) }]),
    audited("Valor de mercado", compactMoney(f.marketCap), "ON \xD7 cota\xE7\xE3o ON + PN \xD7 cota\xE7\xE3o PN", `B3 ${shortDate(asset.date)} + composi\xE7\xE3o de capital CVM`, "marketCap", [{ label: "A\xE7\xF5es em circula\xE7\xE3o", value: compactNumber(f.sharesOutstanding) }, { label: "Cota\xE7\xE3o", value: money(asset.price) }], f.marketCapEstimated ? "Uma classe sem cota\xE7\xE3o usou a outra como aproxima\xE7\xE3o" : void 0),
    audited("EBITDA 12m", f.financialCompany ? "N/A banco" : compactMoney(f.ebitdaTTM ?? null), "EBIT + deprecia\xE7\xE3o e amortiza\xE7\xE3o identificadas na DFC", f.filingType, "ebitda", [{ label: "EBIT", value: compactMoney(f.ebitTTM) }, { label: "D&A", value: compactMoney(f.depreciationAmortizationTTM ?? null) }]),
    audited("Lucro l\xEDquido 12m", compactMoney(f.netIncomeTTM), "DFP anual + ITR atual \u2212 ITR comparativa compat\xEDvel", f.filingType, "netIncome", [{ label: "Resultado TTM", value: compactMoney(f.netIncomeTTM) }])
  ] : [];
  const links = { google: `https://www.google.com/finance/quote/${encodeURIComponent(asset.ticker)}:BVMF?hl=pt-BR`, b3: `https://sistemaswebb3-listados.b3.com.br/listedCompaniesPage/search?language=pt-br&keyword=${encodeURIComponent(asset.ticker.slice(0, 4))}`, dividends: "https://sistemaswebb3-listados.b3.com.br/dividensOtherCorpActPage/?language=pt-br", cvm: "https://dados.cvm.gov.br/dataset/cia_aberta-doc-itr" };
  return <div className="modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
    <section className="detail-sheet" role="dialog" aria-modal="true" aria-label={`An\xE1lise de ${asset.ticker}`}>
	      <div className="sheet-handle" /><div className="detail-top"><button className="back-btn" onClick={onClose}>← Voltar</button><button className={`favorite large ${favorite ? "active" : ""}`} onClick={onFavorite}>★</button></div>
	      <div className="detail-title"><div><span className="asset-kind">{f?.companyName || asset.name || "ATIVO B3"}</span><h2>{asset.ticker}</h2>{f && <small>{f.cnpj} • CVM {f.cvmCode || "\u2014"}</small>}</div><div className="detail-quote"><strong>{money(asset.price)}</strong><span className={(asset.changepct ?? 0) >= 0 ? "change up" : "change down"}>{percent(asset.changepct)} • B3 {shortDate(asset.date)}</span></div></div>
	      <nav className="detail-jump-nav" aria-label="Seções da análise"><a href="#leitura-ativo">Leitura</a><a href="#plano-ativo">Plano</a>{f && <a href="#resumo-ativo">Resumo</a>}<a href="#visao-geral-ativo">Visão geral</a><a href="#indicadores-ativo">Indicadores</a>{f && <><a href="#empresa-ativo">Empresa</a><a href="#demonstrativos-ativo">Demonstrativos</a></>}<a href="#fontes-ativo">Fontes</a></nav>
	      <ActionReading asset={asset} assets={assets} anomaly={anomaly} />
	      <PositionPlan asset={asset} anomaly={anomaly} />
	      {f && <ExecutiveSummary asset={asset} assets={assets} profile={profile} />}
	      <div className="score-hero"><ScoreRing value={scores.overall} /><div><span className="eyebrow">SCORE FUNDAMENTALISTA</span><h3>{scoreLabel(scores.overall)}</h3><p>Confiança de <b className={`confidence-value ${confidenceTone(scores.confidence)}`}>{scores.confidence}%</b>. A tela exibe somente valores calculados e verificáveis.</p></div></div>
	      {f ? <StockScorePillars fundamentals={f} /> : <div className="honest-note"><b>Score provisório de mercado</b><p>Sem demonstrativos vinculados, esta leitura usa somente preço e liquidez e não é um score fundamentalista.</p></div>}<ScoreWhy scores={scores} categories={categoryMeta} details={f?.scoreDetails} />{f && <DecisionRadar asset={asset} profile={profile} assets={assets} />}{f && <ConfidenceBreakdown fundamentals={f} />}
	      <MarketOverview asset={asset} marketCap={f?.marketCap} />
	      {f ? <><MetricExplorer metrics={metrics} kind="stock" context={f} />
	      <CompanyAndStatements fundamentals={f} />
	      <div className="data-stamp"><b>Último balanço usado: {shortDate(f.referenceDate)}</b><span>{f.filingType} • {f.segment || "segmento n\xE3o informado"}</span></div></> : <div className="honest-note"><b>Sem vínculo contábil automático</b><p>Este código está na base oficial de negociações, mas não foi associado com segurança a uma companhia aberta na FCA atual. O score usa apenas preço e liquidez.</p></div>}
	      <section className="source-section" id="fontes-ativo"><h3>Audite nas fontes</h3><div className="source-links"><a href={links.google} target="_blank" rel="noreferrer">Google Finance ↗</a><a href={links.b3} target="_blank" rel="noreferrer">Cadastro na B3 ↗</a><a href={links.dividends} target="_blank" rel="noreferrer">Proventos na B3 ↗</a><a href={links.cvm} target="_blank" rel="noreferrer">ITR/DFP na CVM ↗</a></div></section>
      <div className="honest-note"><b>Cobertura da análise</b><p>O pilar Dividendos entra somente quando a B3 vincula o evento à classe do ativo. Datas de pagamento não publicadas na consulta permanecem como “não informado”. Isto não é recomendação de investimento.</p></div>
    </section>
  </div>;
}
function OpportunityPage({ assets, onBack, onOpen }) {
  const [mode, setMode] = useState("undervalued");
  const [query, setQuery] = useState("");
  const [minimum, setMinimum] = useState(0);
  const [health, setHealth] = useState("all");
  const [sort, setSort] = useState("opportunity");
  const rows = useMemo(() => assets.map((asset) => ({ asset, analysis: buildOpportunity(asset, assets) })).filter((row) => row.analysis && row.analysis.fair).filter((row) => mode === "undervalued" ? row.analysis.potential >= 0 : row.analysis.potential < 0).filter((row) => row.asset.ticker.includes(query.trim().toUpperCase()) || row.asset.name?.toUpperCase().includes(query.trim().toUpperCase())).filter((row) => row.analysis.score >= minimum).filter((row) => health === "all" || (health === "strong" ? row.analysis.fundamental.health >= 70 : health === "medium" ? row.analysis.fundamental.health >= 45 && row.analysis.fundamental.health < 70 : row.analysis.fundamental.health < 45)).sort((a, b) => sort === "potential" ? b.analysis.potential - a.analysis.potential : sort === "fair" ? b.analysis.fair.base - a.analysis.fair.base : sort === "pe" ? (a.asset.fundamentals.pe ?? Infinity) - (b.asset.fundamentals.pe ?? Infinity) : sort === "evEbitda" ? (a.analysis.evEbitda ?? Infinity) - (b.analysis.evEbitda ?? Infinity) : b.analysis.score - a.analysis.score), [assets, mode, query, minimum, health, sort]);
  return <div className="opportunity-page"><div className="daily-radar-top"><button className="back-btn" onClick={onBack}>← Visão geral</button><span>Dados B3 + demonstrações CVM</span></div>
    <section className="opportunity-hero"><div><span className="eyebrow">VALUATION INTEGRADO AOS SCORES</span><h1>Ações mais<br /><em>baratas e caras.</em></h1><p>O ranking separa qualidade empresarial de preço. Uma empresa barata só recebe nota alta quando os fundamentos, o fluxo de caixa e a confiança dos dados sustentam a oportunidade.</p></div><div className="opportunity-formula"><span>SCORE DE OPORTUNIDADE</span><div><b>45%</b> fundamentos</div><div><b>25%</b> desconto</div><div><b>20%</b> valuation relativo</div><div><b>10%</b> confiança</div><small>penalidades por prejuízo, patrimônio negativo, caixa ruim e dívida elevada</small></div></section>
    <section className="valuation-controls"><div className="valuation-tabs"><button className={mode === "undervalued" ? "active" : ""} onClick={() => setMode("undervalued")}>Mais subvalorizadas</button><button className={mode === "overvalued" ? "active" : ""} onClick={() => setMode("overvalued")}>Mais sobrevalorizadas</button></div><div className="valuation-filters"><label>Pesquisar<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="PETR4" /></label><label>Score mínimo<select value={minimum} onChange={(event) => setMinimum(Number(event.target.value))}><option value="0">Todos</option><option value="50">50+</option><option value="60">60+</option><option value="70">70+</option><option value="80">80+</option></select></label><label>Saúde financeira<select value={health} onChange={(event) => setHealth(event.target.value)}><option value="all">Todas</option><option value="strong">Forte</option><option value="medium">Intermediária</option><option value="weak">Fraca</option></select></label><label>Ordenar<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="opportunity">Score de oportunidade</option><option value="potential">Potencial</option><option value="fair">Preço justo</option><option value="pe">Menor P/L</option><option value="evEbitda">Menor EV/EBITDA</option></select></label></div></section>
    <div className="valuation-summary"><b>{rows.length}</b><span>ações encontradas</span><p>O sinal é gerado pelo modelo auditável do app; não é recomendação pessoal nem garantia.</p></div>
    <section className="valuation-table" aria-label="Ranking de valuation"><div className="valuation-table-head"><span>Ação</span><span>Preço / justo</span><span>Potencial</span><span>Fundamental</span><span>Oportunidade</span><span>Saúde / caixa</span><span>P/L</span><span>EV/EBITDA</span><span>Sinal do sistema</span></div>{rows.slice(0, 100).map(({ asset, analysis }) => <details className="valuation-row" key={asset.ticker}><summary className="valuation-row-summary"><span className="valuation-company"><b>{asset.ticker}</b><small>{asset.name}</small></span><span data-label="Preço / justo"><b>{money(asset.price)}</b><small>{money(analysis.fair.base)}</small></span><span data-label="Potencial" className={analysis.potential >= 0 ? "positive" : "negative"}><b>{percent(analysis.potential)}</b><small>{analysis.fair.method}</small></span><span data-label="Score fundamental"><b>{analysis.fundamental.score ?? "N/D"}</b><small>cobertura {analysis.fundamental.coverage}%</small></span><span data-label="Score oportunidade"><b className="opportunity-number">{analysis.score}</b><small>cobertura {analysis.coverage}%</small></span><span data-label="Saúde / caixa"><b>{analysis.fundamental.health ?? "N/D"} / {analysis.fundamental.cashFlow ?? "N/D"}</b><small>crescimento {analysis.fundamental.growth ?? "N/D"}</small></span><span data-label="P/L"><b>{number(asset.fundamentals.pe)}</b></span><span data-label="EV/EBITDA"><b>{number(analysis.evEbitda)}</b></span><span data-label="Sinal"><i className={`system-signal ${analysis.signal.tone}`}>{analysis.signal.label}</i>{analysis.penalties.length > 0 && <small>{analysis.penalties.map((item) => `−${item.points} ${item.label}`).join(" • ")}</small>}</span><i className="accordion-arrow">⌄</i></summary><div className="valuation-expand"><div className="expand-score-grid"><article><span>Lucratividade</span><b>{analysis.fundamental.profitability ?? "N/D"}</b><i><em style={{ width: `${analysis.fundamental.profitability ?? 0}%` }} /></i></article><article><span>Saúde financeira</span><b>{analysis.fundamental.health ?? "N/D"}</b><i><em style={{ width: `${analysis.fundamental.health ?? 0}%` }} /></i></article><article><span>Fluxo de caixa</span><b>{analysis.fundamental.cashFlow ?? "N/D"}</b><i><em style={{ width: `${analysis.fundamental.cashFlow ?? 0}%` }} /></i></article><article><span>Crescimento</span><b>{analysis.fundamental.growth ?? "N/D"}</b><i><em style={{ width: `${analysis.fundamental.growth ?? 0}%` }} /></i></article><article><span>Desconto</span><b>{analysis.discountScore ?? "N/D"}</b><i><em style={{ width: `${analysis.discountScore ?? 0}%` }} /></i></article><article><span>Valuation relativo</span><b>{analysis.valuation ?? "N/D"}</b><i><em style={{ width: `${analysis.valuation ?? 0}%` }} /></i></article></div><div className="expand-explanation"><article><b>Como chegou ao preço justo</b><p>{analysis.fair.method}. Faixa matemática entre {money(analysis.fair.low)} e {money(analysis.fair.high)}.</p></article><article><b>Leitura do sistema</b><p>{analysis.penalties.length ? `O score sofreu ${analysis.penalties.length} penalidade(s): ${analysis.penalties.map((item) => item.label).join(", ")}.` : "Nenhuma penalidade financeira grave foi acionada pelos dados disponíveis."} Confiança dos dados: {analysis.confidence}%.</p></article></div><button className="expand-open-detail" onClick={() => onOpen(asset.ticker)}>Abrir análise completa de {asset.ticker} →</button></div></details>)}</section>
    {!rows.length && <div className="empty-state"><h3>Nenhuma ação encontrada</h3><p>Reduza os filtros para ampliar a lista.</p></div>}
    <section className="radar-method"><h2>Leitura correta</h2><p><b>Score Fundamental</b> ignora o preço e mede lucratividade, saúde, caixa, crescimento e dividendos. <b>Score de Oportunidade</b> acrescenta desconto, valuation relativo e confiança. Campos ausentes não viram zero: saem da média e reduzem a cobertura.</p><strong>Ferramenta educacional. Confira as demonstrações e os riscos antes de qualquer decisão financeira.</strong></section>
  </div>;
}
function RankingChart({ rows, title, direction }) {
  return <article className="radar-chart"><div className="radar-chart-head"><div><span className="eyebrow">GRÁFICO 0–100</span><h3>{title}</h3></div><small>mesma escala para todos</small></div><div className="rank-chart" role="img" aria-label={title}>
    {rows.map((row, index) => <div className="rank-chart-row" key={row.ticker}><b>{index + 1}</b><span>{row.ticker}</span><i><em className={direction} style={{ width: `${row.score}%` }} /></i><strong>{row.score}</strong></div>)}
  </div></article>;
}
function PotentialChart({ rows }) {
  const ordered = [...rows].sort((a, b) => b.potentialPct - a.potentialPct);
  const bound = Math.max(10, ...ordered.map((row) => Math.abs(row.potentialPct)));
  return <article className="radar-chart potential-chart"><div className="radar-chart-head"><div><span className="eyebrow">GRÁFICO DE DISTÂNCIA</span><h3>Preço atual até o alvo matemático</h3></div><small>variação percentual, limitada pelo modelo</small></div><div className="potential-axis"><span>queda</span><i /><span>alta</span></div><div className="potential-rows">
    {ordered.map((row) => <div className="potential-row" key={row.ticker}><b>{row.ticker}</b><div><i className={row.potentialPct >= 0 ? "positive" : "negative"} style={row.potentialPct >= 0 ? { left: "50%", width: `${Math.abs(row.potentialPct) / bound * 50}%` } : { right: "50%", width: `${Math.abs(row.potentialPct) / bound * 50}%` }} /></div><strong>{percent(row.potentialPct)}</strong></div>)}
  </div></article>;
}
function RadarCard({ row, direction, onOpen }) {
  const strength = direction === "strength";
  return <article className={`daily-radar-card ${direction}`}><div className="daily-card-head"><div><span className="asset-kind">{strength ? "SINAL DE FORÇA" : "SINAL DE PRESSÃO"}</span><h3>{row.ticker}</h3><small>{row.name}</small></div><div className="daily-score"><b>{row.score}</b><span>/100</span></div></div>
    <div className="mini-score-chart" aria-label={`Composição do score de ${row.ticker}`}><span style={{ width: `${row.fundamentalScore}%` }}>F</span><span style={{ width: `${row.technicalScore}%` }}>T</span><span style={{ width: `${row.newsScore}%` }}>N</span></div>
    <div className="daily-score-labels"><span>Fund. <b>{row.fundamentalScore}</b></span><span>Técnico <b>{row.technicalScore}</b></span><span>Notícias <b>{row.newsScore}</b></span></div>
    <dl className="daily-levels"><div><dt>Preço atual</dt><dd>{money(row.price)}</dd></div><div><dt>{strength ? "Faixa de entrada" : "Zona de reavaliação"}</dt><dd>{money(row.entryLow)} – {money(row.entryHigh)}</dd></div><div><dt>{strength ? "Alvo-base" : "Alvo de pressão"}</dt><dd>{money(row.target)} <small>{percent(row.potentialPct)}</small></dd></div><div><dt>Saída defensiva</dt><dd>{money(row.defensiveExit)}</dd></div></dl>
    <div className="daily-evidence"><span>{row.return20 === null ? "histórico curto" : `20 pregões ${percent(row.return20)}`}</span><span>{row.newsCoverage} notícias</span><span>confiança {row.confidence}%</span></div>
    {row.headlines?.length > 0 && <details className="daily-news"><summary>Notícias usadas no cálculo</summary>{row.headlines.map((item) => <a href={item.url} target="_blank" rel="noreferrer" key={item.url}>{item.title}</a>)}</details>}
    <button className="daily-open" onClick={() => onOpen(row.ticker)}>Abrir indicadores completos →</button>
  </article>;
}
function DailyRadarPage({ radar, onBack, onOpen }) {
  if (!radar) return <div className="daily-radar-page"><button className="back-btn" onClick={onBack}>← Visão geral</button><div className="radar-loading">Carregando o Radar diário…</div></div>;
  const all = [...radar.strength, ...radar.pressure];
  return <div className="daily-radar-page"><div className="daily-radar-top"><button className="back-btn" onClick={onBack}>← Visão geral</button><span>Atualizado {new Date(radar.generatedAt).toLocaleString("pt-BR")}</span></div>
    <section className="daily-radar-hero"><div><span className="eyebrow">RADAR DIÁRIO B3</span><h1>Força e pressão.<br /><em>Somente dados e matemática.</em></h1><p>O sistema examina {radar.universe} ações líquidas, combina fundamentos, tendência de preço, notícias e confiança dos dados, e mostra os 10 maiores sinais em cada direção.</p></div><div className="radar-drawing" aria-hidden="true"><svg viewBox="0 0 240 170"><path d="M25 142H218M43 128l35-34 30 18 42-58 47 20"/><circle cx="43" cy="128" r="7"/><circle cx="78" cy="94" r="7"/><circle cx="108" cy="112" r="7"/><circle cx="150" cy="54" r="7"/><circle cx="197" cy="74" r="7"/></svg></div></section>
    <section className="model-strip"><div><b>42%</b><span>fundamentos</span></div><div><b>32%</b><span>técnico</span></div><div><b>14%</b><span>notícias</span></div><div><b>7%</b><span>liquidez</span></div><div><b>5%</b><span>confiança</span></div></section>
    <section className="radar-charts-grid"><RankingChart rows={radar.strength} title="10 maiores sinais de força" direction="strength" /><RankingChart rows={radar.pressure} title="10 maiores sinais de pressão" direction="pressure" /></section>
    <PotentialChart rows={all} />
    <section className="daily-list-section"><div className="daily-list-title"><span className="eyebrow">LEITURA POSITIVA</span><h2>10 sinais de força</h2><p>Ordenados pelo score combinado. A faixa de entrada e o alvo são zonas matemáticas, não ordens.</p></div><div className="daily-card-grid">{radar.strength.map((row) => <RadarCard key={row.ticker} row={row} direction="strength" onOpen={onOpen} />)}</div></section>
    <section className="daily-list-section pressure-section"><div className="daily-list-title"><span className="eyebrow">LEITURA DE RISCO</span><h2>10 sinais de pressão</h2><p>Indicam deterioração relativa no modelo. A zona inferior serve para reavaliação; não é sugestão de venda a descoberto.</p></div><div className="daily-card-grid">{radar.pressure.map((row) => <RadarCard key={row.ticker} row={row} direction="pressure" onOpen={onOpen} />)}</div></section>
    <section className="radar-method"><h2>Como interpretar</h2><p>{radar.methodology} Os cenários são limitados a +40% e −35% por rodada para impedir que um indicador extremo domine a tela. Fontes: {radar.sources.join(", ")}.</p><strong>Ferramenta educacional. Não constitui recomendação, oferta ou garantia de resultado.</strong></section>
  </div>;
}
function PriceSparkline({ series = [], ticker }) {
  const values = series.map((row) => row.close).filter(Number.isFinite);
  if (values.length < 2) return <span className="spark-empty">histórico indisponível</span>;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const points = values.map((value, index) => `${index / (values.length - 1) * 100},${34 - (value - min) / span * 30}`).join(" ");
  return <svg className="price-spark" viewBox="0 0 100 38" role="img" aria-label={`Evolução recente de ${ticker}`} preserveAspectRatio="none"><line x1="0" y1="34" x2="100" y2="34" /><polyline points={points} /></svg>;
}
function IntegrityPage({ assets, anomalies, onBack, onOpen }) {
  const [query, setQuery] = useState("");
  const [minimum, setMinimum] = useState(0);
  const [kind, setKind] = useState("all");
  const [selected, setSelected] = useState([]);
  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.ticker, asset])), [assets]);
  const rows = useMemo(() => Object.values(anomalies?.assets ?? {}).map((analysis) => ({ analysis, asset: assetMap.get(analysis.ticker) })).filter((row) => row.asset).filter((row) => row.asset.ticker.includes(query.trim().toUpperCase()) || row.asset.name?.toUpperCase().includes(query.trim().toUpperCase())).filter((row) => row.analysis.score >= minimum).filter((row) => kind === "all" || (kind === "fii" ? row.asset.kind === "fii" : row.asset.kind !== "fii")).sort((a, b) => b.analysis.score - a.analysis.score), [anomalies, assetMap, query, minimum, kind]);
  const compared = selected.map((ticker) => rows.find((row) => row.asset.ticker === ticker) ?? { asset: assetMap.get(ticker), analysis: anomalies?.assets?.[ticker] }).filter((row) => row.asset && row.analysis);
  const toggleCompare = (ticker) => setSelected((current) => current.includes(ticker) ? current.filter((item) => item !== ticker) : current.length < 4 ? [...current, ticker] : [...current.slice(1), ticker]);
  return <div className="integrity-page"><div className="daily-radar-top"><button className="back-btn" onClick={onBack}>← Visão geral</button><span>{anomalies?.quoteDate ? `B3 até ${shortDate(anomalies.quoteDate)}` : "Aguardando histórico diário"}</span></div>
    <section className="integrity-hero"><div><span className="eyebrow">INTEGRIDADE DOS MOVIMENTOS</span><h1>Anomalias visíveis.<br /><em>Conclusões responsáveis.</em></h1><p>Compare preço, volume, repetição de extremos, reversões e liquidez. O sistema encontra movimentos fora do padrão — não acusa pessoas ou empresas.</p></div><div className="integrity-shield" aria-hidden="true"><span>⌁</span><b>0–100</b><small>intensidade estatística</small></div></section>
    <section className="integrity-warning"><b>Alerta não é prova de fraude</b><p>Manipulação envolve conduta, intenção e contexto. Oscilações também podem vir de notícias, baixa liquidez, desdobramentos, grupamentos e proventos. Use este painel para saber o que investigar.</p></section>
    <section className="integrity-controls"><label>Pesquisar<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="BBSE3 ou MXRF11" /></label><label>Intensidade mínima<select value={minimum} onChange={(event) => setMinimum(Number(event.target.value))}><option value="0">Todos</option><option value="20">Observar 20+</option><option value="40">Atenção 40+</option><option value="60">Forte 60+</option></select></label><label>Tipo<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">Ações e FIIs</option><option value="stock">Ações</option><option value="fii">FIIs</option></select></label></section>
    {compared.length > 0 && <section className="integrity-compare"><div><span className="eyebrow">COMPARAÇÃO SELECIONADA</span><h2>{compared.length} de 4 ativos</h2></div><div className="compare-grid">{compared.map(({ asset, analysis }) => <article key={asset.ticker}><button aria-label={`Remover ${asset.ticker}`} onClick={() => toggleCompare(asset.ticker)}>×</button><b>{asset.ticker}</b><strong>{analysis.score}<small>/100</small></strong><span>retorno z: {number(analysis.returnZ)}</span><span>volume z: {number(analysis.volumeZ)}</span><span>vol. anual: {percent(analysis.annualizedVolatilityPct, false)}</span><i><em style={{ width: `${analysis.score}%` }} /></i></article>)}</div></section>}
    {!anomalies?.analysed ? <div className="integrity-empty"><h2>O histórico está sendo preparado</h2><p>A próxima atualização automática processará as cotações anuais da B3 e preencherá este painel.</p></div> : <section className="integrity-list"><div className="integrity-list-head"><span>{rows.length} ativos analisados</span><small>selecione até 4 para comparar</small></div>{rows.slice(0, 150).map(({ asset, analysis }) => <details className={`integrity-row ${analysis.classification.tone}`} key={asset.ticker}><summary><span className="integrity-asset"><b>{asset.ticker}</b><small>{asset.kind === "fii" ? "FII" : "AÇÃO"} • {asset.name}</small></span><span className="integrity-score"><b>{analysis.score}</b><small>{analysis.classification.label}</small></span><span><b>{number(analysis.returnZ)}</b><small>z retorno</small></span><span><b>{number(analysis.volumeZ)}</b><small>z volume</small></span><span><b>{percent(analysis.return20Pct)}</b><small>20 pregões</small></span><PriceSparkline series={analysis.series} ticker={asset.ticker} /><i>⌄</i></summary><div className="integrity-expand"><div className="integrity-flags">{analysis.flags.length ? analysis.flags.map((flag) => <article key={flag.code}><b>{flag.label}</b><p>{flag.explanation}</p></article>) : <article><b>Nenhum gatilho relevante</b><p>O movimento recente permaneceu dentro dos limites definidos pelo modelo.</p></article>}</div><div className="integrity-facts"><span>Retorno diário <b>{percent(analysis.latestReturnPct)}</b></span><span>Volatilidade anualizada <b>{percent(analysis.annualizedVolatilityPct, false)}</b></span><span>Volume mediano 20d <b>{compactMoney(analysis.medianVolume20)}</b></span><span>Pregões analisados <b>{analysis.sessions}</b></span></div><div className="integrity-actions"><button className={selected.includes(asset.ticker) ? "selected" : ""} onClick={() => toggleCompare(asset.ticker)}>{selected.includes(asset.ticker) ? "Remover comparação" : "Comparar este ativo"}</button><button onClick={() => onOpen(asset.ticker)}>Abrir análise completa →</button></div></div></details>)}</section>}
    <section className="radar-method"><h2>Como interpretar</h2><p>{anomalies?.methodology ?? "O modelo usa desvios estatísticos de preço e volume, repetição, reversão e liquidez."}</p><strong>{anomalies?.disclaimer ?? "Anomalia estatística não comprova fraude ou manipulação."}</strong><div className="integrity-sources"><a href="https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/historico/mercado-a-vista/cotacoes-historicas/" target="_blank" rel="noreferrer">Cotações históricas B3 ↗</a><a href="https://www.gov.br/cvm/pt-br/assuntos/normas/resolucoes/resolucoes-cvm" target="_blank" rel="noreferrer">Normas CVM ↗</a><a href="https://dados.cvm.gov.br/dataset/cia_aberta-doc-ipe" target="_blank" rel="noreferrer">Fatos e comunicados CVM ↗</a></div></section>
  </div>;
}
function OptionsPage({ assets, anomalies, onBack, onOpen }) {
  const [query, setQuery] = useState("");
  const [reading, setReading] = useState("all");
  const rows = useMemo(() => assets.filter((asset) => asset.kind !== "fii" && asset.fundamentals && asset.price > 0).map((asset) => {
    const anomaly = anomalies?.assets?.[asset.ticker];
    const signal = buildActionSignal(asset, assets, anomaly);
    const liquidityScore = Math.max(0, Math.min(100, 20 + Math.log10(Math.max(asset.volume ?? 1, 1)) * 10));
    const confidence = asset.fundamentals.scores?.confidence ?? 0;
    const anomalySafety = 100 - (anomaly?.score ?? 0);
    const eligibility = Math.round(liquidityScore * .5 + confidence * .3 + anomalySafety * .2);
    const study = signal.code === "buy" ? "Call comprada — estudo direcional" : signal.code === "hold" ? "Put protetiva ou call coberta" : signal.code === "realize" ? "Call coberta, somente com posição" : "Não montar estratégia agora";
    return { asset, anomaly, signal, eligibility, study };
  }).filter((row) => row.asset.ticker.includes(query.trim().toUpperCase()) || row.asset.name?.toUpperCase().includes(query.trim().toUpperCase())).filter((row) => reading === "all" || row.signal.code === reading).sort((a, b) => b.eligibility - a.eligibility), [assets, anomalies, query, reading]);
  return <div className="options-page"><div className="daily-radar-top"><button className="back-btn" onClick={onBack}>← Visão geral</button><span>Camada educacional • sem lançamento descoberto</span></div>
    <section className="options-hero"><div><span className="eyebrow">OPÇÕES • BETA RESPONSÁVEL</span><h1>Analise primeiro<br /><em>o ativo-base.</em></h1><p>Esta primeira versão reúne valuation, leitura do sistema, liquidez e anomalias para selecionar ativos-base que merecem estudo. Ela ainda não recomenda contratos específicos.</p></div><div className="options-risk-box"><b>RISCO MÁXIMO VISÍVEL</b><strong>100%</strong><span>do prêmio em uma opção comprada</span><small>Venda descoberta pode gerar perdas muito superiores. O app não sugere essa operação.</small></div></section>
    <section className="options-boundary"><article><b>O que já está calculado</b><p>Preço e valor justo do ativo-base, leitura comprar/manter/realizar, liquidez, volatilidade e alertas de movimento.</p></article><article><b>O que permanece N/D</b><p>Série, vencimento, strike, bid/ask, volatilidade implícita, delta, theta e preço teórico. Sem esses dados não haverá indicação de contrato.</p></article></section>
    <section className="options-controls"><label>Ativo-base<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="PETR4" /></label><label>Leitura<select value={reading} onChange={(event) => setReading(event.target.value)}><option value="all">Todas</option><option value="buy">Boa faixa para comprar</option><option value="hold">Boa para manter</option><option value="realize">Faixa de realização</option><option value="wait">Aguardar</option></select></label></section>
    <section className="options-table"><div className="options-head"><span>Ativo-base</span><span>Leitura</span><span>Preço / justo</span><span>Liquidez</span><span>Anomalia</span><span>Adequação ao estudo</span><span>Estratégia educacional</span></div>{rows.slice(0, 100).map(({ asset, anomaly, signal, eligibility, study }) => <article key={asset.ticker}><span className="option-underlying"><b>{asset.ticker}</b><small>{asset.name}</small></span><span><i className={`action-chip ${signal.tone}`}>{signal.label}</i></span><span><b>{money(asset.price)}</b><small>{money(signal.plan?.fair?.base)}</small></span><span><b>{compactMoney(asset.volume)}</b><small>volume B3</small></span><span><b>{anomaly?.score ?? "N/D"}</b><small>{anomaly?.classification?.label ?? "histórico ausente"}</small></span><span><b>{eligibility}/100</b><small>filtro do ativo-base</small></span><span><b>{study}</b><button onClick={() => onOpen(asset.ticker)}>Abrir análise do ativo →</button></span></article>)}</section>
    <OptionsLab assets={assets} anomalies={anomalies} />
    <section className="radar-method"><h2>Por que não indicar uma opção agora?</h2><p>Uma tese correta sobre a ação ainda pode perder dinheiro numa opção se o strike, o vencimento, o prêmio, a volatilidade implícita ou a liquidez forem inadequados. A próxima camada só deve entrar quando uma fonte auditável entregar a cadeia completa.</p><strong>Derivativos podem ampliar perdas. Defina limite de risco e nunca trate o Score do ativo-base como garantia para a opção.</strong><div className="integrity-sources"><a href="https://www.gov.br/investidor/pt-br/investir/tipos-de-investimentos/derivativos/mercado-de-opcoes" target="_blank" rel="noreferrer">Mercado de opções — CVM ↗</a><a href="https://www.gov.br/investidor/pt-br/investir/tipos-de-investimentos/derivativos/riscos" target="_blank" rel="noreferrer">Riscos dos derivativos — CVM ↗</a></div></section>
  </div>;
}
function Home() {
  const [assets, setAssets] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("score");
  const [favorites, setFavorites] = useState(/* @__PURE__ */ new Set());
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("official");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [asOf, setAsOf] = useState({ stockPriceAsOf: null, fiiPriceAsOf: null, cvmFilesAsOf: null });
  const [visible, setVisible] = useState(24);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showPlatformChooser, setShowPlatformChooser] = useState(false);
  const [showAndroidGuide, setShowAndroidGuide] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [investorProfile, setInvestorProfile] = useState(DEFAULT_INVESTOR_PROFILE);
  const [profileReady, setProfileReady] = useState(false);
  const [radar, setRadar] = useState(null);
  const [anomalies, setAnomalies] = useState(null);
  const [page, setPage] = useState(() => window.location.hash === "#radar-diario" ? "radar" : window.location.hash === "#oportunidades" ? "opportunity" : window.location.hash === "#integridade" ? "integrity" : window.location.hash === "#opcoes" ? "options" : window.location.hash === "#quant" ? "quant" : "home");
  const load = useCallback(async (force = false) => {
    setLoading(true);
    fetch(REMOTE_ANOMALY_URL, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((payload) => payload && setAnomalies(payload)).catch(() => void 0);
    localStorage.removeItem("b3-score-cache-v6");
    localStorage.removeItem("b3-score-cache-v7");
    localStorage.removeItem("b3-score-cache-v8");
    localStorage.removeItem("b3-score-cache-v9");
    const cached = localStorage.getItem(CACHE_KEY);
    if (!force && cached) {
      try {
        const parsed = JSON.parse(cached);
        const cachedAssets = Array.isArray(parsed.data) ? parsed.data.map(normalize) : [];
        if (Date.now() - parsed.time < 3e5 && healthySnapshot(cachedAssets)) {
          setAssets(cachedAssets);
          setAsOf(parsed.asOf ?? { stockPriceAsOf: null, fiiPriceAsOf: null, cvmFilesAsOf: null });
          setUpdatedAt(new Date(parsed.time));
          setStatus("cache");
          setLoading(false);
          return;
        }
        localStorage.removeItem(CACHE_KEY);
      } catch {
        localStorage.removeItem(CACHE_KEY);
      }
    }
    try {
      const [stockResponse, fiiResponse, radarResponse, anomalyResponse] = await Promise.all([
        fetch(REMOTE_STOCK_URL, { cache: "no-store" }),
        fetch(REMOTE_FII_URL, { cache: "no-store" }),
        fetch(REMOTE_RADAR_URL, { cache: "no-store" }).catch(() => null),
        fetch(REMOTE_ANOMALY_URL, { cache: "no-store" }).catch(() => null)
      ]);
      if (!stockResponse.ok || !fiiResponse.ok) throw new Error();
      const stockRaw = await stockResponse.json();
      const fiiRaw = await fiiResponse.json();
      if (radarResponse?.ok) setRadar(await radarResponse.json());
      if (anomalyResponse?.ok) setAnomalies(await anomalyResponse.json());
      const cleaned = [...stockRaw, ...fiiRaw].map(normalize).filter((a) => a.ticker && a.price && a.price > 0);
      if (!healthySnapshot(cleaned)) throw new Error();
      const latest = (rows) => rows.map((row) => row.date ?? "").filter(Boolean).sort().at(-1) ?? null;
      const cvmFilesAsOf = cleaned.map((row) => row.fund?.referenceDate ?? row.fundamentals?.referenceDate ?? "").filter(Boolean).sort().at(-1) ?? null;
      const dates = {
        stockPriceAsOf: latest(cleaned.filter((row) => row.kind !== "fii")),
        fiiPriceAsOf: latest(cleaned.filter((row) => row.kind === "fii")),
        cvmFilesAsOf
      };
      setAssets(cleaned);
      setAsOf(dates);
      setStatus("live");
      setUpdatedAt(/* @__PURE__ */ new Date());
      localStorage.setItem(CACHE_KEY, JSON.stringify({ time: Date.now(), data: cleaned, asOf: dates }));
    } catch {
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          const cachedAssets = Array.isArray(parsed.data) ? parsed.data.map(normalize) : [];
          if (healthySnapshot(cachedAssets)) {
            setAssets(cachedAssets);
            setAsOf(parsed.asOf ?? { stockPriceAsOf: null, fiiPriceAsOf: null, cvmFilesAsOf: null });
            setStatus("cache");
            setUpdatedAt(new Date(parsed.time));
          }
        } catch {
          localStorage.removeItem(CACHE_KEY);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem("b3-score-favorites-v2") ?? "[]");
    let savedProfile = DEFAULT_INVESTOR_PROFILE;
    try {
      savedProfile = { ...DEFAULT_INVESTOR_PROFILE, ...JSON.parse(localStorage.getItem("b3-score-investor-profile-v1") ?? "{}") };
    } catch {
      localStorage.removeItem("b3-score-investor-profile-v1");
    }
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || Boolean(navigator.standalone);
    const platformChoice = localStorage.getItem("b3-score-platform-v1");
    const frame = requestAnimationFrame(() => {
      setStandalone(isStandalone);
      if (!isStandalone && !platformChoice) setShowPlatformChooser(true);
      setFavorites(new Set(saved));
      setInvestorProfile(savedProfile);
      setProfileReady(true);
      void load();
    });
    if ("serviceWorker" in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => void 0);
    const capture = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", capture);
    const timer = window.setInterval(() => {
      if (!document.hidden) load(true);
    }, 3e5);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      window.removeEventListener("beforeinstallprompt", capture);
    };
  }, [load]);
  useEffect(() => {
    const syncPage = () => setPage(window.location.hash === "#radar-diario" ? "radar" : window.location.hash === "#oportunidades" ? "opportunity" : window.location.hash === "#integridade" ? "integrity" : window.location.hash === "#opcoes" ? "options" : window.location.hash === "#quant" ? "quant" : "home");
    window.addEventListener("hashchange", syncPage);
    return () => window.removeEventListener("hashchange", syncPage);
  }, []);
  useEffect(() => {
    if (profileReady) localStorage.setItem("b3-score-investor-profile-v1", JSON.stringify(investorProfile));
  }, [investorProfile, profileReady]);
  useEffect(() => {
    document.body.classList.toggle("modal-open", Boolean(selected));
    const closeOnEscape = (event) => event.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.classList.remove("modal-open");
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [selected]);
  const toggleFavorite = (ticker) => setFavorites((current) => {
    const next = new Set(current);
    if (next.has(ticker)) next.delete(ticker);
    else next.add(ticker);
    localStorage.setItem("b3-score-favorites-v2", JSON.stringify([...next]));
    return next;
  });
  const filtered = useMemo(() => {
    const term = query.trim().toUpperCase();
    let result = assets.filter((a) => a.ticker.includes(term) || a.name?.toUpperCase().includes(term) || a.fundamentals?.companyName.toUpperCase().includes(term) || a.fund?.name.toUpperCase().includes(term));
    if (filter === "favorites") result = result.filter((a) => favorites.has(a.ticker));
    if (filter === "fundamentals") result = result.filter((a) => a.fundamentals || a.fund?.cnpj);
    if (filter === "candidates") result = result.filter((a) => buildDecision(a, investorProfile).status === "candidate");
    if (["buy", "hold", "sell"].includes(filter)) result = result.filter((a) => {
      const signal = buildActionSignal(a, assets, anomalies?.assets?.[a.ticker]);
      if (filter === "sell") return signal.code === "realize" || signal.code === "reduce";
      return signal.code === filter;
    });
    if (filter === "stocks") result = result.filter((a) => a.kind === "stock" || a.kind === "unit");
    if (filter === "fiis") result = result.filter((a) => a.kind === "fii");
    if (filter === "gainers") result = result.filter((a) => (a.changepct ?? 0) > 0);
    if (filter === "losers") result = result.filter((a) => (a.changepct ?? 0) < 0);
    if (filter === "units") result = result.filter((a) => a.kind === "unit");
    return [...result].sort((a, b) => sort === "ticker" ? a.ticker.localeCompare(b.ticker) : sort === "change" ? filter === "losers" ? (a.changepct ?? Infinity) - (b.changepct ?? Infinity) : (b.changepct ?? -Infinity) - (a.changepct ?? -Infinity) : sort === "volume" ? (b.volume ?? -Infinity) - (a.volume ?? -Infinity) : sort === "decision" ? buildDecision(b, investorProfile).fitScore - buildDecision(a, investorProfile).fitScore : assetScore(b) - assetScore(a));
  }, [assets, query, filter, favorites, sort, investorProfile, anomalies]);
  const market = useMemo(() => ({ up: assets.filter((a) => (a.changepct ?? 0) > 0).length, down: assets.filter((a) => (a.changepct ?? 0) < 0).length, stocks: assets.filter((a) => a.kind !== "fii").length, fiis: assets.filter((a) => a.kind === "fii").length, covered: assets.filter((a) => a.fundamentals || a.fund?.cnpj).length }), [assets]);
  const dataCoverage = useMemo(() => {
    const stocks = assets.filter((asset) => asset.kind !== "fii");
    const linked = stocks.filter((asset) => asset.fundamentals);
    return { total: stocks.length, linked: linked.length, pe: linked.filter((asset) => asset.fundamentals?.pe !== null).length, pb: linked.filter((asset) => asset.fundamentals?.pb !== null).length, roe: linked.filter((asset) => asset.fundamentals?.roe !== null).length, dividends: linked.filter((asset) => asset.fundamentals?.dividendYield !== null).length };
  }, [assets]);
  const statusText = status === "live" ? "B3 + CVM atualizados" : status === "official" ? "B3 + balan\xE7os CVM" : "\xDAltimo cache salvo";
  const chooseWeb = () => {
    localStorage.setItem("b3-score-platform-v1", "web");
    setShowAndroidGuide(false);
    setShowPlatformChooser(false);
  };
  const installAndroid = async () => {
    localStorage.setItem("b3-score-platform-v1", "android");
    if (standalone) {
      setShowPlatformChooser(false);
      return;
    }
    if (installPrompt) {
      await installPrompt.prompt();
      setShowPlatformChooser(false);
      return;
    }
    setShowAndroidGuide(true);
  };
  const openPage = (next) => {
    window.location.hash = next === "radar" ? "radar-diario" : next === "opportunity" ? "oportunidades" : next === "integrity" ? "integridade" : next === "options" ? "opcoes" : next === "quant" ? "quant" : "top";
    setPage(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const openRadarAsset = (ticker) => {
    const asset = assets.find((item) => item.ticker === ticker);
    if (asset) setSelected(asset);
  };
  return <main><div className="ambient one" /><div className="ambient two" />
    {showPlatformChooser && <div className="platform-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && chooseWeb()}><section className="platform-chooser" role="dialog" aria-modal="true" aria-labelledby="platform-title">
      <button className="platform-close" aria-label="Fechar escolha de versão" onClick={chooseWeb}>×</button>
      <div className="platform-brand"><span className="brand-mark"><i />B3</span><span><b>B3 Score</b><small>ESCOLHA COMO USAR</small></span></div>
      <span className="eyebrow">WEB OU ANDROID</span><h2 id="platform-title">Como você quer abrir?</h2><p className="platform-intro">As duas versões usam os mesmos dados, favoritos, carteira virtual e indicadores.</p>
      <div className="platform-options">
        <article><div className="platform-icon web">⌕</div><span className="platform-tag">VERSÃO WEB</span><h3>Abrir no navegador</h3><p>Use imediatamente no computador ou celular, sem instalar nada.</p><ul><li>Sempre acessível pelo link</li><li>Atualizações automáticas</li><li>Ideal para computador</li></ul><button className="web-choice" onClick={chooseWeb}>Continuar na Web</button></article>
        <article className="android-option"><div className="platform-icon android">▣</div><span className="platform-tag">APP ANDROID • PWA</span><h3>Instalar no celular</h3><p>Adicione o B3 Score à tela inicial e abra como um aplicativo.</p><ul><li>Ícone na tela inicial</li><li>Tela cheia, sem barra do navegador</li><li>Cache para falhas temporárias</li></ul><button className="android-choice" onClick={installAndroid}>{standalone ? "App j\xE1 instalado" : "Instalar no Android"}</button></article>
      </div>
      {showAndroidGuide && <div className="android-guide"><b>Instalação manual no Android</b><ol><li>Abra este site no <strong>Google Chrome</strong>.</li><li>Toque no menu <strong>⋮</strong> no canto superior.</li><li>Escolha <strong>“Instalar app”</strong> ou <strong>“Adicionar à tela inicial”</strong>.</li></ol><small>Não é necessário baixar APK nem pagar pela instalação.</small></div>}
      <p className="platform-footnote">Você pode abrir esta escolha novamente pelo botão “Web / instalar” no topo.</p>
    </section></div>}
    <header className="site-header"><div className="header-inner"><a className="brand" href="#top"><span className="brand-mark"><i />B3</span><span><b>B3 Score</b><small>FUNDAMENTOS ABERTOS</small></span></a><div className="header-actions"><button className={`quant-nav ${page === "quant" ? "active" : ""}`} onClick={() => openPage("quant")}>∑ <span>Quant</span></button><button className={`opportunity-nav ${page === "opportunity" ? "active" : ""}`} onClick={() => openPage("opportunity")}>◇ <span>Preço justo</span></button><button className={`radar-nav ${page === "radar" ? "active" : ""}`} onClick={() => openPage("radar")}>⌁ <span>Momento</span></button><button className={`integrity-nav ${page === "integrity" ? "active" : ""}`} onClick={() => openPage("integrity")}>◎ <span>Alertas</span></button><button className={`options-nav ${page === "options" ? "active" : ""}`} onClick={() => openPage("options")}>◉ <span>Opções β</span></button><button className="portfolio-nav" onClick={() => {
    if (page !== "home") openPage("home");
    window.setTimeout(() => document.getElementById("carteira")?.scrollIntoView({ behavior: "smooth" }), 40);
  }}>▦ <span>Carteira</span></button><button className="install-btn" onClick={() => {
    setShowAndroidGuide(true);
    setShowPlatformChooser(true);
  }}>▣ <span>Web / instalar</span></button><button className={`refresh-btn ${loading ? "loading" : ""}`} disabled={loading} aria-label={loading ? "Atualizando dados" : "Atualizar dados"} title={loading ? "Atualizando dados" : "Atualizar dados"} onClick={() => load(true)}>↻</button></div></div></header>
    <div className="page" id="top">{page === "radar" ? <DailyRadarPage radar={radar} onBack={() => openPage("home")} onOpen={openRadarAsset} /> : page === "opportunity" ? <OpportunityPage assets={assets} onBack={() => openPage("home")} onOpen={openRadarAsset} /> : page === "integrity" ? <IntegrityPage assets={assets} anomalies={anomalies} onBack={() => openPage("home")} onOpen={openRadarAsset} /> : page === "options" ? <OptionsPage assets={assets} anomalies={anomalies} onBack={() => openPage("home")} onOpen={openRadarAsset} /> : page === "quant" ? <QuantPage assets={assets} anomalies={anomalies} onBack={() => openPage("home")} onOpen={openRadarAsset} /> : <><section className="hero"><div className="hero-copy"><div className="live-badge"><i className={status} /> {statusText} <span>• ações {shortDate(asOf.stockPriceAsOf ?? void 0)} • FIIs {shortDate(asOf.fiiPriceAsOf ?? void 0)} • CVM {shortDate(asOf.cvmFilesAsOf ?? void 0)}</span></div><h1>Ações e FIIs.<br /><em>Cada um com sua régua.</em></h1><p>Compare empresas e fundos imobiliários com indicadores calculados a partir dos arquivos oficiais da B3 e da CVM — sempre com fórmula, período e fonte.</p><div className="hero-buttons"><button className="hero-radar-button" onClick={() => openPage("quant")}>Central Quant →</button><button className="hero-radar-button secondary" onClick={() => openPage("opportunity")}>Preço justo →</button><button className="hero-radar-button secondary" onClick={() => openPage("radar")}>Momento do mercado →</button><button className="hero-radar-button secondary" onClick={() => openPage("integrity")}>Alertas de movimentos →</button><button className="hero-radar-button secondary" onClick={() => openPage("options")}>Opções (Beta) →</button></div></div><div className="market-card"><div className="market-card-top"><span>UNIVERSO MONITORADO</span><b className="up">{assets.length || 650}</b></div><div className="sentiment-bar coverage"><i style={{ width: `${assets.length ? market.covered / assets.length * 100 : 0}%` }} /></div><div className="market-stats"><span>{market.stocks} ações/units</span><span>{market.fiis} FIIs</span><span>{market.covered} com CVM</span></div></div></section>
      <section className="trust-row"><article><b>B3 D-1</b><span>último fechamento oficial disponível</span></article><article><b>CVM</b><span>DFP/ITR e informes de FIIs</span></article><article><b>0 invenção</b><span>só aparece valor calculável</span></article><article><b>Score correto</b><span>empresas e FIIs usam critérios diferentes</span></article></section>
      <InvestorProfile profile={investorProfile} onChange={setInvestorProfile} />
      <AnalysisGuide />
      <PortfolioSimulator assets={assets} asOf={asOf} />
      <section className="explorer"><div className="search-row"><label className="search-box"><span>⌕</span><input value={query} aria-label="Pesquisar ativo" onChange={(e) => {
    setQuery(e.target.value);
    setVisible(24);
  }} placeholder="Busque PETR4, HGLG11, MXRF11..." />{query && <button aria-label="Limpar pesquisa" onClick={() => setQuery("")}>×</button>}</label><button className={`desktop-refresh ${loading ? "loading" : ""}`} disabled={loading} onClick={() => load(true)}>{loading ? "\u21BB Atualizando" : "\u21BB Consultar"}</button></div><div className="filter-row" aria-label="Filtros de ativos">{FILTERS.map((item) => <button key={item.id} className={filter === item.id ? "active" : ""} onClick={() => {
    setFilter(item.id);
    if (item.id === "gainers" || item.id === "losers") setSort("change");
    setVisible(24);
  }}>{item.label}{item.id === "favorites" && favorites.size > 0 && <b>{favorites.size}</b>}</button>)}</div></section>
      <div className="list-heading"><div><span className="eyebrow">RADAR B3</span><h2>{filter === "favorites" ? "Seus favoritos" : filter === "fundamentals" ? "Ativos com dados oficiais" : filter === "fiis" ? "Fundos imobili\xE1rios" : filter === "stocks" ? "A\xE7\xF5es e units" : "Ativos para explorar"}</h2></div><div className="list-tools"><span>{filtered.length} resultados{updatedAt ? ` \u2022 consulta ${updatedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : ""}</span><label>Ordenar por <select value={sort} onChange={(event) => {
    setSort(event.target.value);
    setVisible(24);
  }}><option value="decision">Melhor encaixe no perfil</option><option value="score">Maior nota</option><option value="ticker">Código A–Z</option><option value="change">Maior alta</option><option value="volume">Maior liquidez</option></select></label></div></div>
      <section className="score-legend" aria-label="Legenda das notas"><div className="legend-title"><span className="eyebrow">COMO LER A NOTA</span><p>A cor resume a faixa do score. Toque no ativo para ver o motivo da nota.</p></div><div className="legend-items">{SCORE_LEGEND.map((item) => <div className={`legend-item ${item.tone}`} key={item.range}><i /><span><b>{item.range}</b>{item.label}</span></div>)}</div><p className="confidence-legend"><b>Confiança dos dados:</b> <span className="high">alta</span> <span className="medium">média</span> <span className="low">baixa</span></p></section>
      {loading && !assets.length ? <div className="skeleton-grid">{Array.from({ length: 8 }).map((_, i) => <div className="skeleton" key={i} />)}</div> : filtered.length ? <><div className="asset-grid">{filtered.slice(0, visible).map((asset) => <AssetCard key={asset.ticker} asset={asset} favorite={favorites.has(asset.ticker)} onFavorite={() => toggleFavorite(asset.ticker)} onOpen={() => setSelected(asset)} assets={assets} anomaly={anomalies?.assets?.[asset.ticker]} />)}</div>{visible < filtered.length && <button className="load-more" onClick={() => setVisible((v) => v + 24)}>Mostrar mais ↓</button>}</> : <div className="empty-state"><div>⌕</div><h3>Nenhum ativo encontrado</h3><p>Tente outro código ou filtro.</p></div>}
      <section className="nd-section"><div className="nd-heading"><div><span className="eyebrow">COBERTURA DOS DADOS</span><h2>Indicadores completos, sem cartões vazios.</h2></div><p>O aplicativo mostra somente valores que consegue calcular e verificar. Uma lacuna reduz a confiança da análise, mas nunca vira zero nem número estimado.</p></div><div className="coverage-grid"><article><strong>{dataCoverage.linked}/{dataCoverage.total}</strong><span>ações/units com vínculo contábil seguro</span></article><article><strong>{dataCoverage.pe}</strong><span>com P/L calculável</span></article><article><strong>{dataCoverage.pb}</strong><span>com P/VP calculável</span></article><article><strong>{dataCoverage.roe}</strong><span>com ROE calculável</span></article><article className="coverage-alert"><strong>{dataCoverage.dividends}</strong><span>com dividend yield normalizado</span></article></div><div className="nd-explanation"><article><b>1. Indicadores disponíveis</b><p>P/L, P/VP, ROE, margens, crescimento e endividamento aparecem quando as contas necessárias estão vinculadas ao balanço oficial.</p></article><article><b>2. Regras por setor</b><p>Indicadores industriais de dívida são ocultados em bancos, onde não são diretamente comparáveis.</p></article><article><b>3. Proventos oficiais</b><p>Dividend yield, regularidade e payout entram quando a B3 identifica o evento e a classe correta da ação. Datas ausentes continuam N/D.</p></article><article className="nd-impact"><b>Como isso afeta a nota?</b><p>A nota usa apenas os blocos válidos e informa a cobertura pela confiança. Portanto, 80/100 com confiança de 40% é menos completo que 80/100 com confiança de 90%.</p><code>score = soma dos blocos válidos ÷ quantidade de blocos válidos</code></article></div></section>
      <section className="how-section"><div><span className="eyebrow">MÉTODO AUDITÁVEL</span><h2>Duas réguas.<br />Nenhum atalho.</h2><p>Empresas são avaliadas por preço, qualidade, dívida e dividendos. FIIs usam P/VP, renda, imóveis, risco e liquidez. O total considera somente os blocos disponíveis.</p></div><div className="how-grid">{[["01", "Empresas", "CVM + B3: valuation, rentabilidade, d\xEDvida e proventos"], ["02", "Fundos imobili\xE1rios", "Informes: P/VP, DY, patrim\xF4nio, passivos e vac\xE2ncia"], ["03", "Pre\xE7o oficial", "Fechamento B3 com a data real do preg\xE3o"], ["04", "Sem preenchimento", "Campo sem base segura \xE9 ocultado e sai da m\xE9dia"]].map(([id, title, text]) => <article key={id}><span>{id}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div></section>
      <section className="install-section" id="install-guide"><div className="phone-icon">↓</div><div><span className="eyebrow">WEB OU ANDROID</span><h2>Escolha como usar</h2><p>Continue na versão Web ou instale o PWA no Android. As duas versões compartilham os mesmos recursos e dados.</p></div><button onClick={() => {
    setShowAndroidGuide(false);
    setShowPlatformChooser(true);
  }}>Escolher versão</button></section>
      <footer><div className="brand"><span className="brand-mark"><i />B3</span><span><b>B3 Score</b><small>FUNDAMENTOS ABERTOS</small></span></div><p>Ações: fechamento B3 de {shortDate(asOf.stockPriceAsOf ?? void 0)}. FIIs: fechamento B3 de {shortDate(asOf.fiiPriceAsOf ?? void 0)}. Informes CVM: referência mais recente em {shortDate(asOf.cvmFilesAsOf ?? void 0)}. “Consultar” busca novamente e mantém o último snapshot válido se uma fonte estiver indisponível.</p><p className="disclaimer">Ferramenta educacional. Não constitui análise profissional, oferta ou recomendação de compra ou venda.</p></footer></>}
    </div>{selected && <Detail asset={selected} favorite={favorites.has(selected.ticker)} onFavorite={() => toggleFavorite(selected.ticker)} onClose={() => setSelected(null)} profile={investorProfile} assets={assets} anomaly={anomalies?.assets?.[selected.ticker]} />}</main>;
}
export {
  Home as default
};
