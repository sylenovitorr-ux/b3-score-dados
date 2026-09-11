import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeAsset } from "./data/normalize-asset.js";
import { applyIntradayQuotesIncremental, normalizeIntraday } from "./data/intraday.js";
import { rankSwingCandidates } from "./swing-ranking.js";
import "./AppLite.css";

const STOCK_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/b3-fundamentals.json";
const INTRADAY_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/intraday.json";
const HISTORY_BASE = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/history";
const HORIZON_MONTHS = 3;
const HISTORY_LIMIT = 60;
const CHOSEN_KEY = "b3-score-selected-trade-90d-v1";

const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value) => value == null ? "N/D" : `${Number(value) > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const num = (value, digits = 1) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { maximumFractionDigits: digits });
const dateBR = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "N/D";
const scoreOf = (asset) => asset?.fundamentals?.scores?.overall ?? null;
const confidenceOf = (asset) => asset?.fundamentals?.scores?.confidence ?? null;

function setupLabel(status) {
  return ({
    "na-faixa": "NA FAIXA",
    "aguardar-pullback": "AGUARDAR ENTRADA",
    monitorar: "MONITORAR",
    invalidado: "INVALIDADO",
  })[status] ?? "EM ANÁLISE";
}

function historyCandidates(rows) {
  const eligible = rows.filter((asset) => {
    const score = Number(scoreOf(asset));
    const confidence = Number(confidenceOf(asset));
    return Number.isFinite(score) && score >= 45 && Number.isFinite(confidence) && confidence >= 45 && Number(asset.volume) > 0;
  });
  const byLiquidity = [...eligible].sort((a, b) => Number(b.volume || 0) - Number(a.volume || 0)).slice(0, 42);
  const byQuality = [...eligible].sort((a, b) => Number(scoreOf(b) || 0) - Number(scoreOf(a) || 0)).slice(0, 28);
  const seen = new Set();
  return [...byLiquidity, ...byQuality].filter((asset) => {
    if (seen.has(asset.ticker)) return false;
    seen.add(asset.ticker);
    return true;
  }).slice(0, HISTORY_LIMIT);
}

async function fetchHistoryBundle(rows) {
  const candidates = historyCandidates(rows);
  const results = await Promise.allSettled(candidates.map(async (asset) => {
    const response = await fetch(`${HISTORY_BASE}/${encodeURIComponent(asset.ticker)}.json?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`histórico ${asset.ticker} indisponível`);
    const payload = await response.json();
    const series = Array.isArray(payload?.series) ? payload.series : [];
    if (series.length < 30) throw new Error(`histórico ${asset.ticker} insuficiente`);
    return [asset.ticker, { series, lastDate: payload.latestDate ?? series.at(-1)?.date ?? null }];
  }));
  const assets = {};
  for (const result of results) {
    if (result.status === "fulfilled") {
      const [ticker, data] = result.value;
      assets[ticker] = data;
    }
  }
  return { assets, requested: candidates.length, loaded: Object.keys(assets).length };
}

export default function AppLite() {
  const [assets, setAssets] = useState([]);
  const assetsRef = useRef([]);
  const [historyBundle, setHistoryBundle] = useState({ assets: {}, requested: 0, loaded: 0 });
  const [historyLoading, setHistoryLoading] = useState(true);
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [chosenTicker, setChosenTicker] = useState(() => {
    try { return localStorage.getItem(CHOSEN_KEY); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);
  const [asOf, setAsOf] = useState(null);

  const publishAssets = useCallback((rows) => {
    assetsRef.current = rows;
    setAssets(rows);
  }, []);

  const loadIntraday = useCallback(async (base = null) => {
    try {
      const response = await fetch(`${INTRADAY_URL}?t=${Date.now()}`, { cache: "no-store" });
      const payload = response.ok ? await response.json() : null;
      const normalized = normalizeIntraday(payload);
      const source = base ?? assetsRef.current;
      if (source.length) {
        const result = applyIntradayQuotesIncremental(source, normalized);
        if (result.changed) publishAssets(result.assets);
      }
    } catch {
      // O fechamento oficial continua válido quando o intraday não responde.
    } finally {
      setLastRefresh(new Date());
    }
  }, [publishAssets]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setHistoryLoading(true);
    setError("");
    try {
      const response = await fetch(`${STOCK_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível carregar a base B3.");
      const raw = await response.json();
      const rows = (Array.isArray(raw) ? raw : raw?.assets ?? [])
        .map(normalizeAsset)
        .filter((asset) => asset?.ticker && asset.kind !== "fii" && Number(asset.price) > 0);
      if (!rows.length) throw new Error("A base de ações veio vazia.");
      publishAssets(rows);
      setAsOf(rows.map((asset) => asset.date).filter(Boolean).sort().at(-1) ?? null);

      const [bundle] = await Promise.all([
        fetchHistoryBundle(rows),
        loadIntraday(rows),
      ]);
      setHistoryBundle(bundle);
      if (bundle.loaded < 20) throw new Error("Poucos históricos oficiais foram carregados para montar um Top 10 confiável.");
    } catch (err) {
      setError(err?.message || "Falha ao atualizar o radar.");
    } finally {
      setHistoryLoading(false);
      setLoading(false);
    }
  }, [loadIntraday, publishAssets]);

  useEffect(() => { void loadAll(); }, [loadAll]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadIntraday();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadIntraday]);

  const ranking = useMemo(
    () => rankSwingCandidates(assets, historyBundle, HORIZON_MONTHS),
    [assets, historyBundle],
  );
  const top10 = ranking.slice(0, 10);
  const selectedRow = useMemo(() => top10.find((row) => row.asset.ticker === selectedTicker) ?? null, [top10, selectedTicker]);
  const chosenRow = useMemo(() => top10.find((row) => row.asset.ticker === chosenTicker) ?? null, [top10, chosenTicker]);

  const chooseTrade = useCallback((ticker) => {
    setChosenTicker(ticker);
    setSelectedTicker(null);
    try { localStorage.setItem(CHOSEN_KEY, ticker); } catch {}
  }, []);

  return <main className="trade-app">
    <header className="trade-topbar">
      <div className="trade-brand"><b>B3</b><span>Score</span><small>SWING 90D</small></div>
      <div className="trade-top-status"><span>Pregão de referência</span><b>{dateBR(asOf)}</b></div>
      <button className="trade-refresh" type="button" disabled={loading} onClick={() => void loadAll()}>{loading ? "Atualizando…" : "Atualizar"}</button>
    </header>

    <div className="trade-shell">
      <section className="trade-hero">
        <div>
          <span className="trade-eyebrow">HORIZONTE FIXO · ATÉ 90 DIAS</span>
          <h1>10 ações. Uma escolha.</h1>
          <p>O app filtra o mercado e mostra só as dez candidatas mais fortes para swing trade. Você compara entrada, stop, alvo e risco/retorno, abre a ficha e escolhe uma.</p>
        </div>
        <div className="trade-hero-stats">
          <article><span>Horizonte</span><b>90 dias</b></article>
          <article><span>Históricos lidos</span><b>{historyLoading ? "…" : historyBundle.loaded}</b></article>
          <article><span>Oportunidades</span><b>{historyLoading ? "…" : top10.length}</b></article>
        </div>
      </section>

      {chosenRow && <section className="chosen-trade">
        <div><span>SEU TRADE SELECIONADO</span><strong>{chosenRow.asset.ticker}</strong><small>{chosenRow.asset.name || chosenRow.asset.fundamentals?.companyName}</small></div>
        <div><span>Entrada</span><b>{chosenRow.tradePlan ? `${money(chosenRow.tradePlan.entryLow)} – ${money(chosenRow.tradePlan.entryHigh)}` : "N/D"}</b></div>
        <div><span>Stop</span><b>{money(chosenRow.tradePlan?.stop)}</b></div>
        <div><span>Alvo</span><b>{money(chosenRow.tradePlan?.target)}</b></div>
        <button type="button" onClick={() => setSelectedTicker(chosenRow.asset.ticker)}>Abrir plano</button>
      </section>}

      <section className="trade-list-heading">
        <div><span>TOP 10 AGORA</span><h2>Escolha pela relação risco × retorno</h2></div>
        <p>{historyLoading ? "Lendo histórico oficial das ações mais líquidas…" : `Ranking calculado com ${historyBundle.loaded} históricos. Última consulta ${lastRefresh ? lastRefresh.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "N/D"}.`}</p>
      </section>

      {error && <div className="trade-error">{error}</div>}

      {historyLoading ? <section className="trade-loading">Analisando preço, tendência, fundamentos e risco…</section> : <section className="trade-list">
        {top10.map((row, index) => {
          const plan = row.tradePlan;
          const isChosen = row.asset.ticker === chosenTicker;
          return <article className={`trade-card ${isChosen ? "chosen" : ""}`} key={row.asset.ticker}>
            <button className="trade-card-main" type="button" onClick={() => setSelectedTicker(row.asset.ticker)}>
              <div className="trade-rank"><span>#{index + 1}</span><em className={`setup-${plan?.setupStatus ?? "monitorar"}`}>{setupLabel(plan?.setupStatus)}</em></div>
              <div className="trade-company"><strong>{row.asset.ticker}</strong><small>{row.asset.name || row.asset.fundamentals?.companyName || "Ação B3"}</small></div>
              <div className="trade-price"><span>Agora</span><b>{money(row.asset.price)}</b></div>
              <div className="trade-level"><span>Entrada</span><b>{plan ? `${money(plan.entryLow)} – ${money(plan.entryHigh)}` : "N/D"}</b></div>
              <div className="trade-level stop"><span>Stop</span><b>{money(plan?.stop)}</b></div>
              <div className="trade-level target"><span>Alvo</span><b>{money(plan?.target)}</b></div>
              <div className="trade-rr"><span>R:R</span><b>{plan?.riskReward == null ? "N/D" : `${num(plan.riskReward, 2)}x`}</b></div>
              <div className="trade-score"><span>Score</span><b>{row.score}</b></div>
              <span className="trade-open">Ver plano ›</span>
            </button>
            <button className={`trade-pick ${isChosen ? "selected" : ""}`} type="button" onClick={() => chooseTrade(row.asset.ticker)}>{isChosen ? "Selecionada ✓" : "Escolher"}</button>
          </article>;
        })}
        {!top10.length && !error && <div className="trade-error">Não há dados suficientes para montar dez operações sem inventar informações.</div>}
      </section>}

      <p className="trade-footnote">O ranking é quantitativo e serve para estudo. A execução, tamanho da posição e decisão final continuam sendo suas.</p>
    </div>

    {selectedRow && <div className="trade-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelectedTicker(null)}>
      <section className="trade-modal">
        <header>
          <div><span>PLANO DE TRADE · ATÉ 90 DIAS</span><h2>{selectedRow.asset.ticker}</h2><p>{selectedRow.asset.name || selectedRow.asset.fundamentals?.companyName}</p></div>
          <button type="button" onClick={() => setSelectedTicker(null)}>Fechar</button>
        </header>

        <div className="trade-modal-score"><strong>{selectedRow.score}<small>/100</small></strong><div><span>{setupLabel(selectedRow.tradePlan?.setupStatus)}</span><p>Referência técnica {dateBR(selectedRow.technicalReferenceDate)}</p></div></div>

        <section className="trade-plan-grid">
          <article><span>Preço atual</span><b>{money(selectedRow.asset.price)}</b></article>
          <article className="entry"><span>Zona de entrada</span><b>{selectedRow.tradePlan ? `${money(selectedRow.tradePlan.entryLow)} – ${money(selectedRow.tradePlan.entryHigh)}` : "N/D"}</b></article>
          <article className="stop"><span>Stop</span><b>{money(selectedRow.tradePlan?.stop)}</b><small>{selectedRow.tradePlan?.riskPct == null ? "" : `${pct(-selectedRow.tradePlan.riskPct)} de risco`}</small></article>
          <article className="target"><span>Alvo 1</span><b>{money(selectedRow.tradePlan?.target)}</b><small>{selectedRow.tradePlan?.rewardPct == null ? "" : `${pct(selectedRow.tradePlan.rewardPct)} potencial`}</small></article>
          <article><span>Alvo 2</span><b>{money(selectedRow.tradePlan?.target2)}</b></article>
          <article><span>Risco / retorno</span><b>{selectedRow.tradePlan?.riskReward == null ? "N/D" : `${num(selectedRow.tradePlan.riskReward, 2)}x`}</b></article>
        </section>

        <section className="trade-metrics">
          <article><span>Fundamentos</span><b>{Math.round(selectedRow.fundamental)}</b></article>
          <article><span>Momentum</span><b>{Math.round(selectedRow.momentum)}</b></article>
          <article><span>Risco</span><b>{Math.round(selectedRow.risk)}</b></article>
          <article><span>Liquidez</span><b>{Math.round(selectedRow.liquidity)}</b></article>
          <article><span>RSI 14</span><b>{num(selectedRow.rsi14)}</b></article>
          <article><span>Retorno 90d</span><b>{pct(selectedRow.horizonReturnPct)}</b></article>
        </section>

        <section className="trade-thesis">
          <article><span>POR QUE ESTÁ NO TOP 10</span>{selectedRow.tradePlan?.reasons?.length ? <ul>{selectedRow.tradePlan.reasons.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Conjunto quantitativo favorável no universo analisado.</p>}</article>
          <article><span>O QUE PODE INVALIDAR</span>{selectedRow.tradePlan?.cautions?.length ? <ul>{selectedRow.tradePlan.cautions.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Nenhum alerta quantitativo adicional foi acionado.</p>}</article>
        </section>

        <div className="trade-tech-note"><span>ATR14 {money(selectedRow.tradePlan?.atr14)}</span><span>Suporte {money(selectedRow.tradePlan?.support)}</span><span>Resistência {money(selectedRow.tradePlan?.resistance)}</span><span>Custo considerado 0,031% por lado</span></div>

        <button className={`trade-modal-pick ${selectedRow.asset.ticker === chosenTicker ? "selected" : ""}`} type="button" onClick={() => chooseTrade(selectedRow.asset.ticker)}>{selectedRow.asset.ticker === chosenTicker ? "Esta é a ação escolhida ✓" : `Escolher ${selectedRow.asset.ticker} para meu trade`}</button>
      </section>
    </div>}
  </main>;
}
