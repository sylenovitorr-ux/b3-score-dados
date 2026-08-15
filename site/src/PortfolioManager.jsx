import { useEffect, useMemo, useState } from "react";
import { formatMoney, formatPercent } from "./formatters";
import "./PortfolioManager.css";

const KEY = "b3-score-portfolios-v3";
const LEGACY_KEY = "b3-score-portfolio-v1";
const uid = () => `portfolio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const money = formatMoney;
const pct = (value) => value == null ? "N/D" : formatPercent(value);

function normalize(raw) {
  if (Array.isArray(raw?.portfolios)) return raw.portfolios.filter((item) => item?.id && item?.name).map((item) => ({ ...item, tickers: item.tickers ?? [], holdings: item.holdings ?? [], snapshots: item.snapshots ?? [] }));
  return [];
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
    return { ...holding, asset, price, cost, value, pnl: value == null ? null : value - cost };
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
      const saved = normalize(JSON.parse(localStorage.getItem(KEY) ?? "null"));
      if (saved.length) { setPortfolios(saved); setActiveId(saved[0].id); }
      else {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? "null");
        if (legacy?.tickers?.length) {
          const imported = { id: uid(), name: "Carteira principal", capital: legacy.capital ?? 5000, tickers: legacy.tickers, holdings: [], snapshots: [], createdAt: new Date().toISOString(), imported: true };
          setPortfolios([imported]); setActiveId(imported.id);
        }
      }
    } catch { localStorage.removeItem(KEY); }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) localStorage.setItem(KEY, JSON.stringify({ version: 3, portfolios })); }, [portfolios, ready]);
  const active = portfolios.find((item) => item.id === activeId) ?? null;
  const metrics = useMemo(() => active ? portfolioMetrics(active, eligible) : null, [active, eligible]);
  useEffect(() => {
    if (!ready || !active || !metrics?.rows.length || metrics.coverage < 100) return;
    const today = new Date().toISOString().slice(0, 10);
    if (active.snapshots?.at(-1)?.date === today) return;
    setPortfolios((current) => current.map((item) => item.id !== active.id ? item : { ...item, snapshots: [...(item.snapshots ?? []), { date: today, value: metrics.value, cost: metrics.cost }].slice(-180) }));
  }, [ready, active?.id, active?.snapshots?.length, metrics?.value, metrics?.cost, metrics?.coverage, metrics?.rows.length]);
  const create = () => {
    const label = name.trim() || `Carteira ${portfolios.length + 1}`;
    const item = { id: uid(), name: label, capital: 5000, tickers: [], holdings: [], snapshots: [], createdAt: new Date().toISOString() };
    setPortfolios((current) => [...current, item]); setActiveId(item.id); setName("");
  };
  const update = (patch) => setPortfolios((current) => current.map((item) => item.id === activeId ? { ...item, ...patch } : item));
  const addTicker = (ticker) => { if (active && ticker && !active.tickers.includes(ticker)) update({ tickers: [...active.tickers, ticker], holdings: [] }); };
  const removeTicker = (ticker) => update({ tickers: active.tickers.filter((value) => value !== ticker), holdings: active.holdings.filter((value) => value.ticker !== ticker) });
  const initialize = () => {
    if (!active?.tickers.length || !(active.capital > 0)) return;
    const target = active.capital / active.tickers.length;
    const holdings = active.tickers.map((ticker) => {
      const asset = eligible.find((item) => item.ticker === ticker);
      const quantity = asset ? Math.floor(target / asset.price) : 0;
      return quantity > 0 ? { ticker, quantity, entryPrice: asset.price, entryDate: new Date().toISOString().slice(0, 10) } : null;
    }).filter(Boolean);
    update({ holdings, snapshots: [] });
  };
  const remove = () => { if (!active) return; const remaining = portfolios.filter((item) => item.id !== active.id); setPortfolios(remaining); setActiveId(remaining[0]?.id ?? null); };
  return <section className="portfolio-manager"><header className="portfolio-manager-head"><div><span>CARTEIRAS</span><h2>Compare planos. Acompanhe a execução.</h2><p>Crie carteiras separadas — por estratégia, objetivo ou perfil — e registre uma fotografia diária dos preços disponíveis neste aparelho.</p></div><div className="portfolio-create"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Dividendos 2026" /><button onClick={create}>+ Nova carteira</button></div></header>
    <section className="portfolio-compare" aria-label="Comparação entre carteiras">{portfolios.length ? portfolios.map((portfolio) => { const m = portfolioMetrics(portfolio, eligible); const series = portfolio.snapshots?.map((snapshot) => snapshot.value) ?? []; return <button key={portfolio.id} className={portfolio.id === activeId ? "active" : ""} onClick={() => setActiveId(portfolio.id)}><span>{portfolio.name}</span><b>{m.holdings?.length ?? 0} posições</b><strong>{m.cost ? pct(m.returnPct) : "Preparar"}</strong><small>{series.length > 1 ? "histórico registrado" : "primeira fotografia"}</small><svg viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true"><polyline points={points(series)} /></svg></button>; }) : <p>Crie sua primeira carteira para começar.</p>}</section>
    {active && <div className="portfolio-workspace"><div className="portfolio-editor"><div className="portfolio-editor-head"><div><span>EDITANDO</span><h3>{active.name}</h3></div><button className="portfolio-delete" onClick={remove}>Excluir carteira</button></div><div className="portfolio-manager-controls"><label>Nome<input value={active.name} onChange={(event) => update({ name: event.target.value || "Carteira sem nome" })} /></label><label>Capital inicial<input type="number" min="0" step="100" value={active.capital} onChange={(event) => update({ capital: Math.max(0, Number(event.target.value)) })} /></label><label>Adicionar ativo<select value="" onChange={(event) => addTicker(event.target.value)}><option value="">Escolha...</option>{eligible.filter((asset) => !active.tickers.includes(asset.ticker)).map((asset) => <option value={asset.ticker} key={asset.ticker}>{asset.ticker} — {asset.name}</option>)}</select></label></div><div className="portfolio-tickers">{active.tickers.length ? active.tickers.map((ticker) => <span key={ticker}>{ticker}<button aria-label={`Remover ${ticker}`} onClick={() => removeTicker(ticker)}>×</button></span>) : <p>Adicione os ativos que deseja acompanhar.</p>}</div><div className="portfolio-actions"><button className="primary" disabled={!active.tickers.length} onClick={initialize}>Definir composição pelo preço atual</button><small>Isso registra quantidades inteiras e preço de entrada de hoje. Use novamente apenas se quiser rebalancear a carteira.</small></div>{active.imported && <p className="portfolio-import">Sua simulação anterior foi preservada como “Carteira principal”. Defina a composição para iniciar o acompanhamento de desempenho.</p>}</div>
      <aside className="portfolio-dashboard"><span>DESEMPENHO ATUAL</span><div className="portfolio-kpis"><article><small>Custo</small><b>{money(metrics?.cost)}</b></article><article><small>Valor atual</small><b>{metrics?.coverage === 100 ? money(metrics.value) : "N/D"}</b></article><article className={metrics?.pnl >= 0 ? "positive" : "negative"}><small>Resultado</small><b>{pct(metrics?.returnPct)}</b></article><article><small>Cobertura</small><b>{Math.round((metrics?.coverage ?? 0))}%</b></article></div><div className="portfolio-history"><h4>Evolução registrada</h4>{active.snapshots?.length > 1 ? <svg viewBox="0 0 100 42" preserveAspectRatio="none" role="img" aria-label={`Evolução de ${active.name}`}><polyline points={points(active.snapshots.map((snapshot) => snapshot.value))} /></svg> : <p>A evolução aparecerá quando houver pelo menos duas visitas em dias diferentes com preços disponíveis.</p>}<small>{active.snapshots?.length ?? 0} fotografia(s) • última: {active.snapshots?.at(-1)?.date ?? "ainda não registrada"}</small></div><p className="portfolio-data-note">Preços: ações em {asOf.stockPriceAsOf ?? "data indisponível"}; FIIs em {asOf.fiiPriceAsOf ?? "data indisponível"}. Resultados não incluem custos, impostos, proventos ou novos aportes.</p></aside></div>}
  </section>;
}
