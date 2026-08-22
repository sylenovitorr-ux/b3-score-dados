import { useEffect, useMemo, useState } from "react";
import { formatMoney, formatPercent } from "./formatters";
import { buildQuantAnalysis } from "./quant/quant-engine.js";
import { buildBuySellScore } from "./analysis/buy-sell-score.js";
import { fairValueRange } from "./opportunity-engine.js";
import "./PortfolioManager.css";

const KEY = "b3-score-portfolios-v4";
const PREVIOUS_KEY = "b3-score-portfolios-v3";
const LEGACY_KEY = "b3-score-portfolio-v1";
const uid = () => `portfolio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const money = formatMoney;
const pct = (value) => value == null ? "N/D" : formatPercent(value);
const today = () => new Date().toISOString().slice(0, 10);
const addMonths = (date, months) => { const d = new Date(`${date}T12:00:00`); d.setMonth(d.getMonth() + months); return d.toISOString().slice(0, 10); };
const daysBetween = (start) => start ? Math.max(0, Math.floor((Date.now() - new Date(`${start}T12:00:00`).getTime()) / 86400000)) : null;

function normalize(raw) {
  if (!Array.isArray(raw?.portfolios)) return [];
  return raw.portfolios.filter((item) => item?.id && item?.name).map((item) => ({
    ...item,
    strategy: item.strategy ?? "swing",
    tickers: item.tickers ?? [],
    holdings: (item.holdings ?? []).map((holding) => ({ thesis: "", invalidation: "", reviewBy: holding.entryDate ? addMonths(holding.entryDate, 6) : null, fairValueAtEntry: null, ...holding })),
    snapshots: item.snapshots ?? [],
  }));
}

function points(values) {
  if (values.length < 2) return "";
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  return values.map((value, index) => `${index / (values.length - 1) * 100},${32 - (value - min) / span * 28}`).join(" ");
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
    return { ...holding, asset, price, cost, value, pnl: value == null ? null : value - cost, returnPct: value == null || !cost ? null : (value / cost - 1) * 100, score, currentFair, currentGap, asymmetryConsumed, daysHeld: daysBetween(holding.entryDate), reviewDue: holding.reviewBy ? today() >= holding.reviewBy : false };
  });
  const cost = rows.reduce((sum, row) => sum + row.cost, 0);
  const valid = rows.filter((row) => row.value != null);
  const value = valid.reduce((sum, row) => sum + row.value, 0);
  return { rows, cost, value, pnl: valid.length === rows.length ? value - cost : null, returnPct: cost > 0 && valid.length === rows.length ? (value / cost - 1) * 100 : null, coverage: rows.length ? valid.length / rows.length * 100 : 0 };
}

export default function PortfolioManager({ assets = [], asOf = {} }) {
  const [portfolios, setPortfolios] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [name, setName] = useState("");
  const [ready, setReady] = useState(false);
  const eligible = useMemo(() => assets.filter((asset) => Number.isFinite(asset.price) && asset.price > 0).sort((a, b) => a.ticker.localeCompare(b.ticker)), [assets]);

  useEffect(() => {
    try {
      const current = normalize(JSON.parse(localStorage.getItem(KEY) ?? "null"));
      const previous = current.length ? current : normalize(JSON.parse(localStorage.getItem(PREVIOUS_KEY) ?? "null"));
      if (previous.length) { setPortfolios(previous); setActiveId(previous[0].id); }
      else {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "null");
        if (legacy?.tickers?.length) {
          const imported = { id: uid(), name: "Carteira principal", strategy: "swing", capital: legacy.capital ?? 5000, tickers: legacy.tickers, holdings: [], snapshots: [], createdAt: new Date().toISOString(), imported: true };
          setPortfolios([imported]); setActiveId(imported.id);
        }
      }
    } catch { localStorage.removeItem(KEY); }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) localStorage.setItem(KEY, JSON.stringify({ version: 4, portfolios })); }, [portfolios, ready]);

  const active = portfolios.find((item) => item.id === activeId) ?? null;
  const metrics = useMemo(() => active ? portfolioMetrics(active, eligible) : null, [active, eligible]);
  useEffect(() => {
    if (!ready || !active || !metrics?.rows.length || metrics.coverage < 100) return;
    const date = today();
    if (active.snapshots?.at(-1)?.date === date) return;
    setPortfolios((current) => current.map((item) => item.id !== active.id ? item : { ...item, snapshots: [...(item.snapshots ?? []), { date, value: metrics.value, cost: metrics.cost }].slice(-180) }));
  }, [ready, active?.id, active?.snapshots?.length, metrics?.value, metrics?.cost, metrics?.coverage, metrics?.rows.length]);

  const create = () => {
    const label = name.trim() || `Carteira ${portfolios.length + 1}`;
    const item = { id: uid(), name: label, strategy: "swing", capital: 5000, tickers: [], holdings: [], snapshots: [], createdAt: new Date().toISOString() };
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
      return quantity > 0 ? { ticker, quantity, entryPrice: asset.price, entryDate: date, fairValueAtEntry: fair, thesis: "", invalidation: "", reviewBy: addMonths(date, active.strategy === "swing" ? 6 : 12) } : null;
    }).filter(Boolean);
    update({ holdings });
  };
  const remove = () => { if (!active) return; const remaining = portfolios.filter((item) => item.id !== active.id); setPortfolios(remaining); setActiveId(remaining[0]?.id ?? null); };

  return <section className="portfolio-manager portfolio-v4">
    <header className="portfolio-manager-head"><div><span>CARTEIRA 2.0</span><h2>Acompanhe a tese, não só o preço.</h2><p>Cada posição guarda entrada, resultado, nota atual, sinal do modelo e o contrato da operação.</p></div><div className="portfolio-create"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Swing 6M" /><button onClick={create}>+ Nova carteira</button></div></header>

    <section className="portfolio-compare">{portfolios.length ? portfolios.map((portfolio) => { const m = portfolioMetrics(portfolio, eligible); const series = portfolio.snapshots?.map((snapshot) => snapshot.value) ?? []; return <button key={portfolio.id} className={portfolio.id === activeId ? "active" : ""} onClick={() => setActiveId(portfolio.id)}><span>{portfolio.name}</span><b>{portfolio.strategy === "long" ? "Longo Prazo" : portfolio.strategy === "dividends" ? "Dividendos" : "Swing Trade"}</b><strong>{m.cost ? pct(m.returnPct) : "Preparar"}</strong><small>{m.rows.length} posição(ões)</small><svg viewBox="0 0 100 36" preserveAspectRatio="none"><polyline points={points(series)} /></svg></button>; }) : <p>Crie sua primeira carteira para começar.</p>}</section>

    {active && <>
      <div className="portfolio-workspace"><div className="portfolio-editor"><div className="portfolio-editor-head"><div><span>CONFIGURAÇÃO</span><h3>{active.name}</h3></div><button className="portfolio-delete" onClick={remove}>Excluir carteira</button></div><div className="portfolio-manager-controls"><label>Nome<input value={active.name} onChange={(event) => update({ name: event.target.value || "Carteira sem nome" })} /></label><label>Estratégia<select value={active.strategy ?? "swing"} onChange={(event) => update({ strategy: event.target.value })}><option value="swing">Swing Trade</option><option value="long">Longo Prazo</option><option value="dividends">Dividendos</option></select></label><label>Capital inicial<input type="number" min="0" step="100" value={active.capital} onChange={(event) => update({ capital: Math.max(0, Number(event.target.value)) })} /></label><label>Adicionar ativo<select value="" onChange={(event) => addTicker(event.target.value)}><option value="">Escolha...</option>{eligible.filter((asset) => !active.tickers.includes(asset.ticker)).map((asset) => <option value={asset.ticker} key={asset.ticker}>{asset.ticker} — {asset.name}</option>)}</select></label></div><div className="portfolio-tickers">{active.tickers.map((ticker) => <span key={ticker}>{ticker}<button onClick={() => removeTicker(ticker)}>×</button></span>)}</div><div className="portfolio-actions"><button className="primary" disabled={!active.tickers.length} onClick={initialize}>Registrar posições novas</button><small>Ativos já registrados não têm a entrada sobrescrita.</small></div></div>
      <aside className="portfolio-dashboard"><span>DESEMPENHO</span><div className="portfolio-kpis"><article><small>Custo</small><b>{money(metrics?.cost)}</b></article><article><small>Valor atual</small><b>{metrics?.coverage === 100 ? money(metrics.value) : "N/D"}</b></article><article className={metrics?.pnl >= 0 ? "positive" : "negative"}><small>Resultado</small><b>{pct(metrics?.returnPct)}</b></article><article><small>Cobertura</small><b>{Math.round(metrics?.coverage ?? 0)}%</b></article></div><div className="portfolio-history"><h4>Evolução registrada</h4>{active.snapshots?.length > 1 ? <svg viewBox="0 0 100 42" preserveAspectRatio="none"><polyline points={points(active.snapshots.map((snapshot) => snapshot.value))} /></svg> : <p>A curva aparecerá após pelo menos duas fotografias em dias diferentes.</p>}<small>{active.snapshots?.length ?? 0} fotografia(s)</small></div><p className="portfolio-data-note">Preços: ações em {asOf.stockPriceAsOf ?? "N/D"}; FIIs em {asOf.fiiPriceAsOf ?? "N/D"}.</p></aside></div>

      <section className="position-list"><header><span>POSIÇÕES</span><h3>Contrato da operação</h3><p>O score informa o que o modelo vê agora; a tese registra por que você entrou.</p></header>{metrics?.rows.length ? metrics.rows.map((row) => <article className={`position-card ${row.score?.signal ?? "sell"}`} key={row.ticker}><div className="position-main"><div><strong>{row.ticker}</strong><span>{row.asset?.name ?? "Ativo B3"}</span></div><div className="position-signal"><em>{row.score?.label ?? "VENDA"}</em><b>{row.score?.score == null ? "N/D" : `${row.score.score}/100`}</b></div></div><div className="position-numbers"><div><span>Preço médio</span><b>{money(row.entryPrice)}</b></div><div><span>Preço atual</span><b>{money(row.price)}</b></div><div><span>Resultado</span><b className={row.returnPct >= 0 ? "positive" : "negative"}>{pct(row.returnPct)}</b></div><div><span>Dias</span><b>{row.daysHeld ?? "N/D"}</b></div><div><span>Valor justo</span><b>{money(row.currentFair)}</b></div><div><span>Assimetria atual</span><b>{pct(row.currentGap)}</b></div></div><div className="position-contract"><label>Por que comprei?<textarea value={row.thesis ?? ""} onChange={(event) => updateHolding(row.ticker, { thesis: event.target.value })} placeholder="Ex.: lucro crescendo, desconto e catalisador..." /></label><label>O que invalida a tese?<textarea value={row.invalidation ?? ""} onChange={(event) => updateHolding(row.ticker, { invalidation: event.target.value })} placeholder="Ex.: dívida sobe, margem cai, tese regulatória muda..." /></label><label>Revisar até<input type="date" value={row.reviewBy ?? ""} onChange={(event) => updateHolding(row.ticker, { reviewBy: event.target.value })} /></label></div><footer><span>{row.reviewDue ? "REVISÃO VENCIDA" : `Revisão: ${row.reviewBy ?? "N/D"}`}</span><b>{row.asymmetryConsumed == null ? "Assimetria inicial N/D" : `Assimetria consumida: ${pct(row.asymmetryConsumed)}`}</b></footer></article>) : <p className="portfolio-empty-state">Adicione ativos e registre as posições para começar o acompanhamento.</p>}</section>
    </>}
  </section>;
}
