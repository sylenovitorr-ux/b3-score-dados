import { useEffect, useMemo, useState } from "react";
import { formatMoney, formatPercent } from "./formatters";
import { buildQuantAnalysis } from "./quant/quant-engine.js";
import { buildBuySellScore } from "./analysis/buy-sell-score.js";
import { fairValueRange } from "./opportunity-engine.js";
import { enrichTradeBenchmarks, learningCalibration, localDateKey, partsObject } from "./analysis/portfolio-learning.js";
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
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

function normalize(raw) {
  if (!Array.isArray(raw?.portfolios)) return [];
  return raw.portfolios.filter((item) => item?.id && item?.name).map((item) => ({
    ...item,
    strategy: item.strategy ?? "swing",
    tickers: item.tickers ?? [],
    holdings: (item.holdings ?? []).map((holding) => ({ thesis: "", invalidation: "", reviewBy: holding.entryDate ? addMonths(holding.entryDate, 6) : null, fairValueAtEntry: null, entryParts: null, entryScore: null, ...holding })),
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
  const rows = (portfolio.holdings ?? []).map((holding) => {
    const asset = map.get(holding.ticker);
    const price = Number.isFinite(asset?.price) ? asset.price : null;
    const cost = holding.quantity * holding.entryPrice;
    const value = price == null ? null : holding.quantity * price;
    const analysis = asset ? buildQuantAnalysis(asset, assets, null, "swing_3_6m") : null;
    const score = asset && analysis ? buildBuySellScore({ asset, analysis, strategy: portfolio.strategy ?? "swing" }) : null;
    const currentFair = asset ? fairValueRange(asset)?.base ?? null : null;
    const originalGap = holding.fairValueAtEntry && holding.entryPrice ? (holding.fairValueAtEntry / holding.entryPrice - 1) * 100 : null;
    const currentGap = currentFair && price ? (currentFair / price - 1) * 100 : null;
    const asymmetryConsumed = originalGap != null && currentGap != null ? originalGap - currentGap : null;
    const consumedRatio = originalGap != null && originalGap > 0 && asymmetryConsumed != null ? Math.max(0, Math.min(100, asymmetryConsumed / originalGap * 100)) : null;
    const reviewDue = holding.reviewBy ? today() >= holding.reviewBy : false;
    const alerts = [];
    if (score?.signal === "sell") alerts.push({ tone: "danger", text: "Modelo atual indica VENDA" });
    if (holding.entryScore != null && score?.score != null && holding.entryScore - score.score >= 15) alerts.push({ tone: "danger", text: `Score caiu ${Math.round(holding.entryScore - score.score)} pontos desde a entrada` });
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
  const [ready, setReady] = useState(false);
  const [benchmarks, setBenchmarks] = useState(null);
  const eligible = useMemo(() => assets.filter((asset) => Number.isFinite(asset.price) && asset.price > 0).sort((a, b) => a.ticker.localeCompare(b.ticker)), [assets]);

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
          const imported = { id: uid(), name: "Carteira principal", strategy: "swing", capital: legacy.capital ?? 5000, tickers: legacy.tickers, holdings: [], closedTrades: [], snapshots: [], createdAt: new Date().toISOString(), imported: true };
          setPortfolios([imported]); setActiveId(imported.id);
        }
      }
    } catch { localStorage.removeItem(KEY); }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) localStorage.setItem(KEY, JSON.stringify({ version: 6, portfolios })); }, [portfolios, ready]);

  const active = portfolios.find((item) => item.id === activeId) ?? null;
  const metrics = useMemo(() => active ? portfolioMetrics(active, eligible) : null, [active, eligible]);
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
    const item = { id: uid(), name: label, strategy: "swing", capital: 5000, tickers: [], holdings: [], closedTrades: [], snapshots: [], createdAt: new Date().toISOString() };
    setPortfolios((current) => [...current, item]); setActiveId(item.id); setName("");
  };
  const update = (patch) => setPortfolios((current) => current.map((item) => item.id === activeId ? { ...item, ...patch } : item));
  const updateHolding = (ticker, patch) => update({ holdings: active.holdings.map((holding) => holding.ticker === ticker ? { ...holding, ...patch } : holding) });
  const addTicker = (ticker) => { if (active && ticker && !active.tickers.includes(ticker)) update({ tickers: [...active.tickers, ticker] }); };
  const removeTicker = (ticker) => update({ tickers: active.tickers.filter((value) => value !== ticker), holdings: active.holdings.filter((value) => value.ticker !== ticker) });
  const initialize = () => {
    if (!active?.tickers.length || !(active.capital > 0)) return;
    const target = active.capital / active.tickers.length;
    const date = today();
    const existing = new Map(active.holdings.map((holding) => [holding.ticker, holding]));
    const holdings = active.tickers.map((ticker) => {
      if (existing.has(ticker)) return existing.get(ticker);
      const asset = eligible.find((item) => item.ticker === ticker);
      const quantity = asset ? Math.floor(target / asset.price) : 0;
      const fair = asset ? fairValueRange(asset)?.base ?? null : null;
      const analysis = asset ? buildQuantAnalysis(asset, eligible, null, "swing_3_6m") : null;
      const score = asset && analysis ? buildBuySellScore({ asset, analysis, strategy: active.strategy ?? "swing" }) : null;
      return quantity > 0 ? { ticker, quantity, entryPrice: asset.price, entryDate: date, fairValueAtEntry: fair, entryScore: score?.score ?? null, entrySignal: score?.label ?? null, entryParts: partsObject(score), thesis: "", invalidation: "", reviewBy: addMonths(date, active.strategy === "swing" ? 6 : 12) } : null;
    }).filter(Boolean);
    update({ holdings });
  };
  const closePosition = (row) => {
    if (!active || row.price == null) return;
    const exitDate = today();
    const trade = enrichTradeBenchmarks({
      id: `trade-${row.ticker}-${Date.now()}`,
      ticker: row.ticker,
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
      exitScore: row.score?.score ?? null,
      exitSignal: row.score?.label ?? null,
      thesis: row.thesis ?? "",
      invalidation: row.invalidation ?? "",
    }, benchmarks);
    update({ holdings: active.holdings.filter((holding) => holding.ticker !== row.ticker), tickers: active.tickers.filter((ticker) => ticker !== row.ticker), closedTrades: [...(active.closedTrades ?? []), trade] });
  };
  const remove = () => { if (!active) return; const remaining = portfolios.filter((item) => item.id !== active.id); setPortfolios(remaining); setActiveId(remaining[0]?.id ?? null); };

  const strategyName = active?.strategy === "long" ? "Longo Prazo" : active?.strategy === "dividends" ? "Dividendos" : "Swing Trade";
  return <section className="portfolio-manager portfolio-v6">
    <header className="portfolio-manager-head"><div><span>CARTEIRA 3.0</span><h2>Acompanhe a tese, o benchmark e o aprendizado.</h2><p>Operações encerradas medem o método contra referências disponíveis e alimentam uma calibração experimental dos pesos.</p></div><div className="portfolio-create"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Swing 6M" /><button onClick={create}>+ Nova carteira</button></div></header>

    <section className="portfolio-compare">{portfolios.length ? portfolios.map((portfolio) => { const m = portfolioMetrics(portfolio, eligible); const series = portfolio.snapshots?.map((snapshot) => snapshot.value) ?? []; return <button key={portfolio.id} className={portfolio.id === activeId ? "active" : ""} onClick={() => setActiveId(portfolio.id)}><span>{portfolio.name}</span><b>{portfolio.strategy === "long" ? "Longo Prazo" : portfolio.strategy === "dividends" ? "Dividendos" : "Swing Trade"}</b><strong>{m.cost ? pct(m.returnPct) : "Preparar"}</strong><small>{m.rows.length} aberta(s) · {portfolio.closedTrades?.length ?? 0} encerrada(s)</small><svg viewBox="0 0 100 36" preserveAspectRatio="none"><polyline points={points(series)} /></svg></button>; }) : <p>Crie sua primeira carteira para começar.</p>}</section>

    {active && <>
      <section className="portfolio-scorecard"><header><div><span>PLACAR DO MÉTODO</span><h3>Desempenho das operações encerradas</h3></div><em>{performance.sampleLabel}</em></header><div className="performance-grid"><article><span>Operações</span><b>{performance.count}</b><small>20 · 50 · 100 são marcos de leitura</small></article><article><span>Taxa de acerto</span><b>{pct(performance.winRate)}</b><small>{performance.wins} ganhos · {performance.losses} perdas</small></article><article><span>Retorno líquido</span><b className={performance.netReturn >= 0 ? "positive" : "negative"}>{pct(performance.netReturn)}</b><small>{money(performance.totalPnl)} realizado</small></article><article><span>Alpha vs IBOV</span><b>{pct(performance.avgAlphaIbov)}</b><small>{performance.benchmarkedIbov} operação(ões) comparáveis</small></article><article><span>Alpha vs CDI</span><b>{pct(performance.avgAlphaCdi)}</b><small>{performance.benchmarkedCdi} operação(ões) comparáveis</small></article><article><span>Ganho médio</span><b>{pct(performance.avgWin)}</b><small>operações positivas</small></article><article><span>Perda média</span><b>{pct(performance.avgLoss)}</b><small>operações negativas</small></article><article><span>Payoff</span><b>{performance.payoff == null ? "N/D" : `${performance.payoff.toFixed(2)}x`}</b><small>ganho médio ÷ perda média</small></article><article><span>Tempo médio</span><b>{performance.avgDays == null ? "N/D" : `${Math.round(performance.avgDays)} dias`}</b><small>até o encerramento</small></article><article><span>Drawdown sequencial</span><b>{performance.count ? pct(-performance.maxDrawdown) : "N/D"}</b><small>curva das operações fechadas</small></article></div><p className="performance-note">Benchmarks só aparecem quando a série cobre entrada e saída. O placar nunca substitui dados ausentes por zero.</p></section>

      <section className={`learning-panel ${calibration.ready ? "ready" : "waiting"}`}><header><div><span>CALIBRAÇÃO DO MODELO</span><h3>{strategyName}: pesos aprendidos com operações reais</h3></div><em>{calibration.sample} operações úteis</em></header><div className="learning-weights">{Object.entries(calibration.weights).map(([key, value]) => <article key={key}><span>{key}</span><b>{value}%</b><small>padrão: {calibration.defaults[key]}%</small></article>)}</div><p>{calibration.message}</p>{calibration.ready && <strong>Os pesos acima são uma sugestão experimental. O score oficial não é alterado automaticamente.</strong>}</section>

      {!!metrics?.alerts.length && <section className="portfolio-alert-center"><header><span>ALERTAS DA CARTEIRA</span><h3>O que merece revisão agora</h3></header><div>{metrics.alerts.slice(0, 12).map((alert, index) => <article className={alert.tone} key={`${alert.ticker}-${alert.text}-${index}`}><b>{alert.ticker}</b><span>{alert.text}</span></article>)}</div></section>}

      <div className="portfolio-workspace"><div className="portfolio-editor"><div className="portfolio-editor-head"><div><span>CONFIGURAÇÃO</span><h3>{active.name}</h3></div><button className="portfolio-delete" onClick={remove}>Excluir carteira</button></div><div className="portfolio-manager-controls"><label>Nome<input value={active.name} onChange={(event) => update({ name: event.target.value || "Carteira sem nome" })} /></label><label>Estratégia<select value={active.strategy ?? "swing"} onChange={(event) => update({ strategy: event.target.value })}><option value="swing">Swing Trade</option><option value="long">Longo Prazo</option><option value="dividends">Dividendos</option></select></label><label>Capital inicial<input type="number" min="0" step="100" value={active.capital} onChange={(event) => update({ capital: Math.max(0, Number(event.target.value)) })} /></label><label>Adicionar ativo<select value="" onChange={(event) => addTicker(event.target.value)}><option value="">Escolha...</option>{eligible.filter((asset) => !active.tickers.includes(asset.ticker)).map((asset) => <option value={asset.ticker} key={asset.ticker}>{asset.ticker} — {asset.name}</option>)}</select></label></div><div className="portfolio-tickers">{active.tickers.map((ticker) => <span key={ticker}>{ticker}<button onClick={() => removeTicker(ticker)}>×</button></span>)}</div><div className="portfolio-actions"><button className="primary" disabled={!active.tickers.length} onClick={initialize}>Registrar posições novas</button><small>A entrada agora registra score e componentes para a calibração futura.</small></div></div>
      <aside className="portfolio-dashboard"><span>DESEMPENHO ABERTO</span><div className="portfolio-kpis"><article><small>Custo</small><b>{money(metrics?.cost)}</b></article><article><small>Valor atual</small><b>{metrics?.coverage === 100 ? money(metrics.value) : "N/D"}</b></article><article className={metrics?.pnl >= 0 ? "positive" : "negative"}><small>Resultado</small><b>{pct(metrics?.returnPct)}</b></article><article><small>Cobertura</small><b>{Math.round(metrics?.coverage ?? 0)}%</b></article></div><div className="portfolio-history"><h4>Evolução registrada</h4>{active.snapshots?.length > 1 ? <svg viewBox="0 0 100 42" preserveAspectRatio="none"><polyline points={points(active.snapshots.map((snapshot) => snapshot.value))} /></svg> : <p>A curva aparecerá após pelo menos duas fotografias em dias diferentes.</p>}<small>{active.snapshots?.length ?? 0} fotografia(s)</small></div><p className="portfolio-data-note">Preços: ações em {asOf.stockPriceAsOf ?? "N/D"}; FIIs em {asOf.fiiPriceAsOf ?? "N/D"}.</p></aside></div>

      <section className="position-list"><header><span>POSIÇÕES ABERTAS</span><h3>Contrato da operação</h3><p>O score atual é comparado ao score registrado na entrada para detectar deterioração.</p></header>{metrics?.rows.length ? metrics.rows.map((row) => <article className={`position-card ${row.score?.signal ?? "sell"}`} key={row.ticker}><div className="position-main"><div><strong>{row.ticker}</strong><span>{row.asset?.name ?? "Ativo B3"}</span></div><div className="position-signal"><em>{row.score?.label ?? "VENDA"}</em><b>{row.score?.score == null ? "N/D" : `${row.score.score}/100`}</b><small>entrada: {row.entryScore == null ? "N/D" : `${row.entryScore}/100`}</small></div></div>{row.alerts.length > 0 && <div className="position-alerts">{row.alerts.map((alert, index) => <span className={alert.tone} key={`${alert.text}-${index}`}>{alert.text}</span>)}</div>}<div className="position-numbers"><div><span>Preço médio</span><b>{money(row.entryPrice)}</b></div><div><span>Preço atual</span><b>{money(row.price)}</b></div><div><span>Resultado</span><b className={row.returnPct >= 0 ? "positive" : "negative"}>{pct(row.returnPct)}</b></div><div><span>Dias</span><b>{row.daysHeld ?? "N/D"}</b></div><div><span>Valor justo</span><b>{money(row.currentFair)}</b></div><div><span>Assimetria atual</span><b>{pct(row.currentGap)}</b></div></div><div className="position-contract"><label>Por que comprei?<textarea value={row.thesis ?? ""} onChange={(event) => updateHolding(row.ticker, { thesis: event.target.value })} placeholder="Ex.: lucro crescendo, desconto e catalisador..." /></label><label>O que invalida a tese?<textarea value={row.invalidation ?? ""} onChange={(event) => updateHolding(row.ticker, { invalidation: event.target.value })} placeholder="Ex.: dívida sobe, margem cai, tese regulatória muda..." /></label><label>Revisar até<input type="date" value={row.reviewBy ?? ""} onChange={(event) => updateHolding(row.ticker, { reviewBy: event.target.value })} /></label></div><footer><div><span>{row.reviewDue ? "REVISÃO VENCIDA" : `Revisão: ${row.reviewBy ?? "N/D"}`}</span><b>{row.consumedRatio == null ? "Assimetria inicial N/D" : `${Math.round(row.consumedRatio)}% da assimetria consumida`}</b></div><button disabled={row.price == null} onClick={() => closePosition(row)}>Encerrar posição</button></footer></article>) : <p className="portfolio-empty-state">Adicione ativos e registre as posições para começar o acompanhamento.</p>}</section>

      <section className="closed-trades"><header><span>HISTÓRICO REAL</span><h3>Operações encerradas</h3></header>{enrichedTrades.length ? <div className="closed-trade-list">{[...enrichedTrades].reverse().map((trade) => <article key={trade.id}><div><strong>{trade.ticker}</strong><span>{trade.strategy === "long" ? "Longo Prazo" : trade.strategy === "dividends" ? "Dividendos" : "Swing Trade"}</span></div><div><span>Entrada</span><b>{money(trade.entryPrice)}</b></div><div><span>Saída</span><b>{money(trade.exitPrice)}</b></div><div><span>Resultado</span><b className={trade.returnPct >= 0 ? "positive" : "negative"}>{pct(trade.returnPct)}</b></div><div><span>vs IBOV</span><b>{pct(trade.alphaIbov)}</b></div><div><span>vs CDI</span><b>{pct(trade.alphaCdi)}</b></div><div><span>Tempo</span><b>{trade.daysHeld ?? "N/D"} dias</b></div></article>)}</div> : <p className="portfolio-empty-state">Nenhuma operação encerrada ainda. O placar começará a aprender com o uso real.</p>}</section>
    </>}
  </section>;
}
