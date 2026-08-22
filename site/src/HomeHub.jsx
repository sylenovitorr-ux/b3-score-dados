import { useEffect, useMemo, useState } from "react";
import { buildModelPulse, strategyLabel } from "./analysis/model-pulse.js";
import "./usability-v3.css";
import "./terminal-v4.css";

const ANOMALY_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/market-anomalies.json";
const MODEL_PULSE_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/model-pulse.json";
const MODEL_PERFORMANCE_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/model-performance.json";
const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value) => value == null ? "N/D" : `${Number(value) > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

function Delta({ value }) {
  if (value == null || value === 0) return <span className="delta neutral">sem comparação</span>;
  return <span className={`delta ${value > 0 ? "positive" : "negative"}`}>{value > 0 ? "+" : ""}{value} pts</span>;
}

export default function HomeHub({ assets, statusText, asOf, loading, onNavigate, onOpenAsset }) {
  const [ticker, setTicker] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [strategy, setStrategy] = useState(() => localStorage.getItem("b3-score-radar-strategy-v1") || "swing");
  const [anomalies, setAnomalies] = useState(null);
  const [officialPulse, setOfficialPulse] = useState(null);
  const [modelPerformance, setModelPerformance] = useState(null);

  const matches = useMemo(() => {
    const term = ticker.trim().toUpperCase();
    return term ? assets.filter((asset) => asset.ticker.includes(term) || asset.name?.toUpperCase().includes(term)).slice(0, 6) : [];
  }, [assets, ticker]);

  useEffect(() => {
    fetch(ANOMALY_URL, { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then(setAnomalies).catch(() => void 0);
    fetch(MODEL_PULSE_URL, { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((p) => p?.history && setOfficialPulse(p)).catch(() => void 0);
    fetch(MODEL_PERFORMANCE_URL, { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((p) => p?.strategies && setModelPerformance(p)).catch(() => void 0);
  }, []);

  useEffect(() => {
    if (!loading) return undefined;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [loading]);

  const pulse = useMemo(() => assets.length ? buildModelPulse(assets, anomalies, officialPulse) : null, [assets, anomalies, officialPulse]);
  const current = pulse?.changes?.[strategy] ?? { newBuys: [], newSells: [], movers: [], top4: [], buys: 0, sells: 0, enteredTop4: [], leftTop4: [] };
  const evaluated = current.buys + current.sells;
  const eventRows = [
    ...current.newBuys.slice(0, 2).map((row) => ({ ...row, eventLabel: "Virou COMPRA" })),
    ...current.newSells.slice(0, 2).map((row) => ({ ...row, eventLabel: "Virou VENDA" })),
  ];
  const visibleChanges = eventRows.length ? eventRows : current.movers.slice(0, 4).map((row) => ({ ...row, eventLabel: "Score mudou" }));
  const validation = modelPerformance?.strategies?.[strategy] ?? {};
  const validationRows = [20, 60, 120].map((sessions) => ({ sessions, ...(validation[`${sessions}s`] ?? {}) }));

  const open = (value = ticker) => {
    const exact = assets.find((asset) => asset.ticker === value.trim().toUpperCase());
    if (exact) onOpenAsset(exact.ticker);
  };
  const selectStrategy = (next) => {
    localStorage.setItem("b3-score-radar-strategy-v1", next);
    setStrategy(next);
  };
  const openStrategy = (next) => {
    selectStrategy(next);
    onNavigate("swing");
  };

  const status = loading ? `Atualizando ${elapsedSeconds}s` : statusText;
  const stocks = assets.filter((asset) => asset.kind !== "fii").length;
  const pulseSource = officialPulse?.referenceDate ? `Diário ${officialPulse.referenceDate}` : "Memória local";

  return <div className="v2-home clean-home">
    <section className="clean-home-topbar">
      <div className="clean-brand"><b>B3 SCORE</b><span>Radar inteligente de ações</span></div>
      <div className="clean-status"><span>{status}</span><small>{pulseSource}</small></div>
    </section>

    <section className="clean-search-hero">
      <div>
        <span className="section-kicker">VISÃO DO DIA</span>
        <h1>Encontre rapidamente o que merece atenção.</h1>
        <p>O modelo organiza COMPRA, VENDA e N/D sem transformar ausência de informação em opinião.</p>
      </div>
      <div className="hero-search-box">
        <label>Buscar ação</label>
        <div><input aria-label="Pesquisar ativo" value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} onKeyDown={(event) => event.key === "Enter" && open()} placeholder="PETR4" autoComplete="off"/><button onClick={() => open()} disabled={!assets.some((asset) => asset.ticker === ticker.trim().toUpperCase())}>Abrir análise</button></div>
        {matches.length > 0 && <div className="v2-search-results">{matches.map((asset) => <button key={asset.ticker} onClick={() => open(asset.ticker)}><b>{asset.ticker}</b><span>{asset.name}</span><em>{money(asset.price)}</em></button>)}</div>}
      </div>
    </section>

    <nav className="clean-strategy-tabs" aria-label="Estratégia">
      {["swing", "long", "dividends"].map((id) => <button key={id} className={strategy === id ? "active" : ""} onClick={() => selectStrategy(id)}>{strategyLabel(id)}</button>)}
    </nav>

    <section className="market-summary-strip">
      <article><span>Pregão</span><b>{asOf.stockPriceAsOf ?? "N/D"}</b></article>
      <article><span>Ações avaliadas</span><b>{evaluated || "N/D"}</b></article>
      <article className="buy"><span>COMPRA</span><b>{current.buys || 0}</b></article>
      <article className="sell"><span>VENDA</span><b>{current.sells || 0}</b></article>
      <article><span>Universo</span><b>{stocks || "N/D"}</b></article>
      <article><span>Fundamentos</span><b>{asOf.cvmFilesAsOf ?? "N/D"}</b></article>
    </section>

    <section className="clean-section">
      <header><div><span className="section-kicker">TOP 4</span><h2>Melhores leituras em {strategyLabel(strategy)}</h2></div><button className="text-action" onClick={() => openStrategy(strategy)}>Ver Radar completo</button></header>
      <div className="clean-top4-grid">
        {current.top4.map((row, index) => <button className="top4-card" key={row.ticker} onClick={() => onOpenAsset(row.ticker)}>
          <span className="rank">#{index + 1}</span><div className="ticker-block"><b>{row.ticker}</b><small>{row.name}</small></div><strong>{row.score}<small>/100</small></strong><span className="buy-badge">COMPRA</span>
        </button>)}
        {!current.top4.length && <div className="clean-empty">Nenhuma ação atingiu 70 pontos com dados suficientes.</div>}
      </div>
    </section>

    <section className="clean-section changes-section">
      <header><div><span className="section-kicker">O QUE MUDOU</span><h2>Alterações desde a leitura anterior</h2></div></header>
      <div className="change-list">
        {visibleChanges.map((row) => <button key={`${row.ticker}-${row.eventLabel}`} className="change-row" onClick={() => onOpenAsset(row.ticker)}>
          <div><b>{row.ticker}</b><small>{row.name || row.eventLabel}</small></div><span>{row.eventLabel}</span><strong>{row.score}/100</strong><Delta value={row.delta} /><i className={row.signal}>{row.signal === "buy" ? "COMPRA" : "VENDA"}</i>
        </button>)}
        {!visibleChanges.length && <div className="clean-empty">O histórico comparável ainda está em formação.</div>}
      </div>
    </section>

    <section className="clean-section validation-section">
      <header><div><span className="section-kicker">VALIDAÇÃO DO MODELO</span><h2>Resultados após 20, 60 e 120 pregões</h2></div><small>{modelPerformance ? `${modelPerformance.snapshotCount ?? 0} fotografia(s)` : "amostra em formação"}</small></header>
      <div className="validation-cards">{validationRows.map((row) => <article key={row.sessions}><span>{row.sessions} pregões</span><b>{row.buyPositiveRatePct == null ? "N/D" : `${row.buyPositiveRatePct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</b><small>compras com retorno positivo</small><em>{row.buyAverageReturnPct == null ? "Amostra ainda insuficiente" : `retorno médio ${pct(row.buyAverageReturnPct)} · n=${row.buySample}`}</em></article>)}</div>
      <p className="validation-note">O placar é prospectivo: mede apenas sinais realmente registrados e nunca reconstrói o passado com dados futuros.</p>
    </section>

    <section className="clean-shortcuts">
      <button onClick={() => openStrategy(strategy)}><b>Radar</b><span>Top 20 e Top 4</span></button>
      <button onClick={() => onNavigate("portfolio")}><b>Carteira</b><span>Teses, alertas e desempenho</span></button>
      <button onClick={() => onNavigate("compare")}><b>Comparar</b><span>Compare duas ações</span></button>
      <button onClick={() => onNavigate("analyze")}><b>Análise completa</b><span>Ferramentas avançadas</span></button>
    </section>
  </div>;
}
