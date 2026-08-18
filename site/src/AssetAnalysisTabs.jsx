import { useEffect, useMemo, useState } from "react";
import FinancialChart from "./FinancialChart.jsx";
import DailyHistoryPanel from "./DailyHistoryPanel.jsx";
import TradeSignalPanel from "./TradeSignalPanel.jsx";
import AssetIntelligencePanelCore from "./AssetIntelligencePanelCore.jsx";

const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const number = (value, digits = 2) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { maximumFractionDigits: digits });
const pct = (value) => value == null ? "N/D" : `${Number(value) > 0 ? "+" : ""}${number(value)}%`;

const TABS = [
  ["overview", "Visão geral"],
  ["chart", "Gráfico"],
  ["fundamentals", "Fundamentos"],
  ["dividends", "Dividendos"],
  ["history", "Histórico"],
  ["book", "Book"],
];

function Metric({ label, value, note }) {
  return <article><span>{label}</span><b>{value}</b>{note && <small>{note}</small>}</article>;
}

function FundamentalsTab({ asset, analysis, coreProps }) {
  const f = asset.kind === "fii" ? asset.fund ?? {} : asset.fundamentals ?? {};
  const score = f?.scores?.overall;
  const rows = asset.kind === "fii" ? [
    ["Score", score == null ? "N/D" : `${Math.round(score)}/100`],
    ["P/VP", number(f.pb)],
    ["DY 12m", pct(f.dy12)],
    ["Vacância", pct(f.vacancy)],
    ["Liquidez", money(f.liquidity ?? asset.volume)],
    ["Segmento", f.segment ?? "N/D"],
  ] : [
    ["Score", score == null ? "N/D" : `${Math.round(score)}/100`],
    ["P/L", number(f.pe)],
    ["P/VP", number(f.pb)],
    ["ROE", pct(f.roe)],
    ["Margem líquida", pct(f.netMargin)],
    ["Dívida líquida/EBIT", number(f.netDebtEbit)],
  ];
  return <section className="tab-section fundamentals-tab">
    <header><span>FUNDAMENTOS ESSENCIAIS</span><h2>O que importa primeiro</h2><p>Os principais números ficam visíveis. O restante continua disponível na análise avançada.</p></header>
    <div className="tab-metric-grid">{rows.map(([label, value]) => <Metric key={label} label={label} value={value} />)}</div>
    <div className="tab-metric-grid compact"><Metric label="Valuation" value={analysis.components?.valuation?.value == null ? "N/D" : `${Math.round(analysis.components.valuation.value)}/100`} /><Metric label="Momentum" value={analysis.components?.momentum?.value == null ? "N/D" : `${Math.round(analysis.components.momentum.value)}/100`} /><Metric label="Risco" value={analysis.components?.risk?.value == null ? "N/D" : `${Math.round(analysis.components.risk.value)}/100`} /><Metric label="Confiança" value={analysis.confidence == null ? "N/D" : `${Math.round(analysis.confidence)}/100`} /></div>
    <details className="advanced-analysis"><summary>Ver análise avançada <span>⌄</span></summary><div><AssetIntelligencePanelCore {...coreProps} /></div></details>
  </section>;
}

function DividendsTab({ asset }) {
  const f = asset.kind === "fii" ? asset.fund ?? {} : asset.fundamentals ?? {};
  const dy = asset.kind === "fii" ? f.dy12 : f.dividendYield;
  const payout = f.payout ?? f.payoutRatio ?? null;
  const events = f.dividendEvents ?? f.events ?? f.distributions ?? null;
  return <section className="tab-section dividends-tab">
    <header><span>DIVIDENDOS E PROVENTOS</span><h2>Renda do ativo</h2><p>Somente dados vinculados às fontes do projeto. Campo ausente permanece como N/D.</p></header>
    <div className="tab-metric-grid"><Metric label="Dividend yield 12m" value={pct(dy)} /><Metric label="Payout" value={pct(payout)} /><Metric label="Eventos disponíveis" value={Array.isArray(events) ? events.length : "N/D"} /><Metric label="Tipo" value={asset.kind === "fii" ? "Rendimentos FII" : "Dividendos/JCP"} /></div>
    <div className="tab-note"><b>Como interpretar</b><p>DY alto sozinho não define qualidade. Compare regularidade, geração de caixa, payout e sustentabilidade antes de considerar a renda recorrente.</p></div>
  </section>;
}

function BookTab({ asset }) {
  const book = asset?.book ?? null;
  const bestBid = book?.bestBid ?? book?.bid ?? null;
  const bestAsk = book?.bestAsk ?? book?.ask ?? null;
  const bidVolume = book?.bidVolume ?? book?.totalBidVolume ?? book?.buyVolume ?? null;
  const askVolume = book?.askVolume ?? book?.totalAskVolume ?? book?.sellVolume ?? null;
  const pressure = book?.pressure ?? book?.imbalance ?? book?.bookPressure ?? (bidVolume != null && askVolume != null && Number(bidVolume) + Number(askVolume) > 0 ? ((Number(bidVolume) - Number(askVolume)) / (Number(bidVolume) + Number(askVolume))) * 100 : null);
  const spread = bestBid != null && bestAsk != null ? Number(bestAsk) - Number(bestBid) : null;
  const source = book?.source ?? asset?.bookSource ?? null;
  const status = asset?.bookStatus ?? (book ? "ATUALIZADO" : "SEM FONTE L2");
  return <section className="tab-section book-tab" id="livro-ofertas">
    <header><span>LIVRO DE OFERTAS</span><h2>Pressão compradora e vendedora</h2><p>Ordens pendentes no livro não são negócios executados.</p></header>
    {book ? <><div className="tab-metric-grid"><Metric label="Melhor compra" value={money(bestBid)} /><Metric label="Melhor venda" value={money(bestAsk)} /><Metric label="Spread" value={money(spread)} /><Metric label="Pressão" value={pressure == null ? "N/D" : `${pressure > 0 ? "+" : ""}${number(pressure, 0)}%`} /><Metric label="Volume comprador" value={number(bidVolume, 0)} /><Metric label="Volume vendedor" value={number(askVolume, 0)} /></div><div className="book-pressure-bar"><i style={{ width: `${pressure == null ? 50 : Math.max(0, Math.min(100, (Number(pressure) + 100) / 2))}%` }} /></div><div className="tab-note"><b>{status}</b><p>{source ? `Fonte: ${source}` : "Fonte L2 identificada pelo feed intradiário."}</p></div></> : <div className="book-unavailable"><b>Book L2 sem dados reais</b><p>O app está funcionando, mas a fonte intradiária atual não fornece livro de ofertas. Bid, ask, volumes e pressão permanecerão vazios até uma fonte L2 autorizada ser conectada.</p><small>Status: {status}{source ? ` • fonte: ${source}` : ""}</small></div>}
  </section>;
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
    return {
      date,
      open: parse(row.open) ?? close,
      high: parse(row.high) ?? close,
      low: parse(row.low) ?? close,
      close,
      volume: parse(row.volume),
    };
  }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
}

function useHistoryFallback(ticker, officialSeries, active) {
  const [fallbackSeries, setFallbackSeries] = useState([]);
  const [source, setSource] = useState(null);
  const [state, setState] = useState("idle");

  useEffect(() => {
    setFallbackSeries([]);
    setSource(null);
    setState("idle");
  }, [ticker]);

  useEffect(() => {
    if (!active || officialSeries.length >= 2 || fallbackSeries.length >= 2 || state === "loading" || state === "failed") return;
    let cancelled = false;
    const cacheKey = `b3-score-history-v2:${ticker}`;
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) ?? "null");
      if (cached && Date.now() - Number(cached.time) < 12 * 60 * 60 * 1000 && Array.isArray(cached.series) && cached.series.length >= 2) {
        setFallbackSeries(cached.series);
        setSource(cached.source ?? "cache local");
        setState("ready");
        return;
      }
    } catch {
      localStorage.removeItem(cacheKey);
    }

    setState("loading");
    const encoded = encodeURIComponent(ticker);
    const githubCache = `https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/history/${encoded}.json`;
    const brapiDirect = `https://brapi.dev/api/quote/${encoded}?range=1y&interval=1d`;

    fetch(githubCache, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("github history unavailable")))
      .then((payload) => {
        const rows = normalizeRemoteHistory(payload?.series);
        if (rows.length < 2) throw new Error("empty github history");
        return { rows, source: "GitHub cache · brapi.dev" };
      })
      .catch(() => fetch(brapiDirect, { cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("history unavailable")))
        .then((payload) => {
          const rows = normalizeRemoteHistory(payload?.results?.[0]?.historicalDataPrice);
          if (rows.length < 2) throw new Error("empty brapi history");
          return { rows, source: "brapi.dev fallback" };
        }))
      .then(({ rows, source: nextSource }) => {
        if (cancelled) return;
        setFallbackSeries(rows);
        setSource(nextSource);
        setState("ready");
        try {
          localStorage.setItem(cacheKey, JSON.stringify({ time: Date.now(), series: rows, source: nextSource }));
        } catch {
          // Cache local é apenas otimização.
        }
      })
      .catch(() => {
        if (!cancelled) setState("failed");
      });
    return () => { cancelled = true; };
  }, [active, ticker, officialSeries.length, fallbackSeries.length, state]);

  return {
    series: officialSeries.length >= 2 ? officialSeries : fallbackSeries,
    source: officialSeries.length >= 2 ? "B3 COTAHIST" : source,
    loading: state === "loading",
  };
}

export default function AssetAnalysisTabs({ asset, analysis, anomaly, coreProps }) {
  const [tab, setTab] = useState("overview");
  const book = asset?.book ?? null;
  const fair = analysis?.levels?.fair ?? null;
  const events = useMemo(() => [], []);
  const officialSeries = Array.isArray(anomaly?.series) ? anomaly.series : [];
  const history = useHistoryFallback(asset.ticker, officialSeries, tab === "chart" || tab === "history");
  const series = history.series;
  const hasSeries = series.length >= 2;
  return <div className="asset-tabs-shell">
    <nav className="asset-tabs" role="tablist" aria-label="Análise do ativo">{TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</nav>
    <div className="asset-tab-content">
      {tab === "overview" && <TradeSignalPanel asset={asset} analysis={analysis} book={book} />}
      {tab === "chart" && <section className="tab-section"><header><span>GRÁFICO</span><h2>Preço e tendência</h2><p>Escolha período, candles ou linha. Médias móveis ajudam a enxergar tendência sem esconder o preço.</p></header>{hasSeries ? <><FinancialChart series={series} fairValue={fair} events={events} ticker={asset.ticker} /><div className="tab-note"><b>Fonte do histórico: {history.source}</b><p>Prioridade: COTAHIST oficial. Quando a série oficial não está pronta, o app usa primeiro o cache diário do próprio GitHub e só consulta a brapi diretamente como último recurso.</p></div></> : <div className="book-unavailable"><b>{history.loading ? `Carregando histórico de ${asset.ticker}…` : `Histórico indisponível para ${asset.ticker}`}</b><p>{history.loading ? "Buscando uma série diária alternativa sem bloquear o restante da análise." : "Nenhuma série válida foi recebida. O restante da análise continua disponível sem inventar preços."}</p></div>}</section>}
      {tab === "fundamentals" && <FundamentalsTab asset={asset} analysis={analysis} coreProps={coreProps} />}
      {tab === "dividends" && <DividendsTab asset={asset} />}
      {tab === "history" && (hasSeries ? <><DailyHistoryPanel series={series} ticker={asset.ticker} /><div className="tab-note"><b>Fonte do histórico: {history.source}</b></div></> : <section className="tab-section"><div className="book-unavailable"><b>{history.loading ? "Carregando histórico diário…" : "Histórico diário indisponível"}</b><p>Sem série válida, o app não preenche datas ou preços artificialmente.</p></div></section>)}
      {tab === "book" && <BookTab asset={asset} />}
    </div>
  </div>;
}
