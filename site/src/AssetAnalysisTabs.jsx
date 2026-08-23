import { useEffect, useMemo, useState } from "react";
import FinancialChart from "./FinancialChart.jsx";
import DailyHistoryPanel from "./DailyHistoryPanel.jsx";
import TradeSignalPanel from "./TradeSignalPanel.jsx";
import AssetIntelligencePanelCore from "./AssetIntelligencePanelCore.jsx";

const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const number = (value, digits = 2) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { maximumFractionDigits: digits });
const pct = (value) => value == null ? "N/D" : `${Number(value) > 0 ? "+" : ""}${number(value)}%`;

const TABS = [["overview", "Decisão"], ["chart", "Gráfico diário"], ["details", "Detalhes"]];

function Metric({ label, value, note }) {
  return <article><span>{label}</span><b>{value}</b>{note && <small>{note}</small>}</article>;
}

function FundamentalsBlock({ asset, analysis, coreProps }) {
  const f = asset.kind === "fii" ? asset.fund ?? {} : asset.fundamentals ?? {};
  const score = f?.scores?.overall;
  const rows = asset.kind === "fii" ? [
    ["Score", score == null ? "N/D" : `${Math.round(score)}/100`],
    ["P/VP", number(f.pb)], ["DY 12m", pct(f.dy12)], ["Vacância", pct(f.vacancy)],
    ["Liquidez", money(f.liquidity ?? asset.volume)], ["Segmento", f.segment ?? "N/D"],
  ] : [
    ["Score", score == null ? "N/D" : `${Math.round(score)}/100`], ["P/L", number(f.pe)],
    ["P/VP", number(f.pb)], ["ROE", pct(f.roe)], ["Margem líquida", pct(f.netMargin)],
    ["Dívida líquida/EBIT", number(f.netDebtEbit)],
  ];
  return <section className="asset-detail-block">
    <header><span>FUNDAMENTOS</span><h3>Qualidade e preço</h3></header>
    <div className="tab-metric-grid">{rows.map(([label, value]) => <Metric key={label} label={label} value={value} />)}</div>
    <div className="tab-metric-grid compact"><Metric label="Valuation" value={analysis.components?.valuation?.value == null ? "N/D" : `${Math.round(analysis.components.valuation.value)}/100`} /><Metric label="Momentum" value={analysis.components?.momentum?.value == null ? "N/D" : `${Math.round(analysis.components.momentum.value)}/100`} /><Metric label="Risco" value={analysis.components?.risk?.value == null ? "N/D" : `${Math.round(analysis.components.risk.value)}/100`} /><Metric label="Confiança" value={analysis.confidence == null ? "N/D" : `${Math.round(analysis.confidence)}/100`} /></div>
    <details className="advanced-analysis"><summary>Análise fundamentalista completa <span>⌄</span></summary><div><AssetIntelligencePanelCore {...coreProps} /></div></details>
  </section>;
}

function DividendsBlock({ asset }) {
  const f = asset.kind === "fii" ? asset.fund ?? {} : asset.fundamentals ?? {};
  const dy = asset.kind === "fii" ? f.dy12 : f.dividendYield;
  const payout = f.payout ?? f.payoutRatio ?? null;
  const events = f.dividendEvents ?? f.events ?? f.distributions ?? null;
  return <section className="asset-detail-block"><header><span>DIVIDENDOS</span><h3>Renda e sustentabilidade</h3></header><div className="tab-metric-grid"><Metric label="Dividend yield 12m" value={pct(dy)} /><Metric label="Payout" value={pct(payout)} /><Metric label="Eventos disponíveis" value={Array.isArray(events) ? events.length : "N/D"} /><Metric label="Tipo" value={asset.kind === "fii" ? "Rendimentos FII" : "Dividendos/JCP"} /></div><p className="detail-help">DY alto sozinho não significa qualidade. O app mantém campos ausentes como N/D.</p></section>;
}

function BookBlock({ asset }) {
  const book = asset?.book ?? null;
  const bestBid = book?.bestBid ?? book?.bid ?? null;
  const bestAsk = book?.bestAsk ?? book?.ask ?? null;
  const bidVolume = book?.bidVolume ?? book?.totalBidVolume ?? book?.buyVolume ?? null;
  const askVolume = book?.askVolume ?? book?.totalAskVolume ?? book?.sellVolume ?? null;
  const pressure = book?.pressure ?? book?.imbalance ?? book?.bookPressure ?? (bidVolume != null && askVolume != null && Number(bidVolume) + Number(askVolume) > 0 ? ((Number(bidVolume) - Number(askVolume)) / (Number(bidVolume) + Number(askVolume))) * 100 : null);
  const spread = bestBid != null && bestAsk != null ? Number(bestAsk) - Number(bestBid) : null;
  return <section className="asset-detail-block"><header><span>BOOK</span><h3>Livro de ofertas</h3></header>{book ? <div className="tab-metric-grid"><Metric label="Melhor compra" value={money(bestBid)} /><Metric label="Melhor venda" value={money(bestAsk)} /><Metric label="Spread" value={money(spread)} /><Metric label="Pressão" value={pressure == null ? "N/D" : `${pressure > 0 ? "+" : ""}${number(pressure, 0)}%`} /></div> : <div className="book-unavailable"><b>Book L2 sem dados reais</b><p>Sem uma fonte L2 autorizada, o app não inventa bid, ask ou pressão.</p></div>}</section>;
}

function normalizeRemoteHistory(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const timestamp = Number(row.date);
    const date = Number.isFinite(timestamp) && String(row.date).length <= 10 ? new Date(timestamp * 1000).toISOString().slice(0, 10) : String(row.date ?? "").slice(0, 10);
    const closeRaw = row.close ?? row.adjustedClose;
    const close = closeRaw == null || closeRaw === "" ? null : Number(closeRaw);
    if (!date || !Number.isFinite(close) || close <= 0) return null;
    const parse = (value) => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
    return { date, open: parse(row.open) ?? close, high: parse(row.high) ?? close, low: parse(row.low) ?? close, close, volume: parse(row.volume) };
  }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
}

function useHistoryFallback(ticker, officialSeries, active) {
  const [fallbackSeries, setFallbackSeries] = useState([]);
  const [source, setSource] = useState(null);
  const [state, setState] = useState("idle");
  useEffect(() => { setFallbackSeries([]); setSource(null); setState("idle"); }, [ticker]);
  useEffect(() => {
    if (!active || officialSeries.length >= 2 || fallbackSeries.length >= 2 || state === "loading" || state === "failed") return;
    let cancelled = false;
    const cacheKey = `b3-score-history-v2:${ticker}`;
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) ?? "null");
      if (cached && Date.now() - Number(cached.time) < 12 * 60 * 60 * 1000 && Array.isArray(cached.series) && cached.series.length >= 2) { setFallbackSeries(cached.series); setSource(cached.source ?? "cache local"); setState("ready"); return; }
    } catch { localStorage.removeItem(cacheKey); }
    setState("loading");
    const encoded = encodeURIComponent(ticker);
    const githubCache = `https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/history/${encoded}.json`;
    const brapiDirect = `https://brapi.dev/api/quote/${encoded}?range=1y&interval=1d`;
    fetch(githubCache, { cache: "no-store" }).then((r) => r.ok ? r.json() : Promise.reject()).then((p) => {
      const rows = normalizeRemoteHistory(p?.series); if (rows.length < 2) throw new Error(); return { rows, source: "GitHub cache · brapi.dev" };
    }).catch(() => fetch(brapiDirect, { cache: "no-store" }).then((r) => r.ok ? r.json() : Promise.reject()).then((p) => {
      const rows = normalizeRemoteHistory(p?.results?.[0]?.historicalDataPrice); if (rows.length < 2) throw new Error(); return { rows, source: "brapi.dev fallback" };
    })).then(({ rows, source: nextSource }) => { if (cancelled) return; setFallbackSeries(rows); setSource(nextSource); setState("ready"); try { localStorage.setItem(cacheKey, JSON.stringify({ time: Date.now(), series: rows, source: nextSource })); } catch {} }).catch(() => { if (!cancelled) setState("failed"); });
    return () => { cancelled = true; };
  }, [active, ticker, officialSeries.length, fallbackSeries.length, state]);
  return { series: officialSeries.length >= 2 ? officialSeries : fallbackSeries, source: officialSeries.length >= 2 ? "B3 COTAHIST" : source, loading: state === "loading" };
}

export default function AssetAnalysisTabs({ asset, analysis, anomaly, coreProps, strategy = "swing" }) {
  const [tab, setTab] = useState("overview");
  const book = asset?.book ?? null;
  const fair = analysis?.levels?.fair ?? null;
  const events = useMemo(() => [], []);
  const officialSeries = Array.isArray(anomaly?.series) ? anomaly.series : [];
  const history = useHistoryFallback(asset.ticker, officialSeries, tab === "chart" || tab === "details");
  const series = history.series;
  const hasSeries = series.length >= 2;
  return <div className="asset-tabs-shell premium-asset-tabs">
    <nav className="asset-tabs" role="tablist" aria-label="Análise do ativo">{TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</nav>
    <div className="asset-tab-content">
      {tab === "overview" && <TradeSignalPanel asset={asset} analysis={analysis} book={book} strategy={strategy} />}
      {tab === "chart" && <section className="tab-section"><header><span>GRÁFICO DIÁRIO</span><h2>Preço, tendência e valor por pregão</h2><p>Candles diários, volume, médias e valor justo ficam juntos para reduzir troca de telas.</p></header>{hasSeries ? <><FinancialChart series={series} fairValue={fair} events={events} ticker={asset.ticker} /><div className="tab-note"><b>Fonte: {history.source}</b></div></> : <div className="book-unavailable"><b>{history.loading ? `Carregando histórico de ${asset.ticker}…` : `Histórico indisponível para ${asset.ticker}`}</b><p>O app mantém o restante da análise sem inventar preços.</p></div>}</section>}
      {tab === "details" && <section className="asset-details-stack"><FundamentalsBlock asset={asset} analysis={analysis} coreProps={coreProps} /><DividendsBlock asset={asset} />{hasSeries && <section className="asset-detail-block"><header><span>HISTÓRICO</span><h3>Pregões recentes</h3></header><DailyHistoryPanel series={series} ticker={asset.ticker} /><small>Fonte: {history.source}</small></section>}<BookBlock asset={asset} /></section>}
    </div>
  </div>;
}
