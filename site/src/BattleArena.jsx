import { useEffect, useMemo, useState } from "react";
import { buildQuantAnalysis } from "./quant/quant-engine.js";
import { buildBuySellScore } from "./analysis/buy-sell-score.js";
import { fairValueRange } from "./opportunity-engine.js";
import "./BattleArena.css";

const KEY = "b3-score-battles-v1";
const ANOMALY_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/market-anomalies.json";
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value) => value == null ? "N/D" : `${value > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const id = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const localDate = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};
const nextTradingDate = (base = localDate()) => {
  const date = new Date(`${base}T12:00:00`);
  while ([0, 6].includes(date.getDay())) date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const addMonths = (value, months) => {
  const date = new Date(`${value}T12:00:00`);
  date.setMonth(date.getMonth() + months);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const quantProfile = (strategy) => strategy === "swing" ? "swing_3_6m" : "long_term";
const strategyLabel = (strategy) => strategy === "long" ? "Longo Prazo" : strategy === "dividends" ? "Dividendos" : "Swing Trade";

function annualProfitSeries(fundamentals) {
  const candidates = [fundamentals?.annualHistory, fundamentals?.history?.annual, fundamentals?.history?.yearly, fundamentals?.annual];
  const rows = candidates.find(Array.isArray) ?? [];
  return rows.map((row) => finite(row?.netIncome ?? row?.netProfit ?? row?.profit ?? row?.lucroLiquido)).filter((value) => value != null);
}

function fundamentalGate(asset) {
  const f = asset?.fundamentals;
  if (!f || asset.kind === "fii" || !(finite(asset.price) > 0)) return { pass: false, reasons: [] };
  const quality = finite(f?.scores?.quality);
  const overall = finite(f?.scores?.overall);
  const confidence = finite(f?.scores?.confidence);
  const eps = finite(f?.eps);
  const margin = finite(f?.netMargin);
  const roe = finite(f?.roe);
  const profitGrowth = finite(f?.profitGrowth);
  const annual = annualProfitSeries(f).slice(-5);
  const annualPositive = annual.length >= 3 ? annual.filter((value) => value > 0).length >= Math.ceil(annual.length * 0.6) && annual.at(-1) > 0 : null;
  const currentProfitability = eps != null ? eps > 0 : margin != null ? margin > 0 : roe != null ? roe > 0 : false;
  const pass = quality != null && quality >= 55
    && overall != null && overall >= 55
    && (confidence == null || confidence >= 50)
    && currentProfitability
    && (annualPositive !== false)
    && (profitGrowth == null || profitGrowth > -40);
  const reasons = [
    quality != null ? `qualidade ${Math.round(quality)}/100` : null,
    annual.length >= 3 ? `${annual.filter((value) => value > 0).length}/${annual.length} anos com lucro positivo` : currentProfitability ? "rentabilidade atual positiva" : null,
    confidence != null ? `confiança ${Math.round(confidence)}/100` : null,
  ].filter(Boolean);
  return { pass, reasons };
}

function rowsForTicker(ticker, asset, anomalies) {
  const source = Array.isArray(anomalies?.assets?.[ticker]?.series) ? anomalies.assets[ticker].series : [];
  const map = new Map(source.filter((row) => row?.date).map((row) => [row.date, row]));
  if (asset?.date && finite(asset.price) != null) {
    map.set(asset.date, {
      date: asset.date,
      open: finite(asset.priceopen) ?? finite(asset.price),
      high: finite(asset.high) ?? finite(asset.price),
      low: finite(asset.low) ?? finite(asset.price),
      close: finite(asset.price),
      volume: finite(asset.volume),
    });
  }
  return [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function touches(row, price) {
  const target = finite(price);
  const low = finite(row?.low) ?? finite(row?.close);
  const high = finite(row?.high) ?? finite(row?.close);
  return target != null && low != null && high != null && low <= target && high >= target;
}

function closeOrder(order, price, date, reason) {
  const exitPrice = finite(price);
  const quantity = finite(order.quantity);
  const entryPrice = finite(order.entryPrice);
  const pnl = exitPrice != null && quantity != null && entryPrice != null ? (exitPrice - entryPrice) * quantity : null;
  const returnPct = entryPrice && exitPrice != null ? (exitPrice / entryPrice - 1) * 100 : null;
  return { ...order, status: "closed", exitPrice, exitDate: date, exitReason: reason, pnl, returnPct, ambiguousDate: null, ambiguousTouches: null, updatedAt: new Date().toISOString() };
}

function processOrder(order, battle, assetMap, anomalies) {
  if (["closed", "cancelled", "ambiguous"].includes(order.status)) return order;
  const asset = assetMap.get(order.ticker);
  const series = rowsForTicker(order.ticker, asset, anomalies);
  if (!series.length) return order;
  let working = { ...order };
  let entryIndex = working.entryDate ? series.findIndex((row) => row.date === working.entryDate) : -1;
  if (working.status === "waiting") {
    const start = working.startDate || battle.startDate;
    entryIndex = series.findIndex((row) => row.date >= start && touches(row, working.plannedEntry));
    if (entryIndex < 0) return working;
    const entryRow = series[entryIndex];
    const entryPrice = finite(working.plannedEntry);
    const allocation = finite(working.allocation) ?? battle.capital;
    const quantity = entryPrice > 0 ? Math.floor(allocation / entryPrice) : 0;
    if (!quantity) return working;
    working = { ...working, status: "open", entryPrice, entryDate: entryRow.date, quantity, updatedAt: new Date().toISOString() };
    const sameStop = touches(entryRow, working.stop);
    const sameTarget = touches(entryRow, working.target);
    if (sameStop || sameTarget) {
      return { ...working, status: "ambiguous", ambiguousDate: entryRow.date, ambiguousTouches: [sameStop ? "stop" : null, sameTarget ? "target" : null].filter(Boolean), updatedAt: new Date().toISOString() };
    }
  }
  if (working.status !== "open") return working;
  const after = series.filter((row) => row.date > (working.ignoreThroughDate || working.entryDate));
  for (const row of after) {
    const hitStop = touches(row, working.stop);
    const hitTarget = touches(row, working.target);
    if (hitStop && hitTarget) {
      return { ...working, status: "ambiguous", ambiguousDate: row.date, ambiguousTouches: ["stop", "target"], updatedAt: new Date().toISOString() };
    }
    if (hitStop) return closeOrder(working, working.stop, row.date, "STOP");
    if (hitTarget) return closeOrder(working, working.target, row.date, "ALVO");
    if (working.deadline && row.date >= working.deadline && finite(row.close) != null) return closeOrder(working, row.close, row.date, "PRAZO");
  }
  return working;
}

function competitorMetrics(competitor, assetMap) {
  let pnl = 0;
  let allocated = 0;
  let measurable = 0;
  let closed = 0;
  let open = 0;
  let waiting = 0;
  let ambiguous = 0;
  for (const order of competitor.orders ?? []) {
    const allocation = finite(order.allocation) ?? 0;
    if (["open", "closed"].includes(order.status)) allocated += allocation;
    if (order.status === "closed") {
      closed += 1;
      if (finite(order.pnl) != null) { pnl += Number(order.pnl); measurable += 1; }
    } else if (order.status === "open") {
      open += 1;
      const current = finite(assetMap.get(order.ticker)?.price);
      if (current != null && finite(order.entryPrice) != null && finite(order.quantity) != null) {
        pnl += (current - Number(order.entryPrice)) * Number(order.quantity);
        measurable += 1;
      }
    } else if (order.status === "ambiguous") ambiguous += 1;
    else if (order.status === "waiting") waiting += 1;
  }
  const capital = finite(competitor.capital) ?? 0;
  return { capital, pnl, returnPct: capital > 0 ? pnl / capital * 100 : null, allocated, measurable, closed, open, waiting, ambiguous };
}

function emptyBattle() {
  const startDate = nextTradingDate();
  return {
    id: id("battle"),
    name: `Disputa ${new Date().toLocaleDateString("pt-BR")}`,
    strategy: "swing",
    capital: 10000,
    startDate,
    createdAt: new Date().toISOString(),
    competitors: [
      { id: id("mine"), name: "Minha carteira", kind: "mine", capital: 10000, orders: [] },
      { id: id("model"), name: "B3 Score", kind: "model", capital: 10000, orders: [] },
    ],
  };
}

function EditOrderForm({ order, onSave }) {
  const [draft, setDraft] = useState(order);
  useEffect(() => setDraft(order), [order]);
  const field = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  return <div className="battle-edit-form">
    <label>Entrada planejada<input type="number" step="0.01" value={draft.plannedEntry ?? ""} onChange={(e) => field("plannedEntry", e.target.value)} /></label>
    <label>Stop<input type="number" step="0.01" value={draft.stop ?? ""} onChange={(e) => field("stop", e.target.value)} /></label>
    <label>Alvo<input type="number" step="0.01" value={draft.target ?? ""} onChange={(e) => field("target", e.target.value)} /></label>
    <label>Capital<input type="number" step="100" value={draft.allocation ?? ""} onChange={(e) => field("allocation", e.target.value)} /></label>
    <label>Prazo<input type="date" value={draft.deadline ?? ""} onChange={(e) => field("deadline", e.target.value)} /></label>
    {order.status === "closed" && <><label>Entrada executada<input type="number" step="0.01" value={draft.entryPrice ?? ""} onChange={(e) => field("entryPrice", e.target.value)} /></label><label>Data entrada<input type="date" value={draft.entryDate ?? ""} onChange={(e) => field("entryDate", e.target.value)} /></label><label>Saída executada<input type="number" step="0.01" value={draft.exitPrice ?? ""} onChange={(e) => field("exitPrice", e.target.value)} /></label><label>Data saída<input type="date" value={draft.exitDate ?? ""} onChange={(e) => field("exitDate", e.target.value)} /></label></>}
    <button onClick={() => onSave(draft)}>Salvar alteração</button>
  </div>;
}

export default function BattleArena({ assets = [], sourcePortfolios = [] }) {
  const [battles, setBattles] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [ready, setReady] = useState(false);
  const [anomalies, setAnomalies] = useState(null);
  const [drafts, setDrafts] = useState({});
  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.ticker, asset])), [assets]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (Array.isArray(saved?.battles) && saved.battles.length) {
        setBattles(saved.battles);
        setActiveId(saved.activeId || saved.battles[0].id);
      }
    } catch { localStorage.removeItem(KEY); }
    setReady(true);
    fetch(ANOMALY_URL, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then(setAnomalies).catch(() => setAnomalies(null));
  }, []);

  useEffect(() => { if (ready) localStorage.setItem(KEY, JSON.stringify({ version: 1, activeId, battles })); }, [ready, activeId, battles]);

  useEffect(() => {
    if (!ready || !anomalies || !battles.length) return;
    setBattles((current) => {
      let changed = false;
      const next = current.map((battle) => ({ ...battle, competitors: (battle.competitors ?? []).map((competitor) => ({ ...competitor, orders: (competitor.orders ?? []).map((order) => {
        const processed = processOrder(order, battle, assetMap, anomalies);
        if (JSON.stringify(processed) !== JSON.stringify(order)) changed = true;
        return processed;
      }) })) }));
      return changed ? next : current;
    });
  }, [ready, anomalies, assets.length]);

  const active = battles.find((battle) => battle.id === activeId) ?? null;
  const qualified = useMemo(() => {
    if (!active) return [];
    return assets.filter((asset) => asset.kind !== "fii").map((asset) => {
      const gate = fundamentalGate(asset);
      if (!gate.pass) return null;
      const anomaly = anomalies?.assets?.[asset.ticker] ?? null;
      const analysis = buildQuantAnalysis(asset, assets, anomaly, quantProfile(active.strategy));
      const score = buildBuySellScore({ asset, analysis, strategy: active.strategy });
      return score?.score == null ? null : { asset, gate, analysis, score, fair: fairValueRange(asset), anomaly };
    }).filter(Boolean).sort((a, b) => (b.score.score ?? -1) - (a.score.score ?? -1));
  }, [active?.strategy, assets, anomalies]);
  const qualifiedMap = useMemo(() => new Map(qualified.map((row) => [row.asset.ticker, row])), [qualified]);

  const updateBattle = (patch) => setBattles((current) => current.map((battle) => battle.id === activeId ? { ...battle, ...patch } : battle));
  const updateCompetitor = (competitorId, updater) => updateBattle({ competitors: active.competitors.map((competitor) => competitor.id === competitorId ? (typeof updater === "function" ? updater(competitor) : { ...competitor, ...updater }) : competitor) });
  const createBattle = () => { const battle = emptyBattle(); setBattles((current) => [...current, battle]); setActiveId(battle.id); };
  const addCompetitor = () => updateBattle({ competitors: [...active.competitors, { id: id("competitor"), name: `Carteira ${active.competitors.length + 1}`, kind: "custom", capital: active.capital, orders: [] }] });
  const removeCompetitor = (competitorId) => updateBattle({ competitors: active.competitors.filter((competitor) => competitor.id !== competitorId) });
  const removeBattle = () => { const next = battles.filter((battle) => battle.id !== activeId); setBattles(next); setActiveId(next[0]?.id ?? null); };

  const addOrder = (competitor) => {
    const draft = drafts[competitor.id] ?? {};
    const ticker = String(draft.ticker ?? "").trim().toUpperCase();
    const row = qualifiedMap.get(ticker);
    const plannedEntry = finite(draft.plannedEntry);
    if (!row || !(plannedEntry > 0)) return;
    const allocation = finite(draft.allocation) ?? Math.max(100, competitor.capital / 5);
    const order = {
      id: id("order"), ticker, name: row.asset.name, status: "waiting", strategy: active.strategy,
      plannedEntry, stop: finite(draft.stop), target: finite(draft.target), allocation,
      startDate: active.startDate, deadline: draft.deadline || addMonths(active.startDate, active.strategy === "swing" ? 6 : 12),
      scoreAtPlan: row.score.score, signalAtPlan: row.score.label, qualification: row.gate.reasons,
      createdAt: new Date().toISOString(), audit: [],
    };
    updateCompetitor(competitor.id, (current) => ({ ...current, orders: [...(current.orders ?? []), order] }));
    setDrafts((current) => ({ ...current, [competitor.id]: {} }));
  };

  const autoFillModel = (competitor) => {
    const candidates = qualified.filter((row) => row.score.signal === "buy").slice(0, 5);
    if (!candidates.length) return;
    const allocation = competitor.capital / candidates.length;
    const orders = candidates.map((row) => ({
      id: id("order"), ticker: row.asset.ticker, name: row.asset.name, status: "waiting", strategy: active.strategy,
      plannedEntry: row.asset.price, stop: active.strategy === "swing" && finite(row.anomaly?.low20) != null && row.anomaly.low20 < row.asset.price ? row.anomaly.low20 : null,
      target: finite(row.fair?.base) != null && row.fair.base > row.asset.price ? row.fair.base : null,
      allocation, startDate: active.startDate, deadline: addMonths(active.startDate, active.strategy === "swing" ? 6 : 12),
      scoreAtPlan: row.score.score, signalAtPlan: row.score.label, qualification: row.gate.reasons,
      createdAt: new Date().toISOString(), audit: [], source: "model-auto",
    }));
    updateCompetitor(competitor.id, { orders });
  };

  const importPortfolio = (competitor, portfolioId) => {
    const portfolio = sourcePortfolios.find((item) => item.id === portfolioId);
    if (!portfolio) return;
    const holdings = portfolio.holdings ?? [];
    const allocation = competitor.capital / Math.max(1, holdings.length);
    const orders = holdings.map((holding) => {
      const row = qualifiedMap.get(holding.ticker);
      if (!row) return null;
      return {
        id: id("order"), ticker: holding.ticker, name: row.asset.name, status: "waiting", strategy: active.strategy,
        plannedEntry: row.asset.price, stop: null, target: finite(row.fair?.base) > row.asset.price ? row.fair.base : null,
        allocation, startDate: active.startDate, deadline: addMonths(active.startDate, active.strategy === "swing" ? 6 : 12),
        scoreAtPlan: row.score.score, signalAtPlan: row.score.label, qualification: row.gate.reasons,
        createdAt: new Date().toISOString(), audit: [], source: `portfolio:${portfolio.id}`,
      };
    }).filter(Boolean);
    updateCompetitor(competitor.id, { orders });
  };

  const saveOrderEdit = (competitorId, order, nextDraft) => {
    updateCompetitor(competitorId, (competitor) => ({ ...competitor, orders: competitor.orders.map((current) => {
      if (current.id !== order.id) return current;
      const next = {
        ...current,
        plannedEntry: finite(nextDraft.plannedEntry), stop: finite(nextDraft.stop), target: finite(nextDraft.target), allocation: finite(nextDraft.allocation), deadline: nextDraft.deadline || null,
        entryPrice: finite(nextDraft.entryPrice) ?? current.entryPrice, entryDate: nextDraft.entryDate || current.entryDate,
        exitPrice: finite(nextDraft.exitPrice) ?? current.exitPrice, exitDate: nextDraft.exitDate || current.exitDate,
      };
      if (next.status === "closed" && finite(next.entryPrice) != null && finite(next.exitPrice) != null && finite(next.quantity) != null) {
        next.pnl = (next.exitPrice - next.entryPrice) * next.quantity;
        next.returnPct = next.entryPrice ? (next.exitPrice / next.entryPrice - 1) * 100 : null;
      }
      next.audit = [...(current.audit ?? []), { at: new Date().toISOString(), type: "manual-edit", before: { plannedEntry: current.plannedEntry, stop: current.stop, target: current.target, allocation: current.allocation, deadline: current.deadline, entryPrice: current.entryPrice, entryDate: current.entryDate, exitPrice: current.exitPrice, exitDate: current.exitDate }, after: { plannedEntry: next.plannedEntry, stop: next.stop, target: next.target, allocation: next.allocation, deadline: next.deadline, entryPrice: next.entryPrice, entryDate: next.entryDate, exitPrice: next.exitPrice, exitDate: next.exitDate } }];
      next.updatedAt = new Date().toISOString();
      return next;
    }) }));
  };

  const cancelOrder = (competitorId, orderId) => updateCompetitor(competitorId, (competitor) => ({ ...competitor, orders: competitor.orders.map((order) => order.id === orderId ? { ...order, status: "cancelled", updatedAt: new Date().toISOString() } : order) }));
  const deleteOrder = (competitorId, orderId) => updateCompetitor(competitorId, (competitor) => ({ ...competitor, orders: competitor.orders.filter((order) => order.id !== orderId) }));
  const manualClose = (competitorId, order) => {
    const asset = assetMap.get(order.ticker); const price = finite(asset?.price); if (price == null || order.status !== "open") return;
    updateCompetitor(competitorId, (competitor) => ({ ...competitor, orders: competitor.orders.map((current) => current.id === order.id ? closeOrder(current, price, asset.date || localDate(), "MANUAL") : current) }));
  };
  const resolveAmbiguous = (competitorId, order, action) => {
    updateCompetitor(competitorId, (competitor) => ({ ...competitor, orders: competitor.orders.map((current) => {
      if (current.id !== order.id) return current;
      if (action === "keep") return { ...current, status: "open", ignoreThroughDate: current.ambiguousDate, ambiguityResolution: "mantida aberta", ambiguousDate: null, ambiguousTouches: null, updatedAt: new Date().toISOString() };
      const price = action === "stop" ? current.stop : current.target;
      return closeOrder(current, price, current.ambiguousDate, action === "stop" ? "STOP CONFIRMADO" : "ALVO CONFIRMADO");
    }) }));
  };

  if (!active) return <section className="battle-arena"><header className="battle-intro"><div><span>DISPUTA</span><h2>Coloque carteiras para competir com pregões reais.</h2><p>Planeje antes. Depois que o mercado começar, o sistema registra o que realmente aconteceu.</p></div><button onClick={createBattle}>Criar primeira disputa</button></header></section>;

  const metricRows = active.competitors.map((competitor) => ({ competitor, metrics: competitorMetrics(competitor, assetMap) }));
  const mine = metricRows.find((row) => row.competitor.kind === "mine")?.metrics ?? null;
  const draft = (competitorId) => drafts[competitorId] ?? {};
  const setDraft = (competitorId, patch) => setDrafts((current) => ({ ...current, [competitorId]: { ...(current[competitorId] ?? {}), ...patch } }));

  return <section className="battle-arena">
    <header className="battle-intro"><div><span>DISPUTA</span><h2>Carteiras diferentes. Mesmos pregões.</h2><p>Sem seleção por fama: o universo qualificado parte de fundamentos, rentabilidade positiva e dados mínimos. A execução usa apenas preços realmente observados.</p></div><button onClick={createBattle}>Nova disputa</button></header>

    <div className="battle-tabs">{battles.map((battle) => <button className={battle.id === activeId ? "active" : ""} key={battle.id} onClick={() => setActiveId(battle.id)}>{battle.name}</button>)}</div>

    <section className="battle-setup"><div className="battle-setup-main"><label>Nome<input value={active.name} onChange={(e) => updateBattle({ name: e.target.value || "Disputa" })} /></label><label>Estratégia<select value={active.strategy} onChange={(e) => updateBattle({ strategy: e.target.value })}><option value="swing">Swing Trade</option><option value="long">Longo Prazo</option><option value="dividends">Dividendos</option></select></label><label>Início<input type="date" value={active.startDate} onChange={(e) => updateBattle({ startDate: e.target.value })} /></label><label>Capital padrão<input type="number" step="100" value={active.capital} onChange={(e) => updateBattle({ capital: Math.max(0, Number(e.target.value)) })} /></label></div><div className="battle-universe"><b>{qualified.length}</b><span>ações no universo qualificado</span><small>Sem filtro por fama ou tamanho. Exige qualidade mínima, rentabilidade positiva e cobertura suficiente.</small></div><button className="battle-delete" onClick={removeBattle}>Excluir disputa</button></section>

    <section className="battle-scoreboard"><header><div><span>PLACAR</span><h3>Resultado desde {new Date(`${active.startDate}T12:00:00`).toLocaleDateString("pt-BR")}</h3></div><small>{strategyLabel(active.strategy)}</small></header><div>{[...metricRows].sort((a, b) => (b.metrics.returnPct ?? -Infinity) - (a.metrics.returnPct ?? -Infinity)).map(({ competitor, metrics }, index) => <article key={competitor.id} className={competitor.kind === "mine" ? "mine" : ""}><em>#{index + 1}</em><div><b>{competitor.name}</b><small>{competitor.kind === "mine" ? "Sua referência" : competitor.kind === "model" ? "Modelo B3 Score" : "Carteira rival"}</small></div><strong className={metrics.returnPct == null ? "" : metrics.returnPct >= 0 ? "positive" : "negative"}>{pct(metrics.returnPct)}</strong><span>{money(metrics.pnl)}</span><small>{metrics.open} abertas · {metrics.closed} fechadas · {metrics.waiting} aguardando{metrics.ambiguous ? ` · ${metrics.ambiguous} ambíguas` : ""}</small>{mine && competitor.kind !== "mine" && <i>{metrics.returnPct == null || mine.returnPct == null ? "vs você N/D" : `${pct(metrics.returnPct - mine.returnPct)} vs você`}</i>}</article>)}</div></section>

    <div className="battle-actions"><button onClick={addCompetitor}>Adicionar carteira rival</button></div>

    <section className="battle-competitors">{active.competitors.map((competitor) => {
      const d = draft(competitor.id);
      const metrics = competitorMetrics(competitor, assetMap);
      return <article className="battle-competitor" key={competitor.id}><header><div><input className="battle-name-input" value={competitor.name} onChange={(e) => updateCompetitor(competitor.id, { name: e.target.value || "Carteira" })} /><small>{money(competitor.capital)} · {pct(metrics.returnPct)}</small></div><div>{competitor.kind === "model" && <button onClick={() => autoFillModel(competitor)}>Preencher com Top 5 qualificado</button>}{sourcePortfolios.length > 0 && competitor.kind === "mine" && <select defaultValue="" onChange={(e) => e.target.value && importPortfolio(competitor, e.target.value)}><option value="">Importar carteira...</option>{sourcePortfolios.map((portfolio) => <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>)}</select>}{competitor.kind === "custom" && <button className="danger-link" onClick={() => removeCompetitor(competitor.id)}>Remover</button>}</div></header>

        <div className="battle-order-create"><label>Ativo<input list={`qualified-${competitor.id}`} value={d.ticker ?? ""} onChange={(e) => setDraft(competitor.id, { ticker: e.target.value.toUpperCase() })} placeholder="Ex.: PETR4" /><datalist id={`qualified-${competitor.id}`}>{qualified.map((row) => <option key={row.asset.ticker} value={row.asset.ticker}>{row.asset.name} · score {row.score.score}</option>)}</datalist></label><label>Entrada<input type="number" step="0.01" value={d.plannedEntry ?? ""} onChange={(e) => setDraft(competitor.id, { plannedEntry: e.target.value })} /></label><label>Stop<input type="number" step="0.01" value={d.stop ?? ""} onChange={(e) => setDraft(competitor.id, { stop: e.target.value })} /></label><label>Alvo<input type="number" step="0.01" value={d.target ?? ""} onChange={(e) => setDraft(competitor.id, { target: e.target.value })} /></label><label>Capital<input type="number" step="100" value={d.allocation ?? ""} onChange={(e) => setDraft(competitor.id, { allocation: e.target.value })} placeholder={String(Math.round(competitor.capital / 5))} /></label><label>Prazo<input type="date" value={d.deadline ?? ""} onChange={(e) => setDraft(competitor.id, { deadline: e.target.value })} /></label><button onClick={() => addOrder(competitor)}>Adicionar ordem</button></div>

        <div className="battle-orders">{(competitor.orders ?? []).map((order) => {
          const asset = assetMap.get(order.ticker); const current = finite(asset?.price);
          const currentPnl = order.status === "open" && current != null && finite(order.entryPrice) != null && finite(order.quantity) != null ? (current - order.entryPrice) * order.quantity : finite(order.pnl);
          const currentReturn = order.status === "open" && current != null && finite(order.entryPrice) != null ? (current / order.entryPrice - 1) * 100 : finite(order.returnPct);
          return <section className={`battle-order ${order.status}`} key={order.id}><div className="battle-order-main"><div><strong>{order.ticker}</strong><span>{order.name}</span><small>Plano: score {order.scoreAtPlan ?? "N/D"} · {order.signalAtPlan ?? "N/D"}</small></div><em>{order.status === "waiting" ? "AGUARDANDO ENTRADA" : order.status === "open" ? "POSIÇÃO ABERTA" : order.status === "closed" ? `ENCERRADA · ${order.exitReason}` : order.status === "ambiguous" ? "EXECUÇÃO AMBÍGUA" : "CANCELADA"}</em><b className={currentReturn == null ? "" : currentReturn >= 0 ? "positive" : "negative"}>{pct(currentReturn)}</b></div><div className="battle-order-numbers"><span>Entrada planejada<b>{money(order.plannedEntry)}</b></span><span>Executada<b>{order.entryDate ? `${money(order.entryPrice)} · ${order.entryDate}` : "N/D"}</b></span><span>Stop<b>{money(order.stop)}</b></span><span>Alvo<b>{money(order.target)}</b></span><span>Prazo<b>{order.deadline || "N/D"}</b></span><span>Resultado<b>{money(currentPnl)}</b></span></div>{order.qualification?.length > 0 && <p className="battle-qualification">Qualificação: {order.qualification.join(" · ")}</p>}{order.status === "ambiguous" && <div className="battle-ambiguity"><b>O candle diário não informa a ordem dos preços em {order.ambiguousDate}.</b><span>Toques registrados: {order.ambiguousTouches?.join(" + ")}. Confirme o que ocorreu ou mantenha a posição aberta a partir do pregão seguinte.</span><div>{order.ambiguousTouches?.includes("stop") && <button onClick={() => resolveAmbiguous(competitor.id, order, "stop")}>Confirmar stop</button>}{order.ambiguousTouches?.includes("target") && <button onClick={() => resolveAmbiguous(competitor.id, order, "target")}>Confirmar alvo</button>}<button onClick={() => resolveAmbiguous(competitor.id, order, "keep")}>Manter aberta</button></div></div>}<details><summary>Editar e auditar</summary><EditOrderForm order={order} onSave={(draftOrder) => saveOrderEdit(competitor.id, order, draftOrder)} />{order.audit?.length > 0 && <small className="battle-audit">{order.audit.length} alteração(ões) registrada(s). Última: {new Date(order.audit.at(-1).at).toLocaleString("pt-BR")}</small>}</details><footer>{order.status === "open" && <button onClick={() => manualClose(competitor.id, order)}>Encerrar no preço atual</button>}{order.status === "waiting" && <button onClick={() => cancelOrder(competitor.id, order.id)}>Cancelar ordem</button>}<button className="danger-link" onClick={() => deleteOrder(competitor.id, order.id)}>Excluir</button></footer></section>;
        })}{!(competitor.orders ?? []).length && <p className="battle-empty">Nenhuma ordem planejada nesta carteira.</p>}</div>
      </article>;
    })}</section>

    <aside className="battle-method-note"><b>Como a execução funciona</b><p>Uma entrada é considerada executada apenas quando o preço planejado fica entre a mínima e a máxima de um pregão a partir da data inicial. Stop, alvo e prazo usam a mesma série oficial. Quando o mesmo candle permite mais de uma sequência possível, o resultado fica ambíguo até confirmação, em vez de o app escolher a versão mais favorável.</p></aside>
  </section>;
}
