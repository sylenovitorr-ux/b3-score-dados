import { useEffect, useMemo, useState } from "react";
import { buildQuantAnalysis } from "./quant/quant-engine.js";
import { buildBuySellScore } from "./analysis/buy-sell-score.js";
import { fairValueRange } from "./opportunity-engine.js";
import { issuerKey, uniqueByIssuer } from "./issuer-key.js";
import { assetKindLabel, lotSizeFor, marketSymbol, matchesAssetSearch, maxQuantityFor, underlyingTicker } from "./battle-market.js";
import { BATTLE_MODEL_VERSION, DEFAULT_EXECUTION, addMonths, allocatedCapital, battleEquitySeries, battlePlanFingerprint, closeOrder, competitorMetrics, equityStats, finite, localDate, marketSnapshotFingerprint, modelPositionAllocations, modelPositionCount, nextTradingDate, processOrder } from "./battle-engine.js";
import { marketDataHealth } from "./data/market-health.js";
import { isB3TradingDate, nextB3TradingDate } from "./market-calendar.js";
import { buildBattleBenchmarkSeries, excessReturn, mergeBenchmarksIntoBattleRows } from "./battle-benchmarks.js";
import "./BattleArena.css";

const KEY = "b3-score-battles-v3";
const LEGACY_KEYS = ["b3-score-battles-v2", "b3-score-battles-v1"];
const ANOMALY_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/market-anomalies.json";
const BENCHMARK_URL = `${import.meta.env.BASE_URL}data/benchmarks.json`;
const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value) => value == null ? "N/D" : `${value > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const pp = (value) => value == null ? "N/D" : `${value > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} p.p.`;
const id = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const statusLabel = (status) => status === "running" ? "EM ANDAMENTO" : status === "finished" ? "ENCERRADA" : "EM PREPARAÇÃO";
const formatDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR") : "N/D";

function annualProfitSeries(fundamentals) {
  const candidates = [fundamentals?.annualHistory, fundamentals?.history?.annual, fundamentals?.history?.yearly, fundamentals?.annual];
  const rows = candidates.find(Array.isArray) ?? [];
  return rows.map((row) => finite(row?.netIncome ?? row?.netProfit ?? row?.profit ?? row?.lucroLiquido)).filter((value) => value != null);
}

function fundamentalGate(asset) {
  if (asset?.kind === "fii") {
    const scores = asset?.fund?.scores;
    const overall = finite(scores?.overall);
    const confidence = finite(scores?.confidence);
    const pb = finite(asset?.fund?.pb);
    const pass = finite(asset?.price) > 0 && overall != null && overall >= 55
      && confidence != null && confidence >= 50 && finite(asset?.volume) > 0;
    return { pass, reasons: [
      overall != null ? `nota FII ${Math.round(overall)}/100` : null,
      confidence != null ? `confiança ${Math.round(confidence)}/100` : null,
      pb != null ? `P/VP ${pb.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}` : null,
    ].filter(Boolean) };
  }
  const f = asset?.fundamentals;
  if (!f || !(finite(asset.price) > 0)) return { pass: false, reasons: [] };
  const quality = finite(f?.scores?.quality);
  const overall = finite(f?.scores?.overall);
  const confidence = finite(f?.scores?.confidence);
  const eps = finite(f?.eps);
  const margin = finite(f?.netMargin);
  const roe = finite(f?.roe);
  const profitGrowth = finite(f?.profitGrowth);
  const annual = annualProfitSeries(f).slice(-5);
  const annualPositive = annual.length >= 3 ? annual.filter((value) => value > 0).length >= Math.ceil(annual.length * .6) && annual.at(-1) > 0 : null;
  const currentProfitability = eps != null ? eps > 0 : margin != null ? margin > 0 : roe != null ? roe > 0 : false;
  const pass = quality != null && quality >= 55 && overall != null && overall >= 55
    && (confidence == null || confidence >= 50) && currentProfitability
    && annualPositive !== false && (profitGrowth == null || profitGrowth > -40);
  return { pass, reasons: [
    quality != null ? `qualidade ${Math.round(quality)}/100` : null,
    annual.length >= 3 ? `${annual.filter((value) => value > 0).length}/${annual.length} anos com lucro positivo` : currentProfitability ? "rentabilidade atual positiva" : null,
    confidence != null ? `confiança ${Math.round(confidence)}/100` : null,
  ].filter(Boolean) };
}

function emptyBattle() {
  const capital = 10000;
  return {
    id: id("battle"), name: `Você vs IA · ${new Date().toLocaleDateString("pt-BR")}`,
    strategy: "swing", capital, positionAllocation: 1000, startDate: nextTradingDate(), status: "setup", horizonMonths: 3, marketMode: "fractional",
    ...DEFAULT_EXECUTION, createdAt: new Date().toISOString(), modelVersion: BATTLE_MODEL_VERSION,
    audit: [{ at: new Date().toISOString(), type: "battle-created", label: "Disputa criada" }],
    competitors: [
      { id: id("mine"), name: "Você", kind: "mine", capital, orders: [] },
      { id: id("model"), name: "IA B3 Score", kind: "model", capital, orders: [] },
    ],
  };
}

function hydrateBattle(source) {
  const horizonMonths = [1, 2, 3, 6, 12].includes(Number(source?.horizonMonths)) ? Number(source.horizonMonths) : 6;
  const marketMode = source?.marketMode === "standard" ? "standard" : "fractional";
  const positionAllocation = finite(source?.positionAllocation) > 0 ? finite(source.positionAllocation) : finite(source?.competitors?.find((item) => item.kind === "mine")?.orders?.[0]?.allocation) ?? 1000;
  return { transactionCostPct: DEFAULT_EXECUTION.transactionCostPct, slippagePct: DEFAULT_EXECUTION.slippagePct, ambiguityPolicy: DEFAULT_EXECUTION.ambiguityPolicy, audit: [], ...source, horizonMonths, marketMode, positionAllocation, competitors: (source?.competitors ?? []).map((competitor) => ({
    ...competitor,
    orders: (competitor.orders ?? []).map((order) => ({
      ...order,
      deadline: order.deadline || addMonths(source.startDate, horizonMonths),
      displayTicker: order.displayTicker || marketSymbol({ ticker: order.ticker, kind: order.assetKind || "stock" }, marketMode),
      lotSize: Math.max(1, finite(order.lotSize) ?? 1),
      maxQuantity: order.maxQuantity ?? (order.assetKind !== "fii" && marketMode === "fractional" ? 99 : null),
      assetKind: order.assetKind || "stock",
    })),
  })) };
}

function migrateBattle(source) {
  const fresh = emptyBattle();
  const capital = finite(source?.capital) > 0 ? finite(source.capital) : fresh.capital;
  const byKind = new Map((source?.competitors ?? []).map((competitor) => [competitor.kind, competitor]));
  const startDate = nextTradingDate();
  const competitors = fresh.competitors.map((base) => {
    const old = byKind.get(base.kind);
    return { ...base, id: old?.id ?? base.id, name: old?.name ?? base.name, capital, orders: (old?.orders ?? []).map((order) => ({
      ...order, status: "waiting", strategy: "swing", startDate,
      entryPrice: null, entryDate: null, quantity: null, exitPrice: null, exitDate: null,
      exitReason: null, pnl: null, returnPct: null, audit: [...(order.audit ?? []), { at: new Date().toISOString(), type: "migration-v2-reset" }],
    })) };
  });
  return { ...fresh, id: source?.id ?? fresh.id, name: source?.name ?? fresh.name, capital, startDate, competitors, migratedAt: new Date().toISOString() };
}

const allocationSum = (competitor) => (competitor?.orders ?? []).filter((order) => order.status !== "cancelled").reduce((sum, order) => sum + (finite(order.allocation) ?? 0), 0);

function orderValid(order) {
  const entry = finite(order.plannedEntry); const stop = finite(order.stop);
  const target = finite(order.target); const allocation = finite(order.allocation);
  const lotSize = Math.max(1, finite(order.lotSize) ?? 1);
  return entry > 0 && stop > 0 && stop < entry && target > entry && allocation >= entry * lotSize;
}

function planOrder(row, capital, startDate, source, overrides = {}, horizonMonths = 3, marketMode = "fractional", execution = DEFAULT_EXECUTION) {
  const entry = finite(overrides.plannedEntry) ?? finite(row.asset.price);
  const support = finite(row.anomaly?.low20); const fair = finite(row.fair?.base);
  const stop = finite(overrides.stop) ?? (support > 0 && support < entry ? support : entry * .92);
  const target = finite(overrides.target) ?? (fair > entry ? fair : entry * 1.15);
  return {
    id: id("order"), ticker: row.asset.ticker, displayTicker: marketSymbol(row.asset, marketMode), name: row.asset.name,
    assetKind: row.asset.kind, marketMode, lotSize: lotSizeFor(row.asset, marketMode), maxQuantity: maxQuantityFor(row.asset, marketMode), status: "waiting", strategy: "swing",
    plannedEntry: entry, stop, target, allocation: finite(overrides.allocation) ?? capital,
    startDate, deadline: addMonths(startDate, horizonMonths), scoreAtPlan: row.score.score,
    signalAtPlan: row.score.label, scorePartsAtPlan: row.score.parts, qualification: row.gate.reasons,
    dataReferenceDate: row.asset.officialQuoteDate ?? row.asset.date ?? null, modelVersion: BATTLE_MODEL_VERSION,
    transactionCostPct: execution.transactionCostPct, slippagePct: execution.slippagePct,
    createdAt: new Date().toISOString(), source, audit: [],
  };
}

function BattleDailyChart({ rows, chartSeries }) {
  if (!rows.length) return <div className="battle-chart-empty"><b>O gráfico diário começa no primeiro pregão da disputa.</b><span>As carteiras ficam travadas antes da data inicial.</span></div>;
  const width = 900; const height = 270; const pad = 34;
  const values = rows.flatMap((row) => chartSeries.map((item) => finite(row.returns?.[item.id])).filter((value) => value != null));
  const min = Math.min(...values); const max = Math.max(...values); const spread = Math.max(max - min, max * .01, 1);
  const x = (index) => rows.length === 1 ? width / 2 : pad + index / (rows.length - 1) * (width - pad * 2);
  const y = (value) => height - pad - (value - (min - spread * .12)) / (spread * 1.24) * (height - pad * 2);
  const points = (item) => rows.map((row, index) => finite(row.returns[item.id]) == null ? null : `${x(index)},${y(row.returns[item.id])}`).filter(Boolean).join(" ");
  return <div className="battle-daily-chart">
    <div className="battle-chart-legend">{chartSeries.map((item) => <span key={item.id} className={item.kind}><i />{item.name}</span>)}</div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Retorno percentual diário de você, IA, Ibovespa e CDI">
      {[0, .25, .5, .75, 1].map((ratio) => <line key={ratio} x1={pad} x2={width - pad} y1={pad + ratio * (height - pad * 2)} y2={pad + ratio * (height - pad * 2)} />)}
      {chartSeries.map((item) => <polyline key={item.id} className={item.kind} points={points(item)} />)}
    </svg>
    <div className="battle-chart-axis"><span>{formatDate(rows[0].date)}</span><span>{formatDate(rows.at(-1).date)}</span></div>
  </div>;
}

export default function BattleArena({ assets = [], sourcePortfolios = [] }) {
  const [battles, setBattles] = useState([]); const [activeId, setActiveId] = useState(null);
  const [ready, setReady] = useState(false); const [anomalies, setAnomalies] = useState(null);
  const [benchmarkPayload, setBenchmarkPayload] = useState(null);
  const [drafts, setDrafts] = useState({}); const [notice, setNotice] = useState("");
  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.ticker, asset])), [assets]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (Array.isArray(saved?.battles) && saved.battles.length) { const hydrated = saved.battles.map(hydrateBattle); setBattles(hydrated); setActiveId(saved.activeId || hydrated[0].id); }
      else for (const key of LEGACY_KEYS) {
        const legacy = JSON.parse(localStorage.getItem(key) || "null");
        if (Array.isArray(legacy?.battles) && legacy.battles.length) { const migrated = legacy.battles.map(migrateBattle); setBattles(migrated); setActiveId(migrated[0].id); break; }
      }
    } catch { localStorage.removeItem(KEY); }
    setReady(true);
    fetch(ANOMALY_URL, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then(setAnomalies).catch(() => setAnomalies(null));
    fetch(BENCHMARK_URL, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then(setBenchmarkPayload).catch(() => setBenchmarkPayload(null));
  }, []);

  useEffect(() => { if (ready) localStorage.setItem(KEY, JSON.stringify({ version: 3, activeId, battles })); }, [ready, activeId, battles]);

  useEffect(() => {
    if (!ready || !anomalies || !battles.length) return;
    setBattles((current) => {
      let changed = false;
      const next = current.map((battle) => ({ ...battle, competitors: (battle.competitors ?? []).map((competitor) => ({ ...competitor, orders: (competitor.orders ?? []).map((order) => {
        const processed = processOrder(order, battle, assetMap, anomalies);
        if (JSON.stringify(processed) !== JSON.stringify(order)) changed = true;
        return processed;
      }) })) }));
      return changed ? next : current;
    });
  }, [ready, anomalies, assets.length, assetMap, battles.length]);

  const active = battles.find((battle) => battle.id === activeId) ?? null;
  const qualified = useMemo(() => assets.map((asset) => {
    const gate = fundamentalGate(asset); if (!gate.pass) return null;
    const anomaly = anomalies?.assets?.[asset.ticker] ?? null;
    const analysis = buildQuantAnalysis(asset, assets, anomaly, "swing_3_6m");
    const score = buildBuySellScore({ asset, analysis, strategy: "swing" });
    return score.score == null || !Array.isArray(anomaly?.series) || anomaly.series.length < 30 ? null : { asset, gate, analysis, score, fair: fairValueRange(asset), anomaly };
  }).filter(Boolean).sort((a, b) => (b.score.score ?? -1) - (a.score.score ?? -1)), [assets, anomalies]);
  const qualifiedMap = useMemo(() => new Map(qualified.map((row) => [row.asset.ticker, row])), [qualified]);
  const dataHealth = useMemo(() => marketDataHealth(assets, anomalies), [assets, anomalies]);

  const updateBattle = (patch) => setBattles((current) => current.map((battle) => battle.id === activeId ? { ...battle, ...patch } : battle));
  const updateCompetitor = (competitorId, updater) => setBattles((current) => current.map((battle) => battle.id !== activeId ? battle : { ...battle, competitors: battle.competitors.map((competitor) => competitor.id === competitorId ? (typeof updater === "function" ? updater(competitor) : { ...competitor, ...updater }) : competitor) }));
  const createBattle = () => { const battle = emptyBattle(); setBattles((current) => [...current, battle]); setActiveId(battle.id); setNotice(""); };
  const removeBattle = () => { const next = battles.filter((battle) => battle.id !== activeId); setBattles(next); setActiveId(next[0]?.id ?? null); };
  const setCapital = (value) => { const capital = Math.max(1000, finite(value) ?? 1000); updateBattle({ capital, competitors: active.competitors.map((competitor) => ({ ...competitor, capital })) }); };
  const setPositionAllocation = (value) => {
    const positionAllocation = Math.max(1, finite(value) ?? 1);
    updateBattle({ positionAllocation, competitors: active.competitors.map((competitor) => ({ ...competitor, orders: competitor.orders.map((order) => ({ ...order, allocation: positionAllocation })) })) });
  };
  const setStartDate = (value) => {
    const minimum = nextTradingDate();
    const candidate = value < minimum ? minimum : value;
    const startDate = isB3TradingDate(candidate) ? candidate : nextB3TradingDate(candidate);
    updateBattle({ startDate, competitors: active.competitors.map((competitor) => ({ ...competitor, orders: competitor.orders.map((order) => ({ ...order, startDate, deadline: addMonths(startDate, active.horizonMonths) })) })) });
  };
  const setHorizon = (value) => {
    const horizonMonths = [1, 2, 3, 6, 12].includes(Number(value)) ? Number(value) : 3;
    updateBattle({ horizonMonths, competitors: active.competitors.map((competitor) => ({ ...competitor, orders: competitor.orders.map((order) => ({ ...order, deadline: addMonths(active.startDate, horizonMonths) })) })) });
  };
  const setMarketMode = (marketMode) => {
    const nextMode = marketMode === "standard" ? "standard" : "fractional";
    updateBattle({ marketMode: nextMode, competitors: active.competitors.map((competitor) => ({ ...competitor, orders: competitor.orders.map((order) => {
      const asset = assetMap.get(order.ticker) ?? { ticker: order.ticker, kind: order.assetKind };
      return { ...order, marketMode: nextMode, lotSize: lotSizeFor(asset, nextMode), maxQuantity: maxQuantityFor(asset, nextMode), displayTicker: marketSymbol(asset, nextMode) };
    }) })) });
  };

  const addOrder = (competitor) => {
    if (active.status !== "setup" || competitor.kind !== "mine") return;
    const draft = drafts[competitor.id] ?? {};
    const resolvedTicker = underlyingTicker(draft.ticker || draft.query, qualified.map((item) => item.asset));
    const row = qualifiedMap.get(resolvedTicker);
    if (!row) return setNotice("Escolha um ativo do universo qualificado.");
    if (competitor.orders.some((order) => issuerKey(assetMap.get(order.ticker)) === issuerKey(row.asset))) return setNotice("Esse emissor já está na sua carteira. Escolha outra empresa para o duelo.");
    const allocation = active.positionAllocation;
    const order = planOrder(row, allocation, active.startDate, "user", draft, active.horizonMonths, active.marketMode, active);
    if (!orderValid(order)) return setNotice(`Use stop abaixo da entrada, saída acima da entrada e capital suficiente para pelo menos um lote de ${order.lotSize}.`);
    if (allocationSum(competitor) + allocation > competitor.capital) return setNotice("A soma das ordens não pode ultrapassar o capital da disputa.");
    updateCompetitor(competitor.id, (current) => ({ ...current, orders: [...current.orders, order] }));
    setDrafts((current) => ({ ...current, [competitor.id]: {} })); setNotice("");
  };

  const autoFillModel = (competitor) => {
    if (active.status !== "setup" || competitor.kind !== "model") return;
    if (active.modelPlanFingerprint === battlePlanFingerprint(active)) return setNotice("A seleção da IA já está congelada para este plano. Altere seu plano para gerar uma nova seleção.");
    const mine = active.competitors.find((item) => item.kind === "mine");
    const userCount = mine?.orders?.length ?? 0;
    if (!userCount) return setNotice("Adicione suas posições primeiro; a IA usará sempre três ativos a mais.");
    const modelCount = modelPositionCount(userCount);
    const allocations = modelPositionAllocations(userCount, active.positionAllocation);
    const allocation = allocations[0];
    const userIssuers = new Set((mine.orders ?? []).map((order) => issuerKey(assetMap.get(order.ticker))));
    const candidates = uniqueByIssuer(qualified.filter((row) => row.score.signal === "buy" && !userIssuers.has(issuerKey(row.asset)) && finite(row.asset.price) * lotSizeFor(row.asset, active.marketMode) <= allocation)).slice(0, modelCount);
    if (candidates.length < modelCount) return setNotice(`A IA encontrou ${candidates.length} dos ${modelCount} ativos necessários com ${money(allocation)} por posição. Aumente o valor usado ou reduza suas posições.`);
    const fingerprint = battlePlanFingerprint(active); const generatedAt = new Date().toISOString();
    setBattles((current) => current.map((battle) => battle.id !== activeId ? battle : {
      ...battle, modelPlanFingerprint: fingerprint, modelGeneratedAt: generatedAt,
      audit: [...(battle.audit ?? []), { at: generatedAt, type: "model-generated", label: `IA gerada uma vez para ${fingerprint}` }],
      competitors: battle.competitors.map((item) => item.id === competitor.id ? { ...item, orders: candidates.map((row, index) => planOrder(row, allocations[index], battle.startDate, "model-deterministic", {}, battle.horizonMonths, battle.marketMode, battle)) } : item),
    })); setNotice("");
  };

  const importPortfolio = (competitor, portfolioId) => {
    if (active.status !== "setup" || competitor.kind !== "mine") return;
    const portfolio = sourcePortfolios.find((item) => item.id === portfolioId);
    const rows = uniqueByIssuer((portfolio?.holdings ?? []).map((holding) => qualifiedMap.get(holding.ticker)).filter(Boolean));
    if (!rows.length) return setNotice("Essa carteira não tem ativos no universo qualificado do duelo.");
    const allocation = active.positionAllocation;
    if (allocation * rows.length > competitor.capital) return setNotice("A carteira importada ultrapassa o capital disponível com o valor por ativo escolhido.");
    updateCompetitor(competitor.id, { orders: rows.map((row) => planOrder(row, allocation, active.startDate, `portfolio:${portfolio.id}`, {}, active.horizonMonths, active.marketMode, active)) }); setNotice("");
  };

  const deleteOrder = (competitorId, orderId) => {
    if (active.status !== "setup") return;
    updateCompetitor(competitorId, (competitor) => ({ ...competitor, orders: competitor.orders.filter((order) => order.id !== orderId) }));
  };

  const startBattle = () => {
    const mine = active.competitors.find((competitor) => competitor.kind === "mine"); const model = active.competitors.find((competitor) => competitor.kind === "model");
    if (!dataHealth.ready) return setNotice(`A disputa não pode ser travada agora: ${dataHealth.reason} Atualize os dados e tente novamente.`);
    if (!mine?.orders?.length || !model?.orders?.length) return setNotice("Monte sua carteira e gere a carteira da IA antes de iniciar.");
    if (active.modelPlanFingerprint !== battlePlanFingerprint(active)) return setNotice("Seu plano mudou depois da seleção da IA. Gere a IA novamente antes de travar.");
    if (model.orders.length !== modelPositionCount(mine.orders.length)) return setNotice("Você alterou a quantidade de posições. Gere novamente a carteira da IA para manter três ativos a mais.");
    if ([mine, model].some((competitor) => competitor.orders.some((order) => Math.abs((finite(order.allocation) ?? 0) - active.positionAllocation) > .01))) return setNotice("Todas as posições precisam usar o mesmo valor por ativo. Revise o valor e gere novamente a IA.");
    if (allocationSum(mine) > active.capital || [mine, model].some((competitor) => competitor.orders.some((order) => !orderValid(order)))) return setNotice("Revise seu orçamento, entrada, stop e alvo das duas carteiras.");
    const startDate = active.startDate > localDate() ? active.startDate : nextTradingDate(); const lockedAt = new Date().toISOString();
    const dataReferenceDate = assets.map((asset) => asset.date).filter(Boolean).sort().at(-1) ?? null;
    const dataSnapshot = { officialQuoteDate: dataHealth.officialQuoteDate, historyDate: dataHealth.historyDate, expectedDate: dataHealth.expectedDate, coveredAssets: dataHealth.covered, fingerprint: marketSnapshotFingerprint(assets, anomalies), anomalyModelVersion: anomalies?.modelVersion ?? null, source: "B3 EOD oficial" };
    updateBattle({ status: "running", startDate, lockedAt, dataReferenceDate, dataSnapshot, audit: [...(active.audit ?? []), { at: lockedAt, type: "battle-locked", label: `Planos travados · ${dataSnapshot.fingerprint}` }], competitors: active.competitors.map((competitor) => ({ ...competitor, capital: allocatedCapital(competitor), orders: competitor.orders.map((order) => ({ ...order, startDate, deadline: addMonths(startDate, active.horizonMonths), lockedAt })) })) }); setNotice("");
  };

  const manualClose = (competitor, order) => {
    if (active.status !== "running" || competitor.kind !== "mine" || order.status !== "open") return;
    const asset = assetMap.get(order.ticker); const price = finite(asset?.price);
    if (price == null) return setNotice("Preço atual indisponível para encerrar a posição.");
    updateCompetitor(competitor.id, (current) => ({ ...current, orders: current.orders.map((item) => item.id === order.id ? closeOrder(item, price, asset.date || localDate(), "DECISÃO DO USUÁRIO", active) : item) }));
  };

  const finishBattle = () => {
    if (active.status !== "running") return;
    const finishedAt = new Date().toISOString();
    const competitors = active.competitors.map((competitor) => ({ ...competitor, orders: competitor.orders.map((order) => {
      if (order.status === "waiting") return { ...order, status: "cancelled", exitReason: "FIM DA DISPUTA", updatedAt: finishedAt };
      if (order.status !== "open") return order;
      const asset = assetMap.get(order.ticker); const price = finite(asset?.intraday ? asset.officialPrice : asset?.price);
      return price == null ? order : closeOrder(order, price, asset.date || localDate(), "FIM DA DISPUTA", active);
    }) }));
    if (competitors.some((competitor) => competitor.orders.some((order) => order.status === "open"))) return setNotice("Há posição aberta sem preço atual; tente novamente quando a cotação estiver disponível.");
    const endDate = assets.map((asset) => asset.date).filter(Boolean).sort().at(-1) ?? localDate();
    updateBattle({ status: "finished", finishedAt, endDate, competitors, audit: [...(active.audit ?? []), { at: finishedAt, type: "battle-finished", label: "Disputa encerrada" }] }); setNotice("");
  };

  const exportBattle = () => {
    const blob = new Blob([JSON.stringify({ schema: "b3-score-battle-v3", exportedAt: new Date().toISOString(), battle: active }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${active.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "disputa"}.json`; link.click(); URL.revokeObjectURL(url);
  };

  if (!active) return <section className="battle-arena"><header className="battle-intro"><div><span>DISPUTA</span><h2>Você contra a IA no swing trade.</h2><p>Mesmo capital, mesmos pregões e escolhas congeladas antes do início.</p></div><button onClick={createBattle}>Criar primeira disputa</button></header></section>;

  const competitors = active.competitors.filter((competitor) => ["mine", "model"].includes(competitor.kind));
  const metricRows = competitors.map((competitor) => ({ competitor, metrics: competitorMetrics(competitor, assetMap) }));
  const equityRows = battleEquitySeries({ ...active, competitors }, assetMap, anomalies);
  const benchmarkResult = buildBattleBenchmarkSeries(benchmarkPayload, active.startDate, equityRows.map((row) => row.date));
  const chartRows = mergeBenchmarksIntoBattleRows(equityRows, benchmarkResult);
  const chartSeries = [
    ...competitors.map((competitor) => ({ id: competitor.id, name: competitor.name, kind: competitor.kind })),
    ...benchmarkResult.series.map((item) => ({ id: `benchmark-${item.id}`, name: item.name, kind: item.kind })),
  ];
  const stats = Object.fromEntries(competitors.map((competitor) => [competitor.id, equityStats(equityRows, competitor.id)]));
  const ranked = [...metricRows].sort((a, b) => (b.metrics.returnPct ?? -Infinity) - (a.metrics.returnPct ?? -Infinity));
  const leader = ranked.length === 2 && ranked[0].metrics.returnPct !== ranked[1].metrics.returnPct ? ranked[0].competitor : null;
  const draft = (competitorId) => drafts[competitorId] ?? {};
  const setDraft = (competitorId, patch) => setDrafts((current) => ({ ...current, [competitorId]: { ...(current[competitorId] ?? {}), ...patch } }));
  const searchMatches = (value) => qualified.filter((row) => matchesAssetSearch(row.asset, value, active.marketMode)).slice(0, 8);
  const selectAsset = (competitorId, row) => setDraft(competitorId, {
    query: marketSymbol(row.asset, active.marketMode), ticker: row.asset.ticker,
    plannedEntry: finite(row.asset.price)?.toFixed(2) ?? "", stop: "", target: "",
  });
  const editable = active.status === "setup";
  const userPositionCount = competitors.find((competitor) => competitor.kind === "mine")?.orders?.length ?? 0;
  const qualifiedCounts = Object.fromEntries(["stock", "unit", "fii"].map((kind) => [kind, qualified.filter((row) => row.asset.kind === kind).length]));
  const currentFingerprint = battlePlanFingerprint(active);
  const modelCurrent = Boolean(active.modelPlanFingerprint && active.modelPlanFingerprint === currentFingerprint);
  const setupStep = active.status !== "setup" ? 4 : userPositionCount === 0 ? 1 : !modelCurrent ? 2 : 3;

  return <section className="battle-arena">
    <header className="battle-intro"><div><span>VOCÊ VS IA · SWING TRADE REAL</span><h2>Seu plano contra um modelo congelado.</h2><p>Comparação prospectiva com pregões oficiais, execução simulada e trilha auditável. A decisão de comprar no mundo real continua sendo somente sua.</p></div><div className="battle-head-actions"><button onClick={exportBattle}>Baixar registro</button><button onClick={createBattle}>Nova disputa</button></div></header>
    <div className="battle-tabs">{battles.map((battle) => <button className={battle.id === activeId ? "active" : ""} key={battle.id} onClick={() => setActiveId(battle.id)}>{battle.name}</button>)}</div>

    <div className="battle-steps">{["Regras", "Seu plano", "Seleção IA", "Travado"].map((label, index) => <span key={label} className={setupStep >= index + 1 ? "active" : ""}><i>{index + 1}</i>{label}</span>)}</div>
    <section className={`battle-data-health ${dataHealth.ready ? "ready" : "stale"}`}><div><b>{dataHealth.ready ? "DADOS OFICIAIS APTOS" : "DADOS BLOQUEADOS PARA NOVA DISPUTA"}</b><span>{dataHealth.reason}</span></div><div><span>Cotação B3<b>{formatDate(dataHealth.officialQuoteDate)}</b></span><span>Histórico diário<b>{formatDate(dataHealth.historyDate)}</b></span><span>Cobertura<b>{dataHealth.covered} ativos</b></span></div></section>
    <section className="battle-setup">
      <div className="battle-setup-main"><label>Nome<input value={active.name} disabled={!editable} onChange={(event) => updateBattle({ name: event.target.value || "Disputa" })} /></label><label>Estratégia<input value="Swing Trade" disabled /></label><label>Primeiro pregão B3<input type="date" min={nextTradingDate()} value={active.startDate} disabled={!editable} onChange={(event) => setStartDate(event.target.value)} /></label><label>Seu orçamento máximo<input type="number" min="1000" step="100" value={active.capital} disabled={!editable} onChange={(event) => setCapital(event.target.value)} /></label><label>Valor repetido em cada ativo<input type="number" min="1" step="50" value={active.positionAllocation} disabled={!editable} onChange={(event) => setPositionAllocation(event.target.value)} /></label><label>Horizonte igual<select value={active.horizonMonths} disabled={!editable} onChange={(event) => setHorizon(event.target.value)}>{[1, 2, 3, 6, 12].map((months) => <option value={months} key={months}>{months} {months === 1 ? "mês" : "meses"}</option>)}</select></label><label>Mercado de ações<select value={active.marketMode} disabled={!editable} onChange={(event) => setMarketMode(event.target.value)}><option value="fractional">Fracionário · 1 a 99</option><option value="standard">Lote padrão · 100</option></select></label><label>Custos por ordem<input value={`${active.transactionCostPct}% + ${active.slippagePct}% slippage`} disabled /></label></div>
      <div className={`battle-status ${active.status}`}><b>{statusLabel(active.status)}</b><span>{active.status === "setup" ? "Planos ainda editáveis" : `Planos travados em ${new Date(active.lockedAt ?? active.finishedAt).toLocaleString("pt-BR")}`}</span></div>
      <button className="battle-delete" onClick={removeBattle}>Excluir disputa</button>
    </section>
    <div className="battle-coverage"><b>Universo qualificado</b><span>{qualifiedCounts.stock} ações · {qualifiedCounts.unit} units · {qualifiedCounts.fii} FIIs</span><small>Digite pelo código ou nome; no fracionário, ações e units aparecem com F.</small></div>
    {notice && <div className="battle-notice" role="alert">{notice}</div>}

    <section className="battle-scoreboard"><header><div><span>PLACAR OFICIAL · RETORNO SOBRE O ALOCADO</span><h3>{leader ? `${leader.name} está na frente` : "Disputa empatada"}</h3></div><small>R$ aparece como dado secundário porque a IA usa +3 ativos</small></header><div>{ranked.map(({ competitor, metrics }, index) => <article key={competitor.id} className={competitor.kind}><em>#{index + 1}</em><div><b>{competitor.name}</b><small>{competitor.kind === "mine" ? "Seu plano" : "Modelo determinístico congelado"}</small></div><strong className={metrics.returnPct >= 0 ? "positive" : "negative"}>{pct(metrics.returnPct)}</strong><span>{money(metrics.pnl)} P/L</span><small>alocado {money(metrics.allocatedCapital)} · {metrics.open} abertas · {metrics.closed} fechadas · {metrics.waiting} aguardando</small><i>Dia {pct(stats[competitor.id]?.dailyPct)} · drawdown {pct(stats[competitor.id]?.maxDrawdownPct)}</i></article>)}</div></section>

    <section className="battle-benchmarks"><header><div><span>REFERÊNCIAS OBRIGATÓRIAS</span><h3>Mercado e custo de oportunidade</h3></div><small>{!equityRows.length ? "A comparação começará no primeiro pregão" : benchmarkResult.ready ? "Mesmo início e mesmos pregões da disputa" : `Aguardando ${benchmarkResult.missing.join(" e ") || "dados oficiais"}`}</small></header><div>{benchmarkResult.series.map((benchmark) => <article className={benchmark.kind} key={benchmark.id}><div><b>{benchmark.name}</b><small>{benchmark.id === "IBOV" ? "Mercado brasileiro de ações" : "Rendimento conservador acumulado"}</small></div><strong className={benchmark.latestReturnPct == null ? "" : benchmark.latestReturnPct >= 0 ? "positive" : "negative"}>{pct(benchmark.latestReturnPct)}</strong><span>Você {pp(excessReturn(metricRows.find((row) => row.competitor.kind === "mine")?.metrics.returnPct, benchmark.latestReturnPct))}</span><span>IA {pp(excessReturn(metricRows.find((row) => row.competitor.kind === "model")?.metrics.returnPct, benchmark.latestReturnPct))}</span><small>base {formatDate(benchmark.baselineDate)} · fonte até {formatDate(benchmark.referenceDate)}</small></article>)}</div><p>Ibovespa usa a série diária oficial da B3. O CDI é composto pelas taxas diárias oficiais, sem dividir a taxa anual por mês.</p></section>

    <section className="battle-chart-card"><header><div><span>GRÁFICO DIÁRIO COMPLETO</span><h3>Você × IA × Ibovespa × CDI</h3></div><small>Mesmo intervalo; carteiras líquidas sobre o alocado</small></header><BattleDailyChart rows={chartRows} chartSeries={chartSeries} />{chartRows.length > 0 && <details><summary>Ver fechamento diário</summary><div className="battle-daily-table" style={{ "--battle-columns": chartSeries.length + 1 }}><div><b>Data</b>{chartSeries.map((item) => <b key={item.id}>{item.name}</b>)}</div>{chartRows.slice().reverse().map((row) => <div key={row.date}><span>{formatDate(row.date)}</span>{chartSeries.map((item) => <span key={item.id}>{pct(row.returns[item.id])}{item.kind === "mine" || item.kind === "model" ? ` · ${money(row.values[item.id])}` : ""}</span>)}</div>)}</div></details>}</section>

    {editable && <div className="battle-start"><div><b>1. Monte a sua carteira</b><span>2. Gere a carteira da IA</span><span>3. Inicie e congele as escolhas</span></div><button onClick={startBattle}>Iniciar disputa no próximo pregão</button></div>}
    {active.status === "running" && <div className="battle-start running"><div><b>Disputa em andamento</b><span>As ordens não podem mais ser editadas. Você pode encerrar apenas suas posições abertas.</span></div><button onClick={finishBattle}>Encerrar disputa</button></div>}

    <section className="battle-competitors">{competitors.map((competitor) => {
      const d = draft(competitor.id); const metrics = competitorMetrics(competitor, assetMap);
      return <article className={`battle-competitor ${competitor.kind}`} key={competitor.id}><header><div><h3>{competitor.name}</h3><small>{competitor.orders.length} ativos · alocado {money(allocationSum(competitor))} · resultado oficial {pct(metrics.returnPct)}</small></div><div>{editable && competitor.kind === "model" && <button disabled={modelCurrent} className={modelCurrent ? "model-current" : ""} onClick={() => autoFillModel(competitor)}>{modelCurrent ? `IA definida · ${competitor.orders.length} ativos` : `Gerar IA com ${userPositionCount ? modelPositionCount(userPositionCount) : "+3"} ativos`}</button>}{editable && sourcePortfolios.length > 0 && competitor.kind === "mine" && <select defaultValue="" onChange={(event) => event.target.value && importPortfolio(competitor, event.target.value)}><option value="">Importar carteira...</option>{sourcePortfolios.map((portfolio) => <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>)}</select>}</div></header>
        {editable && competitor.kind === "mine" && <div className="battle-order-create"><label className="battle-search-field">Ativo<div className="battle-search-wrap"><input value={d.query ?? ""} onChange={(event) => setDraft(competitor.id, { query: event.target.value.toUpperCase(), ticker: "" })} placeholder={active.marketMode === "fractional" ? "Digite PETR4F, HGLG11..." : "Digite PETR4, HGLG11..."} autoComplete="off" />{d.query && !d.ticker && searchMatches(d.query).length > 0 && <div className="battle-search-suggestions">{searchMatches(d.query).map((row) => <button type="button" key={row.asset.ticker} onClick={() => selectAsset(competitor.id, row)}><b>{marketSymbol(row.asset, active.marketMode)}</b><span>{row.asset.name}</span><em>{assetKindLabel(row.asset)} · {money(row.asset.price)} · score {row.score.score}</em></button>)}</div>}</div></label><label>Minha entrada<input type="number" min="0.01" step="0.01" value={d.plannedEntry ?? ""} onChange={(event) => setDraft(competitor.id, { plannedEntry: event.target.value })} /></label><label>Meu stop<input type="number" min="0.01" step="0.01" value={d.stop ?? ""} onChange={(event) => setDraft(competitor.id, { stop: event.target.value })} /></label><label>Minha saída<input type="number" min="0.01" step="0.01" value={d.target ?? ""} onChange={(event) => setDraft(competitor.id, { target: event.target.value })} /></label><div className="battle-common-deadline"><span>Valor por ativo</span><b>{money(active.positionAllocation)}</b></div><div className="battle-common-deadline"><span>Prazo comum</span><b>{active.horizonMonths} {active.horizonMonths === 1 ? "mês" : "meses"}</b></div><button onClick={() => addOrder(competitor)}>Adicionar</button></div>}
        <div className="battle-orders">{competitor.orders.map((order) => {
          const asset = assetMap.get(order.ticker); const current = finite(asset?.intraday ? asset.officialPrice : asset?.price);
          const currentPnl = order.status === "open" && current != null && finite(order.entryPrice) != null && finite(order.quantity) != null ? (current - order.entryPrice) * order.quantity : finite(order.pnl);
          const currentReturn = order.status === "open" && current != null && finite(order.entryPrice) != null ? (current / order.entryPrice - 1) * 100 : finite(order.returnPct);
          return <section className={`battle-order ${order.status}`} key={order.id}><div className="battle-order-main"><div><strong>{order.displayTicker ?? order.ticker}</strong><span>{order.name}</span><small>{assetKindLabel(asset ?? { kind: order.assetKind })} · lote {order.lotSize ?? 1}{order.maxQuantity ? ` · máximo ${order.maxQuantity}` : ""} · plano congelado: score {order.scoreAtPlan ?? "N/D"} · {order.signalAtPlan ?? "N/D"}</small></div><em>{order.status === "waiting" ? "AGUARDANDO ENTRADA" : order.status === "open" ? "POSIÇÃO ABERTA" : order.status === "closed" ? `ENCERRADA · ${order.exitReason}` : "CANCELADA"}</em><b className={currentReturn == null ? "" : currentReturn >= 0 ? "positive" : "negative"}>{pct(currentReturn)}</b></div><div className="battle-order-numbers"><span>Entrada planejada<b>{money(order.plannedEntry)}</b></span><span>Executada<b>{order.entryDate ? `${money(order.entryPrice)} · ${formatDate(order.entryDate)}` : "N/D"}</b></span><span>Stop<b>{money(order.stop)}</b></span><span>Saída / alvo<b>{money(order.target)}</b></span><span>Prazo comum<b>{formatDate(order.deadline)}</b></span><span>Resultado<b>{money(currentPnl)}</b></span></div>{order.qualification?.length > 0 && <p className="battle-qualification">Qualificação: {order.qualification.join(" · ")}</p>}<footer>{active.status === "running" && competitor.kind === "mine" && order.status === "open" && <button onClick={() => manualClose(competitor, order)}>Encerrar no preço atual</button>}{editable && <button className="danger-link" onClick={() => deleteOrder(competitor.id, order.id)}>Excluir plano</button>}</footer></section>;
        })}{!competitor.orders.length && <p className="battle-empty">{competitor.kind === "mine" ? "Adicione suas escolhas; todas usarão o valor por ativo escolhido." : "A IA usará três ativos a mais e repetirá integralmente o mesmo valor em cada ativo."}</p>}</div>
      </article>;
    })}</section>

    <aside className="battle-method-note"><b>Regras auditáveis</b><p>O início é prospectivo e só pode ser travado com cotação e histórico diário oficial dentro da validade. Você escolhe um único valor por ativo, repetido integralmente em todas as posições. A IA usa sempre três ativos a mais — 2 contra 5, 4 contra 7 — então o total em reais dela é maior; por isso o vencedor oficial é definido pelo retorno percentual líquido sobre o capital alocado, e o P/L em reais é secundário. Você define entrada, stop e saída; a IA calcula os próprios preços e não pode ser sorteada de novo sem mudança no seu plano. Gap executa na abertura; quando stop e alvo aparecem no mesmo candle diário, vale o stop conservador. Custos de {active.transactionCostPct}% e slippage de {active.slippagePct}% são aplicados igualmente. Depois do início, planos, versão do modelo e fotografia dos dados ficam imutáveis.</p>{active.dataSnapshot && <div className="battle-snapshot"><span>Snapshot <b>{active.dataSnapshot.fingerprint}</b></span><span>Modelo <b>{active.modelVersion}</b></span><span>B3 <b>{formatDate(active.dataSnapshot.officialQuoteDate)}</b></span></div>}{active.audit?.length > 0 && <details><summary>Trilha de auditoria ({active.audit.length})</summary>{[...active.audit].reverse().map((item, index) => <div className="battle-audit-row" key={`${item.at}-${index}`}><b>{new Date(item.at).toLocaleString("pt-BR")}</b><span>{item.label ?? item.type}</span></div>)}</details>}</aside>
  </section>;
}
