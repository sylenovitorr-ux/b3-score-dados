import { useEffect, useMemo, useState } from "react";
import { buildModelPulse, strategyLabel } from "./analysis/model-pulse.js";
import "./usability-v3.css";
import "./terminal-v4.css";

const ANOMALY_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/market-anomalies.json";
const MODEL_PULSE_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/model-pulse.json";
const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function Delta({ value }) {
  if (value == null || value === 0) return <span className="pulse-delta neutral">sem comparação</span>;
  return <span className={`pulse-delta ${value > 0 ? "positive" : "negative"}`}>{value > 0 ? "↑" : "↓"} {Math.abs(value)} pts</span>;
}

export default function HomeHub({ assets, statusText, asOf, loading, onNavigate, onOpenAsset }) {
  const [ticker, setTicker] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [strategy, setStrategy] = useState(() => localStorage.getItem("b3-score-radar-strategy-v1") || "swing");
  const [anomalies, setAnomalies] = useState(null);
  const [officialPulse, setOfficialPulse] = useState(null);

  const matches = useMemo(() => {
    const term = ticker.trim().toUpperCase();
    return term ? assets.filter((asset) => asset.ticker.includes(term) || asset.name?.toUpperCase().includes(term)).slice(0, 6) : [];
  }, [assets, ticker]);

  useEffect(() => {
    fetch(ANOMALY_URL, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then(setAnomalies).catch(() => void 0);
    fetch(MODEL_PULSE_URL, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((payload) => payload?.history && setOfficialPulse(payload)).catch(() => void 0);
  }, []);

  useEffect(() => {
    if (!loading) return undefined;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [loading]);

  const pulse = useMemo(() => assets.length ? buildModelPulse(assets, anomalies, officialPulse) : null, [assets, anomalies, officialPulse]);
  const current = pulse?.changes?.[strategy] ?? { newBuys: [], newSells: [], movers: [], top4: [], buys: 0, sells: 0, enteredTop4: [], leftTop4: [] };
  const headlines = [...current.newBuys.slice(0, 2), ...current.newSells.slice(0, 2)];
  const fallbackHeadlines = current.movers.slice(0, 4);
  const visibleHeadlines = headlines.length ? headlines : fallbackHeadlines;

  const open = (value = ticker) => {
    const exact = assets.find((asset) => asset.ticker === value.trim().toUpperCase());
    if (exact) onOpenAsset(exact.ticker);
  };

  const openStrategy = (next) => {
    localStorage.setItem("b3-score-radar-strategy-v1", next);
    setStrategy(next);
    onNavigate("swing");
  };

  const status = loading ? `Atualizando… ${elapsedSeconds}s` : statusText;
  const stocks = assets.filter((asset) => asset.kind !== "fii").length;
  const withFundamentals = assets.filter((asset) => asset.kind !== "fii" && asset.fundamentals?.scores?.overall != null).length;
  const pulseSource = officialPulse?.referenceDate ? `Diário oficial ${officialPulse.referenceDate}` : "Memória local em formação";

  return <div className="v2-home simple-home decision-home premium-home terminal-home">
    <section className="brand-stage terminal-brand-stage">
      <div className="brand-lockup"><span className="brand-orbit" aria-hidden="true"><i /><i /><i /></span><div><b>B3 SCORE</b><small>TERMINAL DE DECISÃO</small></div></div>
      <div className="market-status-pill"><i className={loading ? "loading" : "live"} /><span>{status}</span></div>
    </section>

    <section className="terminal-overview">
      <div className="terminal-overview-copy">
        <span className="v2-kicker">O QUE MUDOU NO MODELO</span>
        <h1>Seu radar começa<br/><em>pelo que importa.</em></h1>
        <p>O B3 Score compara sinais, destaca mudanças e separa COMPRA, VENDA e dados insuficientes sem transformar ausência de informação em opinião.</p>
        <div className="terminal-strategy-tabs">
          {["swing", "long", "dividends"].map((id) => <button key={id} className={strategy === id ? "active" : ""} onClick={() => { localStorage.setItem("b3-score-radar-strategy-v1", id); setStrategy(id); }}>{strategyLabel(id)}</button>)}
        </div>
      </div>
      <aside className="terminal-market-board">
        <article><span>COMPRA agora</span><b className="positive-number">{current.buys || 0}</b></article>
        <article><span>VENDA agora</span><b className="negative-number">{current.sells || 0}</b></article>
        <article><span>Ações monitoradas</span><b>{stocks || "N/D"}</b></article>
        <article><span>Com fundamentos</span><b>{withFundamentals || "N/D"}</b></article>
        <footer>Pregão {asOf.stockPriceAsOf ?? "N/D"} · CVM {asOf.cvmFilesAsOf ?? "N/D"} · {pulseSource}</footer>
      </aside>
    </section>

    <section className="terminal-pulse">
      <header><div><span>PULSO DO MODELO · {strategyLabel(strategy).toUpperCase()}</span><h2>{pulse?.baseline ? "Memória iniciada. A próxima fotografia oficial revelará as viradas." : "Mudanças desde a fotografia anterior."}</h2></div><button onClick={() => openStrategy(strategy)}>Abrir radar →</button></header>
      {(current.enteredTop4?.length > 0 || current.leftTop4?.length > 0) && <div className="terminal-top4-events">
        {current.enteredTop4?.map((row) => <button key={`in-${row.ticker}`} className="positive" onClick={() => row.ticker && onOpenAsset(row.ticker)}>↑ {row.ticker} entrou no Top 4</button>)}
        {current.leftTop4?.map((ticker) => <span key={`out-${ticker}`} className="negative">↓ {ticker} saiu do Top 4</span>)}
      </div>}
      <div className="terminal-pulse-grid">
        {visibleHeadlines.map((row) => <button key={`${row.ticker}-${row.signal}`} className={`pulse-card ${row.signal}`} onClick={() => onOpenAsset(row.ticker)}>
          <div><strong>{row.ticker}</strong><small>{row.name}</small></div>
          <span className={`signal-balloon ${row.signal}`}>{row.signal === "buy" ? "COMPRA" : "VENDA"}</span>
          <b>{row.score}/100</b>
          <Delta value={row.delta} />
          <small>{money(row.price)}</small>
        </button>)}
        {!visibleHeadlines.length && current.top4.map((row, index) => <button key={row.ticker} className="pulse-card buy" onClick={() => onOpenAsset(row.ticker)}><div><strong>{row.ticker}</strong><small>Top #{index + 1} · {row.name}</small></div><span className="signal-balloon buy">COMPRA</span><b>{row.score}/100</b><span className="pulse-delta neutral">base atual</span><small>{money(row.price)}</small></button>)}
        {!visibleHeadlines.length && !current.top4.length && <p className="terminal-empty">Ainda não há ativos avaliáveis nesta estratégia.</p>}
      </div>
    </section>

    <section className="terminal-top4">
      <header><span>TOP 4 AGORA</span><h2>As leituras mais fortes de {strategyLabel(strategy)}.</h2></header>
      <div>{current.top4.map((row, index) => <button key={row.ticker} onClick={() => onOpenAsset(row.ticker)}><em>#{index + 1}</em><span><b>{row.ticker}</b><small>{row.name}</small></span><strong>{row.score}</strong><i>COMPRA</i></button>)}{!current.top4.length && <p>Nenhuma ação atingiu 70 pontos com dados suficientes.</p>}</div>
    </section>

    <section className="home-strategies terminal-strategies">
      <header><span>TRÊS RÉGUAS, UM MESMO TERMINAL</span><h2>Entre direto na estratégia certa.</h2></header>
      <div>
        <button onClick={() => openStrategy("swing")}><i>↗</i><b>Swing Trade</b><span>2–6 meses</span><p>Timing e momentum com filtro fundamentalista.</p></button>
        <button onClick={() => openStrategy("long")}><i>◆</i><b>Longo Prazo</b><span>Qualidade + valor</span><p>Fundamentos, crescimento, valuation e risco estrutural.</p></button>
        <button onClick={() => openStrategy("dividends")}><i>◌</i><b>Dividendos</b><span>Renda recorrente</span><p>Qualidade financeira e consistência de proventos.</p></button>
      </div>
    </section>

    <section className="simple-search premium-search terminal-search">
      <label><span>Analisar uma ação</span><div><input aria-label="Pesquisar ativo" value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} onKeyDown={(event) => event.key === "Enter" && open()} placeholder="Digite um ticker, ex.: PETR4" autoComplete="off"/><button onClick={() => open()} disabled={!assets.some((asset) => asset.ticker === ticker.trim().toUpperCase())}>Analisar</button></div></label>
      {matches.length > 0 && <div className="v2-search-results">{matches.map((asset) => <button key={asset.ticker} onClick={() => open(asset.ticker)}><b>{asset.ticker}</b><span>{asset.name}</span><em>{money(asset.price)}</em></button>)}</div>}
    </section>

    <section className="decision-home-actions premium-actions terminal-actions">
      <button className="primary" onClick={() => openStrategy(strategy)}><span><small>RADAR</small><b>Top 20 → Top 4</b><em>Abra a estratégia selecionada já no contexto certo.</em></span><strong>→</strong></button>
      <button onClick={() => onNavigate("portfolio")}><span><small>CARTEIRA</small><b>Revisões e saídas</b><em>Veja tese, deterioração de score e assimetria consumida.</em></span><strong>→</strong></button>
    </section>

    <details className="decision-home-more"><summary>Ferramentas avançadas</summary><div><button onClick={() => onNavigate("analyze")}>Análise completa</button><button onClick={() => onNavigate("compare")}>Comparar ativos</button><button onClick={() => onNavigate("methodology")}>Metodologia</button><button onClick={() => onNavigate("advanced")}>Outras ferramentas</button></div></details>
  </div>;
}
