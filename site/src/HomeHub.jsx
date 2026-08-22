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
  if (value == null || value === 0) return <span className="pulse-delta neutral">sem comparação</span>;
  return <span className={`pulse-delta ${value > 0 ? "positive" : "negative"}`}>{value > 0 ? "↑" : "↓"} {Math.abs(value)} pts</span>;
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
    fetch(ANOMALY_URL, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then(setAnomalies).catch(() => void 0);
    fetch(MODEL_PULSE_URL, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((payload) => payload?.history && setOfficialPulse(payload)).catch(() => void 0);
    fetch(MODEL_PERFORMANCE_URL, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((payload) => payload?.strategies && setModelPerformance(payload)).catch(() => void 0);
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
  const eventHeadlines = [
    ...current.newBuys.slice(0, 2).map((row) => ({ ...row, eventLabel: "Virou COMPRA", eventIcon: "↗" })),
    ...current.newSells.slice(0, 2).map((row) => ({ ...row, eventLabel: "Virou VENDA", eventIcon: "↘" })),
  ];
  const moverHeadlines = current.movers.slice(0, 4).map((row) => ({ ...row, eventLabel: "Score mudou", eventIcon: row.delta > 0 ? "↑" : "↓" }));
  const visibleHeadlines = eventHeadlines.length ? eventHeadlines : moverHeadlines;
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

  const status = loading ? `Atualizando… ${elapsedSeconds}s` : statusText;
  const stocks = assets.filter((asset) => asset.kind !== "fii").length;
  const pulseSource = officialPulse?.referenceDate ? `Diário ${officialPulse.referenceDate}` : "Memória local";

  return <div className="v2-home terminal-home terminal-home-v2">
    <section className="terminal-brand-stage">
      <div className="brand-lockup compact-brand"><span className="brand-orbit" aria-hidden="true"><i /><i /><i /></span><div><b>B3 SCORE</b><small>DECISION DESK · 4.0</small></div></div>
      <div className="terminal-status-line"><span className="market-status-pill"><i className={loading ? "loading" : "live"} />{status}</span><span className="data-source-chip">{pulseSource}</span></div>
    </section>

    <section className="command-intro">
      <div><span className="v2-kicker">VISÃO DO DIA</span><h1>O que merece sua atenção <em>agora.</em></h1><p>O terminal prioriza mudanças de sinal, deterioração e força relativa. Sem dados suficientes, não existe palpite.</p></div>
      <nav className="terminal-strategy-tabs" aria-label="Estratégia do radar">
        {["swing", "long", "dividends"].map((id) => <button key={id} className={strategy === id ? "active" : ""} onClick={() => selectStrategy(id)}>{id === "swing" ? "⚡" : id === "long" ? "🧭" : "💰"}<span>{strategyLabel(id)}</span></button>)}
      </nav>
    </section>

    <section className="command-grid">
      <article className="command-feed">
        <header><div><span>⚡ PULSO DO MODELO</span><h2>{pulse?.baseline ? "Primeira fotografia em formação" : "Mudanças desde a leitura anterior"}</h2></div><button onClick={() => openStrategy(strategy)}>Radar completo <b>→</b></button></header>
        {(current.enteredTop4?.length > 0 || current.leftTop4?.length > 0) && <div className="terminal-top4-events">
          {current.enteredTop4?.map((row) => <button key={`in-${row.ticker}`} className="positive" onClick={() => row.ticker && onOpenAsset(row.ticker)}>🏆 {row.ticker} entrou no Top 4</button>)}
          {current.leftTop4?.map((item) => <span key={`out-${typeof item === "string" ? item : item.ticker}`} className="negative">↘ {typeof item === "string" ? item : item.ticker} saiu do Top 4</span>)}
        </div>}
        <div className="signal-feed-list">
          {visibleHeadlines.map((row) => <button key={`${row.ticker}-${row.signal}-${row.eventLabel}`} className={`signal-feed-row ${row.signal}`} onClick={() => onOpenAsset(row.ticker)}>
            <span className="feed-icon">{row.eventIcon}</span>
            <span className="feed-asset"><b>{row.ticker}</b><small>{row.name || row.eventLabel}</small></span>
            <span className={`signal-balloon ${row.signal}`}>{row.signal === "buy" ? "COMPRA" : "VENDA"}</span>
            <strong>{row.score}<small>/100</small></strong>
            <Delta value={row.delta} />
          </button>)}
          {!visibleHeadlines.length && current.top4.slice(0, 4).map((row, index) => <button key={row.ticker} className="signal-feed-row buy" onClick={() => onOpenAsset(row.ticker)}><span className="feed-icon">{index === 0 ? "🏆" : "•"}</span><span className="feed-asset"><b>{row.ticker}</b><small>Top #{index + 1} · base atual</small></span><span className="signal-balloon buy">COMPRA</span><strong>{row.score}<small>/100</small></strong><span className="pulse-delta neutral">sem histórico</span></button>)}
          {!visibleHeadlines.length && !current.top4.length && <p className="terminal-empty">Ainda não há ativos avaliáveis nesta estratégia.</p>}
        </div>
      </article>

      <aside className="command-scoreboard">
        <header><span>📡 MODELO AGORA</span><small>{strategyLabel(strategy)}</small></header>
        <div className="scoreboard-numbers"><article className="positive"><span>COMPRA</span><b>{current.buys || 0}</b></article><article className="negative"><span>VENDA</span><b>{current.sells || 0}</b></article></div>
        <dl><div><dt>Avaliadas</dt><dd>{evaluated || "N/D"}</dd></div><div><dt>Universo de ações</dt><dd>{stocks || "N/D"}</dd></div><div><dt>Pregão</dt><dd>{asOf.stockPriceAsOf ?? "N/D"}</dd></div><div><dt>Fundamentos CVM</dt><dd>{asOf.cvmFilesAsOf ?? "N/D"}</dd></div></dl>
        <button className="scoreboard-action" onClick={() => openStrategy(strategy)}>Abrir {strategyLabel(strategy)} →</button>
      </aside>
    </section>

    <section className="model-validation-panel">
      <header><div><span>🧪 PLACAR PROSPECTIVO</span><h2>O modelo será cobrado pelo que acontecer depois.</h2></div><small>{modelPerformance ? `${modelPerformance.snapshotCount ?? 0} fotografia(s) · ${modelPerformance.evaluatedObservations ?? 0} observações maduras` : "amostra em formação"}</small></header>
      <div className="model-validation-grid">{validationRows.map((row) => <article key={row.sessions}><span>{row.sessions} pregões</span><b>{row.buyPositiveRatePct == null ? "N/D" : `${row.buyPositiveRatePct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</b><small>COMPRA com retorno positivo</small><em>{row.buyAverageReturnPct == null ? "retorno médio ainda sem amostra" : `retorno médio ${pct(row.buyAverageReturnPct)} · n=${row.buySample}`}</em></article>)}</div>
      <p>Este placar é prospectivo: só mede sinais que foram realmente registrados. Não reconstrói sinais antigos com dados futuros.</p>
    </section>

    <section className="terminal-top4 terminal-top4-v2">
      <header><div><span>🏆 TOP 4 · {strategyLabel(strategy).toUpperCase()}</span><h2>As quatro leituras mais fortes agora</h2></div><small>score ≥ 70</small></header>
      <div>{current.top4.map((row, index) => <button key={row.ticker} onClick={() => onOpenAsset(row.ticker)}><em>{String(index + 1).padStart(2, "0")}</em><span><b>{row.ticker}</b><small>{row.name}</small></span><strong>{row.score}</strong><i>COMPRA</i></button>)}{!current.top4.length && <p>Nenhuma ação atingiu 70 pontos com dados suficientes.</p>}</div>
    </section>

    <section className="quick-tools">
      <button onClick={() => openStrategy(strategy)}><span>📊</span><div><b>Radar</b><small>Top 20 → Top 4</small></div><i>→</i></button>
      <button onClick={() => onNavigate("portfolio")}><span>💼</span><div><b>Carteira</b><small>Teses, alertas e desempenho</small></div><i>→</i></button>
      <button onClick={() => onNavigate("compare")}><span>⚖️</span><div><b>Comparar</b><small>Coloque duas teses lado a lado</small></div><i>→</i></button>
    </section>

    <section className="simple-search terminal-search-v2">
      <div className="search-title"><span>🔎</span><div><b>Analisar uma ação</b><small>Abra a ficha de decisão completa</small></div></div>
      <label><input aria-label="Pesquisar ativo" value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} onKeyDown={(event) => event.key === "Enter" && open()} placeholder="PETR4, BBAS3, WEGE3…" autoComplete="off"/><button onClick={() => open()} disabled={!assets.some((asset) => asset.ticker === ticker.trim().toUpperCase())}>Abrir análise</button></label>
      {matches.length > 0 && <div className="v2-search-results">{matches.map((asset) => <button key={asset.ticker} onClick={() => open(asset.ticker)}><b>{asset.ticker}</b><span>{asset.name}</span><em>{money(asset.price)}</em></button>)}</div>}
    </section>

    <details className="decision-home-more"><summary>Ferramentas avançadas</summary><div><button onClick={() => onNavigate("analyze")}>Análise completa</button><button onClick={() => onNavigate("methodology")}>Metodologia</button><button onClick={() => onNavigate("advanced")}>Outras ferramentas</button></div></details>
  </div>;
}
