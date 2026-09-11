import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeAsset } from "./data/normalize-asset.js";
import { applyIntradayQuotesIncremental, normalizeIntraday } from "./data/intraday.js";
import { rankSwingCandidates } from "./swing-ranking.js";
import "./AppLite.css";
import "./MyTrade.css";

const STOCK_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/b3-fundamentals.json";
const INTRADAY_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/intraday.json";
const HISTORY_BASE = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/history";
const HORIZON_MONTHS = 3;
const HISTORY_LIMIT = 60;
const CHOSEN_KEY = "b3-score-selected-trade-90d-v1";
const POSITION_KEY = "b3-score-my-trade-position-v1";
const TRANSACTION_COST_RATE = 0.00031;

const money = (value) => value == null || !Number.isFinite(Number(value)) ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value) => value == null || !Number.isFinite(Number(value)) ? "N/D" : `${Number(value) > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const num = (value, digits = 1) => value == null || !Number.isFinite(Number(value)) ? "N/D" : Number(value).toLocaleString("pt-BR", { maximumFractionDigits: digits });
const dateBR = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "N/D";
const scoreOf = (asset) => asset?.fundamentals?.scores?.overall ?? null;
const confidenceOf = (asset) => asset?.fundamentals?.scores?.confidence ?? null;
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

function parseInputNumber(value) {
  if (value == null || value === "") return null;
  const normalized = String(value).trim().replace(/\s/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function setupLabel(status) {
  return ({
    "na-faixa": "NA FAIXA",
    "aguardar-pullback": "AGUARDAR ENTRADA",
    monitorar: "MONITORAR",
    invalidado: "INVALIDADO",
  })[status] ?? "EM ANÁLISE";
}

function readStoredPosition() {
  try {
    const parsed = JSON.parse(localStorage.getItem(POSITION_KEY) || "null");
    if (!parsed?.ticker || !Number.isFinite(Number(parsed.entryPrice)) || !Number.isFinite(Number(parsed.quantity))) return null;
    return parsed;
  } catch {
    return null;
  }
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

function positionMetrics(position, asset) {
  if (!position || !asset) return null;
  const entry = Number(position.entryPrice);
  const quantity = Number(position.quantity);
  const current = Number(asset.price);
  const stop = Number(position.stopPrice);
  const target = Number(position.targetPrice);
  if (!(entry > 0) || !(quantity > 0) || !(current > 0)) return null;

  const invested = entry * quantity;
  const currentValue = current * quantity;
  const buyCost = invested * TRANSACTION_COST_RATE;
  const estimatedSellCost = currentValue * TRANSACTION_COST_RATE;
  const grossPnl = (current - entry) * quantity;
  const netPnl = grossPnl - buyCost - estimatedSellCost;
  const netPerShare = netPnl / quantity;
  const returnPct = netPnl / (invested + buyCost) * 100;
  const grossPerShare = current - entry;
  const progress = Number.isFinite(stop) && Number.isFinite(target) && target > stop
    ? clamp((current - stop) / (target - stop) * 100)
    : null;
  const distanceToStopPct = Number.isFinite(stop) && stop > 0 ? (current / stop - 1) * 100 : null;
  const distanceToTargetPct = Number.isFinite(target) && target > 0 ? (target / current - 1) * 100 : null;
  const netAtTarget = Number.isFinite(target) && target > 0
    ? ((target - entry) * quantity) - buyCost - (target * quantity * TRANSACTION_COST_RATE)
    : null;

  let status = "NEUTRO";
  if (Number.isFinite(stop) && current <= stop) status = "STOP ATINGIDO";
  else if (Number.isFinite(target) && current >= target) status = "ALVO ATINGIDO";
  else if (netPnl > 0.01) status = "POSITIVO";
  else if (netPnl < -0.01) status = "NEGATIVO";

  return {
    entry,
    quantity,
    current,
    stop: Number.isFinite(stop) ? stop : null,
    target: Number.isFinite(target) ? target : null,
    invested,
    currentValue,
    buyCost,
    estimatedSellCost,
    grossPnl,
    netPnl,
    netPerShare,
    grossPerShare,
    returnPct,
    progress,
    distanceToStopPct,
    distanceToTargetPct,
    netAtTarget,
    status,
  };
}

export default function AppLite() {
  const [assets, setAssets] = useState([]);
  const assetsRef = useRef([]);
  const [historyBundle, setHistoryBundle] = useState({ assets: {}, requested: 0, loaded: 0 });
  const [historyLoading, setHistoryLoading] = useState(true);
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [position, setPosition] = useState(() => readStoredPosition());
  const [chosenTicker, setChosenTicker] = useState(() => {
    try { return readStoredPosition()?.ticker || localStorage.getItem(CHOSEN_KEY); } catch { return null; }
  });
  const [view, setView] = useState(() => readStoredPosition() ? "trade" : "radar");
  const [tradeForm, setTradeForm] = useState({ entry: "", quantity: "", stop: "", target: "" });
  const [tradeFormError, setTradeFormError] = useState("");
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
  const chosenRow = useMemo(() => ranking.find((row) => row.asset.ticker === chosenTicker) ?? null, [ranking, chosenTicker]);
  const chosenAsset = useMemo(() => assets.find((asset) => asset.ticker === chosenTicker) ?? null, [assets, chosenTicker]);
  const chosenPlan = chosenRow?.tradePlan ?? position?.planSnapshot ?? null;
  const liveMetrics = useMemo(() => positionMetrics(position, chosenAsset), [position, chosenAsset]);

  useEffect(() => {
    if (!chosenTicker) return;
    if (position?.ticker === chosenTicker) {
      setTradeForm({
        entry: String(position.entryPrice ?? ""),
        quantity: String(position.quantity ?? ""),
        stop: String(position.stopPrice ?? ""),
        target: String(position.targetPrice ?? ""),
      });
      return;
    }
    setTradeForm({
      entry: chosenPlan?.entry == null ? "" : String(chosenPlan.entry),
      quantity: "",
      stop: chosenPlan?.stop == null ? "" : String(chosenPlan.stop),
      target: chosenPlan?.target == null ? "" : String(chosenPlan.target),
    });
  }, [chosenTicker, chosenPlan, position]);

  const chooseTrade = useCallback((row) => {
    const ticker = row.asset.ticker;
    if (position?.ticker && position.ticker !== ticker) {
      const confirmed = window.confirm(`Trocar ${position.ticker} por ${ticker}? O registro do trade atual será removido do app.`);
      if (!confirmed) return;
      setPosition(null);
      try { localStorage.removeItem(POSITION_KEY); } catch {}
    }
    setChosenTicker(ticker);
    setSelectedTicker(null);
    setView("trade");
    try { localStorage.setItem(CHOSEN_KEY, ticker); } catch {}
  }, [position]);

  const savePosition = useCallback(() => {
    if (!chosenTicker || !chosenAsset) return;
    const entryPrice = parseInputNumber(tradeForm.entry);
    const quantity = parseInputNumber(tradeForm.quantity);
    const stopPrice = parseInputNumber(tradeForm.stop);
    const targetPrice = parseInputNumber(tradeForm.target);
    if (!(entryPrice > 0)) return setTradeFormError("Informe o preço real de entrada.");
    if (!(quantity > 0)) return setTradeFormError("Informe uma quantidade válida de ações.");
    if (!(stopPrice > 0 && stopPrice < entryPrice)) return setTradeFormError("O stop precisa ficar abaixo do preço de entrada.");
    if (!(targetPrice > entryPrice)) return setTradeFormError("O alvo precisa ficar acima do preço de entrada.");

    const next = {
      ticker: chosenTicker,
      entryPrice,
      quantity: Math.floor(quantity),
      stopPrice,
      targetPrice,
      openedAt: position?.ticker === chosenTicker ? position.openedAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      planSnapshot: chosenPlan,
    };
    if (!(next.quantity > 0)) return setTradeFormError("A quantidade precisa ser pelo menos 1 ação.");
    setPosition(next);
    setTradeFormError("");
    try { localStorage.setItem(POSITION_KEY, JSON.stringify(next)); } catch {}
  }, [chosenTicker, chosenAsset, tradeForm, position, chosenPlan]);

  const clearTrade = useCallback(() => {
    const confirmed = window.confirm("Encerrar este acompanhamento e voltar a escolher entre as 10 ações?");
    if (!confirmed) return;
    setPosition(null);
    setChosenTicker(null);
    setSelectedTicker(null);
    setView("radar");
    setTradeForm({ entry: "", quantity: "", stop: "", target: "" });
    setTradeFormError("");
    try {
      localStorage.removeItem(POSITION_KEY);
      localStorage.removeItem(CHOSEN_KEY);
    } catch {}
  }, []);

  return <main className="trade-app">
    <header className="trade-topbar">
      <button className="trade-brand trade-brand-button" type="button" onClick={() => setView("radar")}><b>B3</b><span>Score</span><small>SWING 90D</small></button>
      <nav className="trade-nav">
        <button className={view === "radar" ? "active" : ""} type="button" onClick={() => setView("radar")}>Top 10</button>
        <button className={view === "trade" ? "active" : ""} type="button" disabled={!chosenTicker} onClick={() => setView("trade")}>Meu Trade</button>
      </nav>
      <div className="trade-top-status"><span>Pregão de referência</span><b>{dateBR(asOf)}</b></div>
      <button className="trade-refresh" type="button" disabled={loading} onClick={() => void loadAll()}>{loading ? "Atualizando…" : "Atualizar"}</button>
    </header>

    {view === "radar" && <div className="trade-shell">
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

      {chosenTicker && chosenAsset && <section className="chosen-trade">
        <div><span>SEU TRADE SELECIONADO</span><strong>{chosenTicker}</strong><small>{chosenAsset.name || chosenAsset.fundamentals?.companyName}</small></div>
        <div><span>{position ? "Entrada real" : "Entrada sugerida"}</span><b>{position ? money(position.entryPrice) : chosenPlan ? `${money(chosenPlan.entryLow)} – ${money(chosenPlan.entryHigh)}` : "N/D"}</b></div>
        <div><span>Stop</span><b>{money(position?.stopPrice ?? chosenPlan?.stop)}</b></div>
        <div><span>Alvo</span><b>{money(position?.targetPrice ?? chosenPlan?.target)}</b></div>
        <button type="button" onClick={() => setView("trade")}>Meu Trade</button>
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
            <button className={`trade-pick ${isChosen ? "selected" : ""}`} type="button" onClick={() => chooseTrade(row)}>{isChosen ? "Selecionada ✓" : "Escolher"}</button>
          </article>;
        })}
        {!top10.length && !error && <div className="trade-error">Não há dados suficientes para montar dez operações sem inventar informações.</div>}
      </section>}

      <p className="trade-footnote">O ranking é quantitativo e serve para estudo. A execução, tamanho da posição e decisão final continuam sendo suas.</p>
    </div>}

    {view === "trade" && <div className="mytrade-shell">
      {!chosenTicker || !chosenAsset ? <section className="mytrade-empty"><span>MEU TRADE</span><h1>Escolha uma ação primeiro.</h1><p>Volte ao Top 10, abra uma candidata e toque em Escolher.</p><button type="button" onClick={() => setView("radar")}>Ver Top 10</button></section> : <>
        <section className="mytrade-heading">
          <div><button className="mytrade-back" type="button" onClick={() => setView("radar")}>← Top 10</button><span>MEU TRADE · ATÉ 90 DIAS</span><h1>{chosenTicker}</h1><p>{chosenAsset.name || chosenAsset.fundamentals?.companyName || "Ação B3"}</p></div>
          <div className="mytrade-live"><span>Preço agora</span><b>{money(chosenAsset.price)}</b><small>{chosenAsset.intraday ? "cotação intradiária disponível" : `fechamento de ${dateBR(chosenAsset.date)}`}</small></div>
        </section>

        {position?.ticker === chosenTicker && liveMetrics ? <section className={`mytrade-pnl ${liveMetrics.netPnl >= 0 ? "positive" : "negative"}`}>
          <div><span>RESULTADO LÍQUIDO ESTIMADO</span><strong>{money(liveMetrics.netPnl)}</strong><small>já descontando 0,031% na compra e venda estimada agora</small></div>
          <article><span>Por ação</span><b>{liveMetrics.netPerShare >= 0 ? "+" : ""}{money(liveMetrics.netPerShare)}</b><small>{liveMetrics.netPerShare >= 0 ? "+" : ""}{num(liveMetrics.netPerShare * 100, 1)} centavos</small></article>
          <article><span>Retorno</span><b>{pct(liveMetrics.returnPct)}</b><small>{liveMetrics.status}</small></article>
          <article><span>Quantidade</span><b>{liveMetrics.quantity.toLocaleString("pt-BR")}</b><small>{money(liveMetrics.currentValue)} em valor atual</small></article>
        </section> : <section className="mytrade-prompt"><div><span>1. REGISTRE SUA COMPRA</span><h2>Quando executar a ordem, coloque o preço real e a quantidade.</h2><p>Até você salvar, entrada, stop e alvo abaixo são apenas referências do plano.</p></div></section>}

        <section className="mytrade-workspace">
          <article className="mytrade-form-card">
            <header><span>EXECUÇÃO REAL</span><h2>{position?.ticker === chosenTicker ? "Sua posição" : "Registrar compra"}</h2></header>
            <div className="mytrade-form-grid">
              <label>Preço de entrada<input inputMode="decimal" value={tradeForm.entry} onChange={(event) => setTradeForm((current) => ({ ...current, entry: event.target.value }))} placeholder="0,00" /></label>
              <label>Quantidade<input inputMode="numeric" value={tradeForm.quantity} onChange={(event) => setTradeForm((current) => ({ ...current, quantity: event.target.value }))} placeholder="100" /></label>
              <label>Stop<input inputMode="decimal" value={tradeForm.stop} onChange={(event) => setTradeForm((current) => ({ ...current, stop: event.target.value }))} placeholder="0,00" /></label>
              <label>Alvo<input inputMode="decimal" value={tradeForm.target} onChange={(event) => setTradeForm((current) => ({ ...current, target: event.target.value }))} placeholder="0,00" /></label>
            </div>
            {tradeFormError && <p className="mytrade-form-error">{tradeFormError}</p>}
            <button className="mytrade-save" type="button" onClick={savePosition}>{position?.ticker === chosenTicker ? "Atualizar posição" : "Salvar meu trade"}</button>
            {position?.ticker === chosenTicker && <small className="mytrade-opened">Acompanhando desde {new Date(position.openedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</small>}
          </article>

          <article className="mytrade-plan-card">
            <header><span>PLANO 90D</span><h2>Mapa da operação</h2></header>
            <div className="mytrade-levels">
              <div><span>Entrada sugerida</span><b>{chosenPlan ? `${money(chosenPlan.entryLow)} – ${money(chosenPlan.entryHigh)}` : "N/D"}</b></div>
              <div className="stop"><span>Stop técnico</span><b>{money(position?.stopPrice ?? chosenPlan?.stop)}</b></div>
              <div className="target"><span>Alvo</span><b>{money(position?.targetPrice ?? chosenPlan?.target)}</b></div>
              <div><span>R:R planejado</span><b>{chosenPlan?.riskReward == null ? "N/D" : `${num(chosenPlan.riskReward, 2)}x`}</b></div>
            </div>

            {liveMetrics?.progress != null && <div className="mytrade-progress-wrap">
              <div className="mytrade-progress-labels"><span>STOP {money(liveMetrics.stop)}</span><b>AGORA {money(liveMetrics.current)}</b><span>ALVO {money(liveMetrics.target)}</span></div>
              <div className="mytrade-progress"><i style={{ width: `${liveMetrics.progress}%` }} /></div>
            </div>}

            {liveMetrics && <div className="mytrade-distances">
              <article><span>Folga até o stop</span><b>{pct(liveMetrics.distanceToStopPct)}</b></article>
              <article><span>Falta até o alvo</span><b>{pct(liveMetrics.distanceToTargetPct)}</b></article>
              <article><span>Se chegar ao alvo</span><b>{money(liveMetrics.netAtTarget)}</b><small>líquido estimado</small></article>
            </div>}
          </article>
        </section>

        <section className="mytrade-summary">
          <article><span>SCORE DO RADAR</span><b>{chosenRow?.score ?? "N/D"}<small>/100</small></b></article>
          <article><span>FUNDAMENTOS</span><b>{chosenRow?.fundamental == null ? "N/D" : Math.round(chosenRow.fundamental)}</b></article>
          <article><span>MOMENTUM</span><b>{chosenRow?.momentum == null ? "N/D" : Math.round(chosenRow.momentum)}</b></article>
          <article><span>RISCO</span><b>{chosenRow?.risk == null ? "N/D" : Math.round(chosenRow.risk)}</b></article>
          <article><span>RSI 14</span><b>{num(chosenRow?.rsi14)}</b></article>
        </section>

        <section className="mytrade-actions">
          <button type="button" onClick={() => setView("radar")}>Comparar com Top 10</button>
          <button className="danger" type="button" onClick={clearTrade}>{position ? "Encerrar acompanhamento" : "Escolher outra ação"}</button>
        </section>
      </>}
    </div>}

    {view === "radar" && selectedRow && <div className="trade-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelectedTicker(null)}>
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

        <button className={`trade-modal-pick ${selectedRow.asset.ticker === chosenTicker ? "selected" : ""}`} type="button" onClick={() => chooseTrade(selectedRow)}>{selectedRow.asset.ticker === chosenTicker ? "Abrir Meu Trade ✓" : `Escolher ${selectedRow.asset.ticker} para meu trade`}</button>
      </section>
    </div>}
  </main>;
}
