import { useEffect, useMemo, useState } from "react";
import { buildQuantAnalysis } from "./quant/quant-engine.js";
import { buildBuySellScore } from "./analysis/buy-sell-score.js";
import { fairValueRange } from "./opportunity-engine.js";
import { issuerKey, uniqueByIssuer } from "./issuer-key.js";
import { lotSizeFor, marketSymbol, maxQuantityFor } from "./battle-market.js";
import {
  BATTLE_MODEL_VERSION,
  DEFAULT_EXECUTION,
  addMonths,
  battleEquitySeries,
  competitorMetrics,
  finite,
  historicalTechnicalSnapshot,
  modelPositionCount,
  nextTradingDate,
  processOrder,
  replayHistoricalBattle,
} from "./battle-engine.js";
import { buildBattleBenchmarkSeries, mergeBenchmarksIntoBattleRows, excessReturn } from "./battle-benchmarks.js";
import { liveCompetitorMetrics } from "./battle-live-metrics.js";
import { processLiveOrder } from "./battle-live-execution.js";
import "./UnifiedBattleArena.css";

const KEY = "b3-score-battles-v5";
const ANOMALY_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/market-anomalies.json";
const BENCHMARK_URL = `${import.meta.env.BASE_URL}data/benchmarks.json`;
const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value) => value == null ? "N/D" : `${value > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const pp = (value) => value == null ? "N/D" : `${value > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} p.p.`;
const fmt = (date) => date ? new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR") : "N/D";
const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function latestHistoryDate(anomalies) {
  return Object.values(anomalies?.assets ?? {}).flatMap((row) => row?.series?.at(-1)?.date ?? []).sort().at(-1) ?? anomalies?.quoteDate ?? null;
}

function defaultConfig(portfolio, latest) {
  return {
    portfolioId: portfolio.id,
    mode: "live",
    startDate: nextTradingDate(),
    endDate: latest,
    horizonMonths: 3,
    marketMode: "fractional",
    positionAllocation: Math.max(1, (finite(portfolio.capital) ?? 5000) / Math.max(1, portfolio.holdings?.length ?? 1)),
  };
}

function liveRow(asset, assets) {
  if (!(finite(asset?.price) > 0)) return null;
  try {
    const analysis = buildQuantAnalysis(asset, assets, null, "swing_3_6m");
    const score = buildBuySellScore({ asset, analysis, strategy: "swing" });
    const fair = fairValueRange(asset);
    return {
      asset,
      historical: false,
      anomaly: { low20: finite(analysis?.support20 ?? analysis?.low20) },
      fair,
      score,
      gate: { pass: score?.score != null && score.score >= 55, reasons: [score?.label ?? "score atual"] },
    };
  } catch {
    return null;
  }
}

function planOrder(row, allocation, startDate, marketMode, source, overrides = {}, horizonMonths = 3) {
  const entry = finite(overrides.plannedEntry) ?? finite(row?.asset?.price);
  if (!(entry > 0)) return null;
  const support = finite(row?.anomaly?.low20);
  const fair = finite(row?.fair?.base);
  const stop = finite(overrides.stop) ?? (support > 0 && support < entry ? support : entry * 0.92);
  const target = finite(overrides.target) ?? (fair > entry ? fair : entry * 1.15);
  const asset = row.asset;
  return {
    id: uid("order"), ticker: asset.ticker, displayTicker: marketSymbol(asset, marketMode), name: asset.name,
    assetKind: asset.kind, marketMode, lotSize: lotSizeFor(asset, marketMode), maxQuantity: maxQuantityFor(asset, marketMode),
    status: "waiting", strategy: "swing", plannedEntry: entry, stop, target, allocation, startDate,
    deadline: addMonths(startDate, horizonMonths), scoreAtPlan: row?.score?.score ?? null, signalAtPlan: row?.score?.label ?? null,
    source, transactionCostPct: DEFAULT_EXECUTION.transactionCostPct, slippagePct: 0, createdAt: new Date().toISOString(),
  };
}

function buildPlan({ portfolio, config, assets, anomalies }) {
  const assetMap = new Map(assets.map((asset) => [asset.ticker, asset]));
  const holdings = portfolio.holdings ?? [];
  const allocation = finite(config.positionAllocation) ?? 1000;
  const mineRows = uniqueByIssuer(holdings.map((holding) => {
    const asset = assetMap.get(holding.ticker);
    if (!asset) return null;
    return config.mode === "historical" ? historicalTechnicalSnapshot(asset, anomalies, config.startDate) : liveRow(asset, assets);
  }).filter(Boolean));
  const mineOrders = mineRows.map((row) => {
    const holding = holdings.find((item) => item.ticker === row.asset.ticker);
    return planOrder(row, allocation, config.startDate, config.marketMode, `portfolio:${portfolio.id}`, {
      plannedEntry: config.mode === "historical" ? row.asset.price : finite(holding?.entryPrice) ?? finite(row.asset.price),
      stop: config.mode === "historical" ? null : finite(holding?.stop),
      target: config.mode === "historical" ? null : finite(holding?.target),
    }, config.horizonMonths);
  }).filter(Boolean);
  const userIssuers = new Set(mineRows.map((row) => issuerKey(row.asset)));
  const candidates = uniqueByIssuer(assets.map((asset) => config.mode === "historical" ? historicalTechnicalSnapshot(asset, anomalies, config.startDate) : liveRow(asset, assets)).filter((row) => row && row.gate?.pass && !userIssuers.has(issuerKey(row.asset)) && finite(row.asset.price) * lotSizeFor(row.asset, config.marketMode) <= allocation)).sort((a, b) => (finite(b.score?.score) ?? -1) - (finite(a.score?.score) ?? -1));
  const modelCount = modelPositionCount(mineOrders.length);
  const modelRows = candidates.slice(0, modelCount);
  const modelOrders = modelRows.map((row) => planOrder(row, allocation, config.startDate, config.marketMode, "model:auto-n-plus-2", {}, config.horizonMonths)).filter(Boolean);
  return { mineOrders, modelOrders, modelCount };
}

function metricsFor(battle, competitor, assetMap) {
  if (!competitor) return null;
  return battle?.mode === "live" && battle?.status === "running" ? liveCompetitorMetrics(competitor, assetMap) : competitorMetrics(competitor, assetMap);
}

function ScoreCard({ battle, assetMap, anomalies, benchmarks }) {
  const equity = useMemo(() => battle ? battleEquitySeries(battle, assetMap, anomalies) : [], [battle, assetMap, anomalies]);
  const benchmarkSet = useMemo(() => battle && equity.length ? buildBattleBenchmarkSeries(benchmarks, battle.startDate, equity.map((row) => row.date)) : null, [battle, equity, benchmarks]);
  const merged = useMemo(() => benchmarkSet ? mergeBenchmarksIntoBattleRows(equity, benchmarkSet) : equity, [equity, benchmarkSet]);
  const mine = battle?.competitors?.find((item) => item.kind === "mine");
  const model = battle?.competitors?.find((item) => item.kind === "model");
  const mineMetrics = metricsFor(battle, mine, assetMap);
  const modelMetrics = metricsFor(battle, model, assetMap);
  const ibov = benchmarkSet?.series?.find((item) => item.id === "IBOV")?.latestReturnPct ?? null;
  const cdi = benchmarkSet?.series?.find((item) => item.id === "CDI")?.latestReturnPct ?? null;
  const rows = [
    { key: "mine", name: "Você", value: mineMetrics?.returnPct, alphaIbov: excessReturn(mineMetrics?.returnPct, ibov), alphaCdi: excessReturn(mineMetrics?.returnPct, cdi) },
    { key: "model", name: "IA B3 Score", value: modelMetrics?.returnPct, alphaIbov: excessReturn(modelMetrics?.returnPct, ibov), alphaCdi: excessReturn(modelMetrics?.returnPct, cdi) },
    { key: "ibov", name: "Ibovespa", value: ibov, alphaIbov: null, alphaCdi: excessReturn(ibov, cdi) },
    { key: "cdi", name: "CDI", value: cdi, alphaIbov: excessReturn(cdi, ibov), alphaCdi: null },
  ].sort((a, b) => (finite(b.value) ?? -Infinity) - (finite(a.value) ?? -Infinity));
  const leader = rows.find((row) => row.value != null);
  return <>
    <section className="uba-scoreboard"><header><div><span>PLACAR {battle.mode === "live" && battle.status === "running" ? "INTRADAY" : "OFICIAL"}</span><h3>{leader ? `${leader.name} está na frente` : "Aguardando primeiro pregão"}</h3></div><small>retorno líquido sobre o valor alocado</small></header><div className="uba-score-grid">{rows.map((row, index) => <article className={row.key} key={row.key}><em>#{index + 1}</em><strong>{row.name}</strong><b>{pct(row.value)}</b><span>α IBOV {pp(row.alphaIbov)}</span><span>α CDI {pp(row.alphaCdi)}</span></article>)}</div></section>
    <section className="uba-curve"><header><span>CURVA DA DISPUTA</span><b>Você × IA × IBOV × CDI</b></header><div className="uba-day-list">{merged.slice(-12).map((row) => <div key={row.date}><span>{fmt(row.date)}</span><b>Você {pct(row.returns?.[mine?.id])}</b><b>IA {pct(row.returns?.[model?.id])}</b><small>IBOV {pct(row.returns?.["benchmark-IBOV"])}</small><small>CDI {pct(row.returns?.["benchmark-CDI"])}</small></div>)}</div></section>
  </>;
}

export default function UnifiedBattleArena({ assets = [], sourcePortfolios = [], changedTickers = [] }) {
  const [anomalies, setAnomalies] = useState(null);
  const [benchmarks, setBenchmarks] = useState(null);
  const [selectedId, setSelectedId] = useState(sourcePortfolios[0]?.id ?? null);
  const [configs, setConfigs] = useState({});
  const [battles, setBattles] = useState(() => { try { return JSON.parse(localStorage.getItem(KEY) || "null")?.battles ?? []; } catch { return []; } });
  const [notice, setNotice] = useState("");
  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.ticker, asset])), [assets]);
  const latest = useMemo(() => latestHistoryDate(anomalies), [anomalies]);
  const changedSet = useMemo(() => new Set(changedTickers), [changedTickers]);

  useEffect(() => {
    fetch(ANOMALY_URL, { cache: "no-store" }).then((r) => r.ok ? r.json() : Promise.reject()).then(setAnomalies).catch(() => setAnomalies(null));
    fetch(BENCHMARK_URL, { cache: "no-store" }).then((r) => r.ok ? r.json() : Promise.reject()).then(setBenchmarks).catch(() => setBenchmarks(null));
  }, []);
  useEffect(() => { localStorage.setItem(KEY, JSON.stringify({ version: 5, battles })); }, [battles]);
  useEffect(() => { if (!sourcePortfolios.some((row) => row.id === selectedId)) setSelectedId(sourcePortfolios[0]?.id ?? null); }, [sourcePortfolios, selectedId]);
  useEffect(() => {
    if (!latest) return;
    setConfigs((current) => {
      const next = { ...current };
      sourcePortfolios.forEach((portfolio) => { if (!next[portfolio.id]) next[portfolio.id] = defaultConfig(portfolio, latest); });
      return next;
    });
  }, [sourcePortfolios, latest]);
  useEffect(() => {
    if (!anomalies) return;
    const incremental = changedSet.size > 0;
    setBattles((current) => current.map((battle) => {
      if (battle.status !== "running" || battle.mode !== "live") return battle;
      let touched = false;
      const competitors = battle.competitors.map((competitor) => ({
        ...competitor,
        orders: competitor.orders.map((order) => {
          if (incremental && !changedSet.has(order.ticker)) return order;
          const daily = processOrder(order, battle, assetMap, anomalies);
          const live = processLiveOrder(daily, assetMap.get(order.ticker));
          if (live !== order) touched = true;
          return live;
        }),
      }));
      return touched ? { ...battle, competitors, lastIntradayUpdateAt: new Date().toISOString() } : battle;
    }));
  }, [anomalies, assetMap, changedSet]);

  const portfolio = sourcePortfolios.find((row) => row.id === selectedId) ?? null;
  const config = portfolio ? configs[portfolio.id] ?? defaultConfig(portfolio, latest) : null;
  const plan = useMemo(() => portfolio && config && anomalies ? buildPlan({ portfolio, config, assets, anomalies }) : { mineOrders: [], modelOrders: [], modelCount: 0 }, [portfolio, config, assets, anomalies]);
  const battleHistory = useMemo(() => battles.filter((row) => row.sourcePortfolioId === selectedId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))), [battles, selectedId]);
  const activeBattle = battleHistory[0] ?? null;
  const patchConfig = (patch) => portfolio && setConfigs((current) => ({ ...current, [portfolio.id]: { ...config, ...patch } }));
  const setMode = (mode) => patchConfig({ mode, startDate: mode === "live" ? nextTradingDate() : config.startDate, endDate: mode === "historical" ? (config.endDate ?? latest) : null });

  const start = () => {
    if (!portfolio || !config || !anomalies) return;
    if (!plan.mineOrders.length) return setNotice("Esta carteira ainda não tem posições válidas para disputar.");
    if (plan.modelOrders.length !== plan.modelCount) return setNotice(`A IA encontrou ${plan.modelOrders.length} de ${plan.modelCount} ativos N+2. Ajuste o valor por ativo ou o período.`);
    if (config.mode === "historical" && (!config.startDate || !config.endDate || config.endDate < config.startDate)) return setNotice("Escolha um intervalo histórico válido.");
    const battle = {
      id: uid("battle"), name: `Disputa · ${portfolio.name}`, sourcePortfolioId: portfolio.id, mode: config.mode,
      startDate: config.mode === "live" ? nextTradingDate() : config.startDate, endDate: config.mode === "historical" ? config.endDate : null,
      horizonMonths: config.horizonMonths, marketMode: config.marketMode, positionAllocation: config.positionAllocation,
      transactionCostPct: DEFAULT_EXECUTION.transactionCostPct, slippagePct: 0, status: "running", modelVersion: BATTLE_MODEL_VERSION,
      createdAt: new Date().toISOString(),
      competitors: [
        { id: uid("mine"), name: "Você", kind: "mine", capital: config.positionAllocation * plan.mineOrders.length, orders: plan.mineOrders },
        { id: uid("model"), name: "IA B3 Score", kind: "model", capital: config.positionAllocation * plan.modelOrders.length, orders: plan.modelOrders },
      ],
    };
    const result = config.mode === "historical" ? replayHistoricalBattle(battle, assetMap, anomalies) : battle;
    setBattles((current) => [...current, result]);
    setNotice("");
  };

  if (!sourcePortfolios.length) return <section className="uba-empty"><h2>Crie uma carteira primeiro.</h2><p>Toda carteira passa a ter sua própria disputa automaticamente.</p></section>;
  return <div className="uba-shell">
    <section className="uba-hero"><div><span>DISPUTA UNIFICADA</span><h2>Carteira real contra IA N+2</h2><p>A IA escolhe N+2 no início e mantém esses ativos. Durante o pregão, preço, retorno, stop, alvo e placar são atualizados sem refazer a seleção.</p></div><select value={selectedId ?? ""} onChange={(e) => setSelectedId(e.target.value)}>{sourcePortfolios.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></section>
    {portfolio && config && <>
      <section className="uba-config"><label>Modo<select value={config.mode} onChange={(e) => setMode(e.target.value)}><option value="live">Ao vivo</option><option value="historical">Replay histórico</option></select></label><label>Primeiro pregão<input type="date" max={config.mode === "historical" ? latest ?? undefined : undefined} value={config.startDate ?? ""} onChange={(e) => patchConfig({ startDate: e.target.value })} /></label>{config.mode === "historical" && <label>Último pregão<input type="date" min={config.startDate} max={latest ?? undefined} value={config.endDate ?? latest ?? ""} onChange={(e) => patchConfig({ endDate: e.target.value })} /></label>}<label>Valor por ativo<input type="number" min="1" step="50" value={config.positionAllocation} onChange={(e) => patchConfig({ positionAllocation: Math.max(1, Number(e.target.value)) })} /></label><label>Horizonte<select value={config.horizonMonths} onChange={(e) => patchConfig({ horizonMonths: Number(e.target.value) })}>{[1,2,3,6,12].map((m) => <option key={m} value={m}>{m} {m === 1 ? "mês" : "meses"}</option>)}</select></label><label>Mercado<select value={config.marketMode} onChange={(e) => patchConfig({ marketMode: e.target.value })}><option value="fractional">Fracionário</option><option value="standard">Lote padrão</option></select></label></section>
      <section className="uba-plan"><header><div><span>PLANO AUTOMÁTICO</span><h3>{plan.mineOrders.length} seus × {plan.modelCount} da IA</h3></div><small>Regra N+2 · custo 0,031% compra + 0,031% venda</small></header><div className="uba-plan-cols"><div><b>VOCÊ</b>{plan.mineOrders.map((order) => <span key={order.id}>{order.displayTicker} · {money(order.plannedEntry)}</span>)}</div><div><b>IA B3 SCORE</b>{plan.modelOrders.map((order) => <span key={order.id}>{order.displayTicker} · score {order.scoreAtPlan ?? "N/D"}</span>)}</div></div><button className="uba-start" onClick={start}>{config.mode === "historical" ? `Executar replay ${fmt(config.startDate)} → ${fmt(config.endDate)}` : `Iniciar no próximo pregão (${fmt(nextTradingDate())})`}</button>{notice && <p className="uba-notice">{notice}</p>}</section>
    </>}
    {activeBattle && <ScoreCard battle={activeBattle} assetMap={assetMap} anomalies={anomalies} benchmarks={benchmarks} />}
    {!!battleHistory.length && <section className="uba-history"><header><span>HISTÓRICO</span><h3>Disputas desta carteira</h3></header>{battleHistory.slice(0, 12).map((battle) => { const mine = battle.competitors.find((x) => x.kind === "mine"); const model = battle.competitors.find((x) => x.kind === "model"); const mm = metricsFor(battle, mine, assetMap); const im = metricsFor(battle, model, assetMap); return <article key={battle.id}><div><b>{battle.mode === "historical" ? "Replay" : "Ao vivo"}</b><small>{fmt(battle.startDate)}{battle.endDate ? ` → ${fmt(battle.endDate)}` : ""}</small></div><span>Você <b>{pct(mm?.returnPct)}</b></span><span>IA <b>{pct(im?.returnPct)}</b></span><em>{battle.status === "finished" ? "ENCERRADA" : "EM ANDAMENTO"}</em></article>; })}</section>}
  </div>;
}
