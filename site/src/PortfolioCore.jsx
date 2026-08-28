import { useEffect, useMemo, useState } from "react";
import { formatMoney, formatPercent } from "./formatters";
import { buildQuantAnalysis } from "./quant/quant-engine.js";
import { buildBuySellScore } from "./analysis/buy-sell-score.js";
import { fairValueRange } from "./opportunity-engine.js";
import { enrichTradeBenchmarks, learningCalibration, localDateKey, partsObject } from "./analysis/portfolio-learning.js";
import { assetKindLabel, lotSizeFor, marketSymbol } from "./battle-market.js";
import { mergePurchaseHolding, validatePortfolioPurchase } from "./portfolio-operations.js";
import AssetSearch from "./AssetSearch.jsx";
import "./PortfolioManager.css";

const KEY = "b3-score-portfolios-v6";
const PREVIOUS_KEYS = ["b3-score-portfolios-v5", "b3-score-portfolios-v4", "b3-score-portfolios-v3"];
const LEGACY_KEY = "b3-score-portfolio-v1";
const uid = () => `portfolio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const money = formatMoney;
const pct = (value) => value == null ? "N/D" : formatPercent(value);
const today = () => localDateKey();
const addMonths = (date, months) => { const d = new Date(`${date}T12:00:00`); d.setMonth(d.getMonth() + months); return localDateKey(d); };
const daysBetween = (start, end = today()) => start ? Math.max(0, Math.floor((new Date(`${end}T12:00:00`).getTime() - new Date(`${start}T12:00:00`).getTime()) / 86400000)) : null;
const finite = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const quantProfile = (strategy) => strategy === "swing" ? "swing_3_6m" : "long_term";

function normalize(raw) {
  if (!Array.isArray(raw?.portfolios)) return [];
  return raw.portfolios.filter((item) => item?.id && item?.name).map((item) => ({
    ...item,
    strategy: item.strategy ?? "swing",
    tickers: item.tickers ?? [],
    marketModes: item.marketModes ?? Object.fromEntries((item.tickers ?? []).map((ticker) => [ticker, "fractional"])),
    holdings: (item.holdings ?? []).map((holding) => ({ thesis: "", invalidation: "", reviewBy: holding.entryDate ? addMonths(holding.entryDate, 6) : null, fairValueAtEntry: null, entryParts: null, entryScore: null, marketMode: "fractional", displayTicker: holding.ticker, lotSize: 1, stop: null, target: null, operations: [], ...holding })),
    operations: item.operations ?? [],
    closedTrades: item.closedTrades ?? [],
    snapshots: item.snapshots ?? [],
  }));
}

function points(values) {
  if (values.length < 2) return "";
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  return values.map((value, index) => `${index / (values.length - 1) * 100},${32 - (value - min) / span * 28}`).join(" ");
}

function sequentialDrawdown(trades) {
  let equity = 100, peak = 100, maxDrawdown = 0;
  trades.forEach((trade) => {
    const ret = finite(trade.returnPct);
    if (ret == null) return;
    equity *= 1 + ret / 100;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, (equity / peak - 1) * 100);
  });
  return Math.abs(maxDrawdown);
}

function performanceMetrics(trades = []) {
  const valid = trades.filter((trade) => finite(trade.returnPct) != null);
  const wins = valid.filter((trade) => Number(trade.returnPct) > 0);
  const losses = valid.filter((trade) => Number(trade.returnPct) < 0);
  const avg = (rows, key) => rows.length ? rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0) / rows.length : null;
  const avgFinite = (rows, key) => { const vals = rows.map((row) => finite(row[key])).filter((value) => value != null); return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null; };
  const totalCost = valid.reduce((sum, trade) => sum + Number(trade.cost ?? (trade.quantity * trade.entryPrice) ?? 0), 0);
  const totalPnl = valid.reduce((sum, trade) => sum + Number(trade.pnl ?? 0), 0);
  return {
    count: valid.length,
    wins: wins.length,
    losses: losses.length,
    winRate: valid.length ? wins.length / valid.length * 100 : null,
    avgWin: avg(wins, "returnPct"),
    avgLoss: avg(losses, "returnPct"),
    avgReturn: avg(valid, "returnPct"),
    netReturn: totalCost > 0 ? totalPnl / totalCost * 100 : null,
    avgDays: avg(valid, "daysHeld"),
    payoff: wins.length && losses.length ? avg(wins, "returnPct") / Math.abs(avg(losses, "returnPct")) : null,
    maxDrawdown: sequentialDrawdown(valid),
    totalPnl,
    avgAlphaIbov: avgFinite(valid, "alphaIbov"),
    avgAlphaCdi: avgFinite(valid, "alphaCdi"),
    benchmarkedIbov: valid.filter((trade) => finite(trade.alphaIbov) != null).length,
    benchmarkedCdi: valid.filter((trade) => finite(trade.alphaCdi) != null).length,
    sampleLabel: valid.length >= 100 ? "AMOSTRA 100+" : valid.length >= 50 ? "AMOSTRA 50+" : valid.length >= 20 ? "AMOSTRA 20+" : "AMOSTRA EM FORMAÇÃO",
  };
}

function portfolioMetrics(portfolio, assets) {
  const map = new Map(assets.map((asset) => [asset.ticker, asset]));
  const strategy = portfolio.strategy ?? "swing";
  const rows = (portfolio.holdings ?? []).map((holding) => {
    const asset = map.get(holding.ticker);
    const price = Number.isFinite(asset?.price) ? asset.price : null;
    const cost = holding.quantity * holding.entryPrice;
    const value = price == null ? null : holding.quantity * price;
    const analysis = asset ? buildQuantAnalysis(asset, assets, null, quantProfile(strategy)) : null;
    const score = asset && analysis ? buildBuySellScore({ asset, analysis, strategy }) : null;
    const currentFair = asset ? fairValueRange(asset)?.base ?? null : null;
    const originalGap = holding.fairValueAtEntry && holding.entryPrice ? (holding.fairValueAtEntry / holding.entryPrice - 1) * 100 : null;
    const currentGap = currentFair && price ? (currentFair / price - 1) * 100 : null;
    const asymmetryConsumed = originalGap != null && currentGap != null ? originalGap - currentGap : null;
    const consumedRatio = originalGap != null && originalGap > 0 && asymmetryConsumed != null ? Math.max(0, Math.min(100, asymmetryConsumed / originalGap * 100)) : null;
    const reviewDue = holding.reviewBy ? today() >= holding.reviewBy : false;
    const alerts = [];
    if (score?.signal === "sell") alerts.push({ tone: "danger", text: "Modelo atual indica VENDA" });
    if (score?.signal === "unavailable") alerts.push({ tone: "info", text: "Score atual indisponível por falta de dados mínimos" });
    if (holding.entryScore != null && score?.score != null && holding.entryScore - score.score >= 15) alerts.push({ tone: "danger", text: `Score caiu ${Math.round(holding.entryScore - score.score)} pontos desde a entrada` });
    if (price != null && finite(holding.stop) != null && price <= finite(holding.stop)) alerts.push({ tone: "danger", text: `Stop de ${money(holding.stop)} atingido` });
    if (price != null && finite(holding.target) != null && price >= finite(holding.target)) alerts.push({ tone: "warning", text: `Alvo de ${money(holding.target)} atingido` });
    if (strategy === "swing" && finite(holding.stop) == null) alerts.push({ tone: "info", text: "Stop não informado" });
    if (strategy === "swing" && finite(holding.target) == null) alerts.push({ tone: "info", text: "Alvo não informado" });
    if (reviewDue) alerts.push({ tone: "danger", text: "Prazo de revisão atingido" });
    if (currentGap != null && currentGap <= 0) alerts.push({ tone: "danger", text: "Preço atingiu/superou o valor justo estimado" });
    else if (currentGap != null && currentGap <= 5) alerts.push({ tone: "warning", text: "Pouca assimetria restante até o valor justo" });
    if (consumedRatio != null && consumedRatio >= 75) alerts.push({ tone: "warning", text: `${Math.round(consumedRatio)}% da assimetria inicial consumida` });
    if (!holding.thesis?.trim() || !holding.invalidation?.trim()) alerts.push({ tone: "info", text: "Contrato da operação incompleto" });
    return { ...holding, asset, price, cost, value, pnl: value == null ? null : value - cost, returnPct: value == null || !cost ? null : (value / cost - 1) * 100, score, currentFair, originalGap, currentGap, asymmetryConsumed, consumedRatio, daysHeld: daysBetween(holding.entryDate), reviewDue, alerts };
  });
  const cost = rows.reduce((sum, row) => sum + row.cost, 0);
  const valid = rows.filter((row) => row.value != null);
  const value = valid.reduce((sum, row) => sum + row.value, 0);
  return { rows, cost, value, pnl: valid.length === rows.length ? value - cost : null, returnPct: cost > 0 && valid.length === rows.length ? (value / cost - 1) * 100 : null, coverage: rows.length ? valid.length / rows.length * 100 : 0, alerts: rows.flatMap((row) => row.alerts.map((alert) => ({ ...alert, ticker: row.ticker }))) };
}

export default function PortfolioManager({ assets = [], asOf = {} }) {
  const [portfolios, setPortfolios] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  const [operation, setOperation] = useState({ ticker: "", marketMode: "fractional", quantity: "", entryPrice: "", entryDate: today(), stop: "", target: "" });
  const [ready, setReady] = useState(false);
  const [benchmarks, setBenchmarks] = useState(null);
  const eligible = useMemo(() => assets.filter((asset) => Number.isFinite(asset.price) && asset.price > 0).sort((a, b) => a.ticker.localeCompare(b.ticker)), [assets]);
  const eligibleMap = useMemo(() => new Map(eligible.map((asset) => [asset.ticker, asset])), [eligible]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/benchmarks.json`, { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject()).then(setBenchmarks).catch(() => setBenchmarks(null));
  }, []);
  useEffect(() => {
    try {
      let saved = normalize(JSON.parse(localStorage.getItem(KEY) ?? "null"));
      if (!saved.length) {
        for (const previousKey of PREVIOUS_KEYS) {
          saved = normalize(JSON.parse(localStorage.getItem(previousKey) ?? "null"));
          if (saved.length) break;
        }
      }
      if (saved.length) { setPortfolios(saved); setActiveId(saved[0].id); }
      else {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "null");
        if (legacy?.tickers?.length) {
          const imported = { id: uid(), name: "Carteira principal", strategy: "swing", capital: legacy.capital ?? 5000, tickers: legacy.tickers, marketModes: Object.fromEntries(legacy.tickers.map((ticker) => [ticker, "fractional"])), holdings: [], operations: [], closedTrades: [], snapshots: [], createdAt: new Date().toISOString(), imported: true };
          setPortfolios([imported]); setActiveId(imported.id);
        }
      }
    } catch { localStorage.removeItem(KEY); }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) localStorage.setItem(KEY, JSON.stringify({ version: 6, portfolios })); }, [portfolios, ready]);

  const active = portfolios.find((item) => item.id === activeId) ?? null;
  const metrics = useMemo(() => active ? portfolioMetrics(active, eligible) : null, [active, eligible]);
  const selectedAsset = operation.ticker ? eligibleMap.get(operation.ticker) ?? null : null;
  const remainingCapital = Math.max(0, finite(active?.capital) - finite(metrics?.cost));
  const enrichedTrades = useMemo(() => (active?.closedTrades ?? []).map((trade) => enrichTradeBenchmarks(trade, benchmarks)), [active?.closedTrades, benchmarks]);
  const performance = useMemo(() => performanceMetrics(enrichedTrades), [enrichedTrades]);
  const calibration = useMemo(() => learningCalibration(enrichedTrades, active?.strategy ?? "swing"), [enrichedTrades, active?.strategy]);

  useEffect(() => {
    if (!ready || !active || !metrics?.rows.length || metrics.coverage < 100) return;
    const date = today();
    if (active.snapshots?.at(-1)?.date === date) return;
    setPortfolios((current) => current.map((item) => item.id !== active.id ? item : { ...item, snapshots: [...(item.snapshots ?? []), { date, value: metrics.value, cost: metrics.cost }].slice(-180) }));
  }, [ready, active?.id, active?.snapshots?.length, metrics?.value, metrics?.cost, metrics?.coverage, metrics?.rows.length]);

  const create = () => {
    const label = name.trim() || `Carteira ${portfolios.length + 1}`;
    const item = { id: uid(), name: label, strategy: "swing", capital: 5000, tickers: [], marketModes: {}, holdings: [], operations: [], closedTrades: [], snapshots: [], createdAt: new Date().toISOString() };
    setPortfolios((current) => [...current, item]); setActiveId(item.id); setName("");
  };
  useEffect(() => { setOperation({ ticker: "", marketMode: "fractional", quantity: "", entryPrice: "", entryDate: today(), stop: "", target: "" }); setNotice(""); }, [activeId]);
  const update = (patch) => setPortfolios((current) => current.map((item) => item.id === activeId ? { ...item, ...patch } : item));
  const updateHolding = (ticker, patch) => update({ holdings: active.holdings.map((holding) => holding.ticker === ticker ? { ...holding, ...patch } : holding) });
  const selectAsset = (asset, option) => {
    if (!active || !asset?.ticker) return;
    const marketMode = asset.kind === "fii" ? "standard" : option?.marketMode === "standard" ? "standard" : "fractional";
    const lotSize = lotSizeFor(asset, marketMode);
    setOperation({ ticker: asset.ticker, marketMode, quantity: String(lotSize), entryPrice: finite(asset.price)?.toFixed(2) ?? "", entryDate: today(), stop: "", target: "" });
    setNotice("");
  };
  const registerPurchase = () => {
    if (!active) return;
    const asset = selectedAsset;
    const validation = validatePortfolioPurchase({ ...operation, asset, strategy: active.strategy ?? "swing", remainingCapital });
    if (!validation.valid) return setNotice(validation.errors.join(" "));
    const strategy = active.strategy ?? "swing";
    const fair = fairValueRange(asset)?.base ?? null;
    const analysis = buildQuantAnalysis(asset, eligible, null, quantProfile(strategy));
    const score = buildBuySellScore({ asset, analysis, strategy });
    const operationRecord = { id: `operation-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type: "buy", ticker: asset.ticker, displayTicker: marketSymbol(asset, operation.marketMode), marketMode: operation.marketMode, quantity: validation.quantity, price: validation.price, date: operation.entryDate, stop: validation.stop, target: validation.target, total: validation.total, createdAt: new Date().toISOString() };
    const purchase = {
      ticker: asset.ticker, displayTicker: marketSymbol(asset, operation.marketMode), marketMode: operation.marketMode,
      lotSize: validation.lotSize, quantity: validation.quantity, entryPrice: validation.price, entryDate: operation.entryDate,
      stop: validation.stop, target: validation.target, fairValueAtEntry: fair, entryScore: score?.score ?? null,
      entrySignal: score?.label ?? null, entryParts: partsObject(score), thesis: "", invalidation: "",
      reviewBy: addMonths(operation.entryDate, strategy === "swing" ? 6 : 12), operations: [operationRecord],
    };
    const existing = active.holdings.find((holding) => holding.ticker === asset.ticker) ?? null;
    const holding = mergePurchaseHolding(existing, purchase);
    const holdings = existing ? active.holdings.map((item) => item.ticker === asset.ticker ? holding : item) : [...active.holdings, holding];
    const tickers = active.tickers.includes(asset.ticker) ? active.tickers : [...active.tickers, asset.ticker];
    update({ holdings, tickers, marketModes: { ...(active.marketModes ?? {}), [asset.ticker]: operation.marketMode }, operations: [...(active.operations ?? []), operationRecord] });
    setOperation({ ticker: "", marketMode: "fractional", quantity: "", entryPrice: "", entryDate: today(), stop: "", target: "" });
    setNotice(existing ? `Nova compra registrada. Preço médio de ${marketSymbol(asset, operation.marketMode)} recalculado.` : `Compra de ${marketSymbol(asset, operation.marketMode)} registrada com entrada, quantidade${strategy === "swing" ? ", stop e alvo" : ""}.`);
  };
  const closePosition = (row) => {
    if (!active || row.price == null) return;
    const exitDate = today();
    const trade = enrichTradeBenchmarks({
      id: `trade-${row.ticker}-${Date.now()}`,
      ticker: row.ticker,
      displayTicker: row.displayTicker ?? row.ticker,
      marketMode: row.marketMode ?? "fractional",
      lotSize: row.lotSize ?? 1,
      strategy: active.strategy ?? "swing",
      quantity: row.quantity,
      entryPrice: row.entryPrice,
      exitPrice: row.price,
      entryDate: row.entryDate,
      exitDate,
      daysHeld: daysBetween(row.entryDate, exitDate),
      cost: row.cost,
      value: row.value,
      pnl: row.pnl,
      returnPct: row.returnPct,
      entryFairValue: row.fairValueAtEntry ?? null,
      exitFairValue: row.currentFair ?? null,
      entryScore: row.entryScore ?? null,
      entrySignal: row.entrySignal ?? null,
      entryParts: row.entryParts ?? null,
      stop: row.stop ?? null,
      target: row.target ?? null,
      operations: row.operations ?? [],
      exitScore: row.score?.score ?? null,
      exitSignal: row.score?.label ?? null,
      thesis: row.thesis ?? "",
      invalidation: row.invalidation ?? "",
    }, benchmarks);
    update({ holdings: active.holdings.filter((holding) => holding.ticker !== row.ticker), tickers: active.tickers.filter((ticker) => ticker !== row.ticker), closedTrades: [...(active.closedTrades ?? []), trade] });
  };
  const remove = () => { if (!active) return; const remaining = portfolios.filter((item) => item.id !== active.id); setPortfolios(remaining); setActiveId(remaining[0]?.id ?? null); };
  const strategyName = active?.strategy === "long" ? "Longo Prazo" : active?.strategy === "dividends" ? "Dividendos" : "Swing Trade";
  const operationTotal = finite(operation.quantity) != null && finite(operation.entryPrice) != null ? finite(operation.quantity) * finite(operation.entryPrice) : null;
  const operationMarketLabel = selectedAsset ? selectedAsset.kind === "fii" ? "FII · 1 cota" : operation.marketMode === "standard" ? `${assetKindLabel(selectedAsset)} inteira · lote 100` : `${assetKindLabel(selectedAsset)} fracionada · 1 a 99` : null;
  return <section className="portfolio-manager portfolio-v6">
    <header className="portfolio-manager-head"><div><span>CARTEIRA</span><h2>Posições, teses e alertas em um só lugar.</h2><p>Veja primeiro o que exige ação. Métricas de aprendizado e histórico ficam abaixo, sem competir com as posições abertas.</p></div><div className="portfolio-create"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome da carteira" /><button onClick={create}>Nova carteira</button></div></header>

    <section className="portfolio-compare">{portfolios.length ? portfolios.map((portfolio) => { const m = portfolioMetrics(portfolio, eligible); const series = portfolio.snapshots?.map((snapshot) => snapshot.value) ?? []; return <button key={portfolio.id} className={portfolio.id === activeId ? "active" : ""} onClick={() => setActiveId(portfolio.id)}><span>{portfolio.name}</span><b>{portfolio.strategy === "long" ? "Longo Prazo" : portfolio.strategy === "dividends" ? "Dividendos" : "Swing Trade"}</b><strong>{m.cost ? pct(m.returnPct) : "Preparar"}</strong><small>{m.rows.length} aberta(s) · {portfolio.closedTrades?.length ?? 0} encerrada(s)</small><svg viewBox="0 0 100 36" preserveAspectRatio="none"><polyline points={points(series)} /></svg></button>; }) : <p>Crie sua primeira carteira para começar.</p>}</section>

    {active && <>
      {!!metrics?.alerts.length && <section className="portfolio-alert-center"><header><span>REVISAR AGORA</span><h3>Alertas da carteira</h3></header><div>{metrics.alerts.slice(0, 12).map((alert, index) => <article className={alert.tone} key={`${alert.ticker}-${alert.text}-${index}`}><b>{alert.ticker}</b><span>{alert.text}</span></article>)}</div></section>}

      <div className="portfolio-workspace"><div className="portfolio-editor"><div className="portfolio-editor-head"><div><span>CARTEIRA E OPERAÇÕES</span><h3>{active.name}</h3></div><button className="portfolio-delete" onClick={remove}>Excluir carteira</button></div><div className="portfolio-manager-controls portfolio-base-controls"><label>Nome<input value={active.name} onChange={(event) => update({ name: event.target.value || "Carteira sem nome" })} /></label><label>Estratégia<select value={active.strategy ?? "swing"} onChange={(event) => update({ strategy: event.target.value })}><option value="swing">Swing Trade</option><option value="long">Longo Prazo</option><option value="dividends">Dividendos</option></select></label><label>Orçamento total<input type="number" min="0" step="100" value={active.capital} onChange={(event) => update({ capital: Math.max(0, Number(event.target.value)) })} /></label><div className="portfolio-cash"><span>Orçamento disponível</span><b>{money(remainingCapital)}</b></div></div><section className="portfolio-operation"><header><div><span>NOVA COMPRA</span><h4>Registre o que realmente executou</h4></div><small>A cotação atual aparece apenas como sugestão e pode ser alterada.</small></header><div className="portfolio-operation-grid"><AssetSearch assets={eligible} onSelect={selectAsset} label="Ativo" placeholder="PETR4, PETR4F, HGLG11 ou nome" marketOptions limit={12} /><label>Quantidade<input type="number" min="1" step="1" value={operation.quantity} onChange={(event) => setOperation({ ...operation, quantity: event.target.value })} /></label><label>Preço de entrada<input type="number" min="0.01" step="0.01" value={operation.entryPrice} onChange={(event) => setOperation({ ...operation, entryPrice: event.target.value })} /></label><label>Data da compra<input type="date" value={operation.entryDate} onChange={(event) => setOperation({ ...operation, entryDate: event.target.value })} /></label>{active.strategy === "swing" && <><label>Stop<input type="number" min="0.01" step="0.01" value={operation.stop} onChange={(event) => setOperation({ ...operation, stop: event.target.value })} placeholder="Abaixo da entrada" /></label><label>Alvo / saída<input type="number" min="0.01" step="0.01" value={operation.target} onChange={(event) => setOperation({ ...operation, target: event.target.value })} placeholder="Acima da entrada" /></label></>}</div>{selectedAsset && <div className="portfolio-operation-preview"><div><span>Ativo escolhido</span><b>{marketSymbol(selectedAsset, operation.marketMode)}</b><small>{operationMarketLabel}</small></div><div><span>Valor da compra</span><b>{money(operationTotal)}</b><small>{operation.quantity || 0} × {money(finite(operation.entryPrice))}</small></div><div className={operationTotal > remainingCapital ? "negative" : ""}><span>Orçamento depois</span><b>{operationTotal == null ? money(remainingCapital) : money(remainingCapital - operationTotal)}</b><small>Limite: {money(active.capital)}</small></div></div>}{notice && <div className="portfolio-notice" role="status">{notice}</div>}<div className="portfolio-actions"><button className="primary" disabled={!selectedAsset} onClick={registerPurchase}>Registrar compra</button><small>Nenhum preço ou quantidade será inventado pelo aplicativo.</small></div></section></div>
      <aside className="portfolio-dashboard"><span>RESUMO</span><div className="portfolio-kpis"><article><small>Investido</small><b>{money(metrics?.cost)}</b></article><article><small>Valor atual</small><b>{metrics?.coverage === 100 ? money(metrics.value) : "N/D"}</b></article><article><small>Orçamento livre</small><b>{money(remainingCapital)}</b></article><article className={metrics?.pnl >= 0 ? "positive" : "negative"}><small>Resultado</small><b>{pct(metrics?.returnPct)}</b></article><article><small>Cobertura</small><b>{Math.round(metrics?.coverage ?? 0)}%</b></article></div><div className="portfolio-history"><h4>Evolução registrada</h4>{active.snapshots?.length > 1 ? <svg viewBox="0 0 100 42" preserveAspectRatio="none"><polyline points={points(active.snapshots.map((snapshot) => snapshot.value))} /></svg> : <p>A curva aparecerá após pelo menos duas fotografias em dias diferentes.</p>}<small>{active.snapshots?.length ?? 0} fotografia(s)</small></div><p className="portfolio-data-note">Preços: ações em {asOf.stockPriceAsOf ?? "N/D"}; FIIs em {asOf.fiiPriceAsOf ?? "N/D"}.</p></aside></div>

      <section className="position-list"><header><span>POSIÇÕES ABERTAS</span><h3>O que você possui agora</h3><p>Entrada, quantidade, stop e alvo são os valores informados por você; a cotação atual serve apenas para acompanhamento.</p></header>{metrics?.rows.length ? metrics.rows.map((row) => <article className={`position-card ${row.score?.signal ?? "unavailable"}`} key={row.ticker}><div className="position-main"><div><strong>{row.displayTicker ?? row.ticker}</strong><span>{row.asset?.name ?? "Ativo B3"} · lote {row.lotSize ?? 1}</span></div><div className="position-signal"><em>{row.score?.label ?? "NÃO AVALIÁVEL"}</em><b>{row.score?.score == null ? "N/D" : `${row.score.score}/100`}</b><small>entrada: {row.entryScore == null ? "N/D" : `${row.entryScore}/100`}</small></div></div>{row.alerts.length > 0 && <div className="position-alerts">{row.alerts.map((alert, index) => <span className={alert.tone} key={`${alert.text}-${index}`}>{alert.text}</span>)}</div>}<div className="position-numbers"><div><span>Quantidade</span><b>{row.quantity}</b></div><div><span>Preço médio</span><b>{money(row.entryPrice)}</b></div><div><span>Data da entrada</span><b>{row.entryDate ? new Date(`${row.entryDate}T12:00:00`).toLocaleDateString("pt-BR") : "N/D"}</b></div><div><span>Stop</span><b>{money(row.stop)}</b></div><div><span>Alvo / saída</span><b>{money(row.target)}</b></div><div><span>Preço atual</span><b>{money(row.price)}</b></div><div><span>Resultado</span><b className={row.returnPct == null ? "" : row.returnPct >= 0 ? "positive" : "negative"}>{pct(row.returnPct)}</b></div><div><span>Dias</span><b>{row.daysHeld ?? "N/D"}</b></div><div><span>Valor justo</span><b>{money(row.currentFair)}</b></div></div><details className="position-details"><summary>Plano, tese e revisão</summary><div className="position-contract"><label>Stop<input type="number" min="0.01" step="0.01" value={row.stop ?? ""} onChange={(event) => updateHolding(row.ticker, { stop: finite(event.target.value) })} /></label><label>Alvo / saída<input type="number" min="0.01" step="0.01" value={row.target ?? ""} onChange={(event) => updateHolding(row.ticker, { target: finite(event.target.value) })} /></label><label>Revisar até<input type="date" value={row.reviewBy ?? ""} onChange={(event) => updateHolding(row.ticker, { reviewBy: event.target.value })} /></label><label>Por que comprei?<textarea value={row.thesis ?? ""} onChange={(event) => updateHolding(row.ticker, { thesis: event.target.value })} placeholder="Ex.: lucro crescendo, desconto e catalisador..." /></label><label>O que invalida a tese?<textarea value={row.invalidation ?? ""} onChange={(event) => updateHolding(row.ticker, { invalidation: event.target.value })} placeholder="Ex.: dívida sobe, margem cai, tese regulatória muda..." /></label></div>{row.operations?.length > 0 && <div className="position-operations"><b>Compras registradas</b>{[...row.operations].reverse().map((item) => <span key={item.id}>{new Date(`${item.date}T12:00:00`).toLocaleDateString("pt-BR")} · {item.quantity} × {money(item.price)} = {money(item.total)}</span>)}</div>}</details><footer><div><span>{row.reviewDue ? "REVISÃO VENCIDA" : `Revisão: ${row.reviewBy ?? "N/D"}`}</span><b>{row.consumedRatio == null ? "Assimetria inicial N/D" : `${Math.round(row.consumedRatio)}% da assimetria consumida`}</b></div><button disabled={row.price == null} onClick={() => closePosition(row)}>Encerrar posição</button></footer></article>) : <p className="portfolio-empty-state">Registre sua primeira compra informando ativo, quantidade, preço, data, stop e alvo.</p>}</section>

      <details className="portfolio-secondary"><summary>Desempenho e aprendizado do método</summary><div className="portfolio-secondary-body"><section className="portfolio-scorecard"><header><div><span>PLACAR DO MÉTODO</span><h3>Operações encerradas</h3></div><em>{performance.sampleLabel}</em></header><div className="performance-grid"><article><span>Operações</span><b>{performance.count}</b><small>20 · 50 · 100 são marcos</small></article><article><span>Taxa de acerto</span><b>{pct(performance.winRate)}</b><small>{performance.wins} ganhos · {performance.losses} perdas</small></article><article><span>Retorno líquido</span><b className={performance.netReturn == null ? "" : performance.netReturn >= 0 ? "positive" : "negative"}>{pct(performance.netReturn)}</b><small>{money(performance.totalPnl)} realizado</small></article><article><span>Alpha vs IBOV</span><b>{pct(performance.avgAlphaIbov)}</b><small>{performance.benchmarkedIbov} comparável(is)</small></article><article><span>Alpha vs CDI</span><b>{pct(performance.avgAlphaCdi)}</b><small>{performance.benchmarkedCdi} comparável(is)</small></article><article><span>Ganho médio</span><b>{pct(performance.avgWin)}</b></article><article><span>Perda média</span><b>{pct(performance.avgLoss)}</b></article><article><span>Payoff</span><b>{performance.payoff == null ? "N/D" : `${performance.payoff.toFixed(2)}x`}</b></article><article><span>Tempo médio</span><b>{performance.avgDays == null ? "N/D" : `${Math.round(performance.avgDays)} dias`}</b></article><article><span>Drawdown</span><b>{performance.count ? pct(-performance.maxDrawdown) : "N/D"}</b></article></div><p className="performance-note">Benchmarks só aparecem quando a série cobre entrada e saída. Dados ausentes nunca viram zero.</p></section>

      <section className={`learning-panel ${calibration.ready ? "ready" : "waiting"}`}><header><div><span>CALIBRAÇÃO</span><h3>{strategyName}: aprendizado com operações reais</h3></div><em>{calibration.sample} operações úteis</em></header><div className="learning-weights">{Object.entries(calibration.weights).map(([key, value]) => <article key={key}><span>{key}</span><b>{value}%</b><small>padrão: {calibration.defaults[key]}%</small></article>)}</div><p>{calibration.message}</p>{calibration.ready && <strong>Os pesos são uma sugestão experimental. O score oficial não é alterado automaticamente.</strong>}</section>

      <section className="closed-trades"><header><span>HISTÓRICO REAL</span><h3>Operações encerradas</h3></header>{enrichedTrades.length ? <div className="closed-trade-list">{[...enrichedTrades].reverse().map((trade) => <article key={trade.id}><div><strong>{trade.displayTicker ?? trade.ticker}</strong><span>{trade.strategy === "long" ? "Longo Prazo" : trade.strategy === "dividends" ? "Dividendos" : "Swing Trade"}</span></div><div><span>Entrada</span><b>{money(trade.entryPrice)}</b></div><div><span>Saída</span><b>{money(trade.exitPrice)}</b></div><div><span>Resultado</span><b className={trade.returnPct == null ? "" : trade.returnPct >= 0 ? "positive" : "negative"}>{pct(trade.returnPct)}</b></div><div><span>vs IBOV</span><b>{pct(trade.alphaIbov)}</b></div><div><span>vs CDI</span><b>{pct(trade.alphaCdi)}</b></div><div><span>Tempo</span><b>{trade.daysHeld ?? "N/D"} dias</b></div></article>)}</div> : <p className="portfolio-empty-state">Nenhuma operação encerrada ainda.</p>}</section></div></details>
    </>}
  </section>;
}
