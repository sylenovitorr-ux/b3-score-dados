import { useEffect, useMemo, useState } from "react";
import { rebuildPortfolioHistory, historyStats } from "./portfolio-history-engine.js";
import "./PortfolioHistoryPanel.css";

const KEY = "b3-score-portfolios-v6";
const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value) => value == null ? "N/D" : `${Number(value) > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const points = (values) => { if (values.length < 2) return ""; const min = Math.min(...values), max = Math.max(...values), span = max - min || 1; return values.map((value, index) => `${index / (values.length - 1) * 100},${36 - (value - min) / span * 32}`).join(" "); };

export default function PortfolioHistoryPanel({ assets = [] }) {
  const [portfolios, setPortfolios] = useState([]); const [activeId, setActiveId] = useState(null); const [anomalies, setAnomalies] = useState(null); const [benchmarks, setBenchmarks] = useState(null);
  const reload = () => { try { const rows = JSON.parse(localStorage.getItem(KEY) || "null")?.portfolios ?? []; setPortfolios(rows); setActiveId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null); } catch { setPortfolios([]); } };
  useEffect(() => { reload(); const timer = window.setInterval(reload, 1200); return () => window.clearInterval(timer); }, []);
  useEffect(() => { fetch(`${import.meta.env.BASE_URL}data/market-anomalies.json`, { cache: "no-store" }).then((r) => r.ok ? r.json() : Promise.reject()).then(setAnomalies).catch(() => setAnomalies(null)); fetch(`${import.meta.env.BASE_URL}data/benchmarks.json`, { cache: "no-store" }).then((r) => r.ok ? r.json() : Promise.reject()).then(setBenchmarks).catch(() => setBenchmarks(null)); }, []);
  const active = portfolios.find((row) => row.id === activeId) ?? null; const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.ticker, asset])), [assets]); const history = useMemo(() => active ? rebuildPortfolioHistory(active, assetMap, anomalies, benchmarks) : null, [active, assetMap, anomalies, benchmarks]); const stats = useMemo(() => historyStats(history), [history]);
  if (!active) return null;
  return <section className="portfolio-history-rebuilt"><header><div><span>CURVA REAL POR PREGÃO</span><h3>Carteira × IBOV × CDI</h3><p>Reconstruída pelo histórico diário da B3. Não depende de você abrir o app todos os dias.</p></div><select value={activeId ?? ""} onChange={(event) => setActiveId(event.target.value)}>{portfolios.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></header><div className="portfolio-history-kpis"><article><small>Carteira</small><b>{pct(stats.returnPct)}</b><span>{money(stats.pnl)} P/L</span></article><article><small>IBOV</small><b>{pct(stats.ibov)}</b><span>alpha {pct(stats.alphaIbov)}</span></article><article><small>CDI</small><b>{pct(stats.cdi)}</b><span>alpha {pct(stats.alphaCdi)}</span></article><article><small>Drawdown</small><b>{pct(stats.maxDrawdownPct)}</b><span>{history?.rows?.length ?? 0} pregões</span></article></div>{history?.rows?.length > 1 ? <div className="portfolio-history-chart"><svg viewBox="0 0 100 40" preserveAspectRatio="none"><polyline points={points(history.rows.map((row) => row.returnPct ?? 0))} /></svg><small>{history.startDate} → {history.endDate}</small></div> : <p className="portfolio-empty-state">Ainda não há histórico diário suficiente para reconstruir esta carteira.</p>}</section>;
}
