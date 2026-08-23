import { useEffect, useMemo, useState } from "react";
import { buildQuantAnalysis } from "./quant/quant-engine.js";
import { buildBuySellScore } from "./analysis/buy-sell-score.js";
import { fairValueRange } from "./opportunity-engine.js";
import { uniqueByIssuer } from "./issuer-key.js";
import { addMonths, battleEquitySeries, closeOrder, competitorMetrics, equityStats, finite, localDate, nextTradingDate, processOrder } from "./battle-engine.js";
import "./BattleArena.css";

const KEY = "b3-score-battles-v2";
const LEGACY_KEY = "b3-score-battles-v1";
const ANOMALY_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/market-anomalies.json";
const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value) => value == null ? "N/D" : `${value > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const id = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const statusLabel = (status) => status === "running" ? "EM ANDAMENTO" : status === "finished" ? "ENCERRADA" : "EM PREPARAÇÃO";
const formatDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR") : "N/D";

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
  const annualPositive = annual.length >= 3 ? annual.filter((value) => value > 0).length >= Math.ceil(annual.length * .6) && annual.at(-1) > 0 : null;
  const currentProfitability = eps != null ? eps > 0 : margin != null ? margin > 0 : roe != null ? roe > 0 : false;
  const pass = quality != null && quality >= 55 && overall != null && overall >= 55
    && (confidence == null || confidence >= 50) && currentProfitability
    && annualPositive !== false && (profitGrowth == null || profitGrowth > -40);
  return { pass, reasons: [
    quality != null ? `qualidade ${Math.round(quality)}/100` : null,
    annual.length >= 3 ? `${annual.filter((value) => value > 0).length}/${annual.length} anos com lucro positivo` : currentProfitability ? "rentabilidade atual positiva" : null,
    confidence != null ? `confiança ${Math.round(confidence)}/100` : null,
  ].filter(Boolean) };
}

function emptyBattle() {
  const capital = 10000;
  return {
    id: id("battle"), name: `Você vs IA · ${new Date().toLocaleDateString("pt-BR")}`,
    strategy: "swing", capital, startDate: nextTradingDate(), status: "setup",
    createdAt: new Date().toISOString(), modelVersion: "buy-sell-score-v1",
    competitors: [
      { id: id("mine"), name: "Você", kind: "mine", capital, orders: [] },
      { id: id("model"), name: "IA B3 Score", kind: "model", capital, orders: [] },
    ],
  };
}

function migrateBattle(source) {
  const fresh = emptyBattle();
  const capital = finite(source?.capital) > 0 ? finite(source.capital) : fresh.capital;
  const byKind = new Map((source?.competitors ?? []).map((competitor) => [competitor.kind, competitor]));
  const startDate = nextTradingDate();
  const competitors = fresh.competitors.map((base) => {
    const old = byKind.get(base.kind);
    return { ...base, id: old?.id ?? base.id, name: old?.name ?? base.name, capital, orders: (old?.orders ?? []).map((order) => ({
      ...order, status: "waiting", strategy: "swing", startDate,
      entryPrice: null, entryDate: null, quantity: null, exitPrice: null, exitDate: null,
      exitReason: null, pnl: null, returnPct: null, audit: [...(order.audit ?? []), { at: new Date().toISOString(), type: "migration-v2-reset" }],
    })) };
  });
  return { ...fresh, id: source?.id ?? fresh.id, name: source?.name ?? fresh.name, capital, startDate, competitors, migratedAt: new Date().toISOString() };
}

const allocationSum = (competitor) => (competitor?.orders ?? []).filter((order) => order.status !== "cancelled").reduce((sum, order) => sum + (finite(order.allocation) ?? 0), 0);

function orderValid(order) {
  const entry = finite(order.plannedEntry); const stop = finite(order.stop);
  const target = finite(order.target); const allocation = finite(order.allocation);
  return entry > 0 && stop > 0 && stop < entry && target > entry && allocation > 0;
}

function planOrder(row, capital, startDate, source, overrides = {}) {
  const entry = finite(overrides.plannedEntry) ?? finite(row.asset.price);
  const support = finite(row.anomaly?.low20); const fair = finite(row.fair?.base);
  const stop = finite(overrides.stop) ?? (support > 0 && support < entry ? support : entry * .92);
  const target = finite(overrides.target) ?? (fair > entry ? fair : entry * 1.15);
  return {
    id: id("order"), ticker: row.asset.ticker, name: row.asset.name, status: "waiting", strategy: "swing",
    plannedEntry: entry, stop, target, allocation: finite(overrides.allocation) ?? capital,
    startDate, deadline: overrides.deadline || addMonths(startDate, 6), scoreAtPlan: row.score.score,
    signalAtPlan: row.score.label, scorePartsAtPlan: row.score.parts, qualification: row.gate.reasons,
    dataReferenceDate: row.asset.date ?? null, modelVersion: "buy-sell-score-v1",
    createdAt: new Date().toISOString(), source, audit: [],
  };
}

function BattleDailyChart({ rows, competitors }) {
  if (!rows.length) return <div className="battle-chart-empty"><b>O gráfico diário começa no primeiro pregão da disputa.</b><span>As carteiras ficam travadas antes da data inicial.</span></div>;
  const width = 900; const height = 270; const pad = 34;
  const values = rows.flatMap((row) => competitors.map((competitor) => finite(row.values?.[competitor.id])).filter((value) => value != null));
  const min = Math.min(...values); const max = Math.max(...values); const spread = Math.max(max - min, max * .01, 1);
  const x = (index) => rows.length === 1 ? width / 2 : pad + index / (rows.length - 1) * (width - pad * 2);
  const y = (value) => height - pad - (value - (min - spread * .12)) / (spread * 1.24) * (height - pad * 2);
  const points = (competitor) => rows.map((row, index) => `${x(index)},${y(row.values[competitor.id])}`).join(" ");
  return <div className="battle-daily-chart">
    <div className="battle-chart-legend">{competitors.map((competitor) => <span key={competitor.id} className={competitor.kind}><i />{competitor.name}</span>)}</div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Evolução diária do patrimônio de você e da IA">
      {[0, .25, .5, .75, 1].map((ratio) => <line key={ratio} x1={pad} x2={width - pad} y1={pad + ratio * (height - pad * 2)} y2={pad + ratio * (height - pad * 2)} />)}
      {competitors.map((competitor) => <polyline key={competitor.id} className={competitor.kind} points={points(competitor)} />)}
    </svg>
    <div className="battle-chart-axis"><span>{formatDate(rows[0].date)}</span><span>{formatDate(rows.at(-1).date)}</span></div>
  </div>;
}

export default function BattleArena({ assets = [], sourcePortfolios = [] }) {
  const [battles, setBattles] = useState([]); const [activeId, setActiveId] = useState(null);
  const [ready, setReady] = useState(false); const [anomalies, setAnomalies] = useState(null);
  const [drafts, setDrafts] = useState({}); const [notice, setNotice] = useState("");
  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.ticker, asset])), [assets]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (Array.isArray(saved?.battles) && saved.battles.length) { setBattles(saved.battles); setActiveId(saved.activeId || saved.battles[0].id); }
      else {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null");
        if (Array.isArray(legacy?.battles) && legacy.battles.length) { const migrated = legacy.battles.map(migrateBattle); setBattles(migrated); setActiveId(migrated[0].id); }
      }
    } catch { localStorage.removeItem(KEY); }
    setReady(true);
    fetch(ANOMALY_URL, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then(setAnomalies).catch(() => setAnomalies(null));
  }, []);

  useEffect(() => { if (ready) localStorage.setItem(KEY, JSON.stringify({ version: 2, activeId, battles })); }, [ready, activeId, battles]);

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
  }, [ready, anomalies, assets.length, assetMap, battles.length]);

  const active = battles.find((battle) => battle.id === activeId) ?? null;
  const qualified = useMemo(() => assets.filter((asset) => asset.kind !== "fii").map((asset) => {
    const gate = fundamentalGate(asset); if (!gate.pass) return null;
    const anomaly = anomalies?.assets?.[asset.ticker] ?? null;
    const analysis = buildQuantAnalysis(asset, assets, anomaly, "swing_3_6m");
    const score = buildBuySellScore({ asset, analysis, strategy: "swing" });
    return score.score == null ? null : { asset, gate, analysis, score, fair: fairValueRange(asset), anomaly };
  }).filter(Boolean).sort((a, b) => (b.score.score ?? -1) - (a.score.score ?? -1)), [assets, anomalies]);
  const qualifiedMap = useMemo(() => new Map(qualified.map((row) => [row.asset.ticker, row])), [qualified]);

  const updateBattle = (patch) => setBattles((current) => current.map((battle) => battle.id === activeId ? { ...battle, ...patch } : battle));
  const updateCompetitor = (competitorId, updater) => setBattles((current) => current.map((battle) => battle.id !== activeId ? battle : { ...battle, competitors: battle.competitors.map((competitor) => competitor.id === competitorId ? (typeof updater === "function" ? updater(competitor) : { ...competitor, ...updater }) : competitor) }));
  const createBattle = () => { const battle = emptyBattle(); setBattles((current) => [...current, battle]); setActiveId(battle.id); setNotice(""); };
  const removeBattle = () => { const next = battles.filter((battle) => battle.id !== activeId); setBattles(next); setActiveId(next[0]?.id ?? null); };
  const setCapital = (value) => { const capital = Math.max(1000, finite(value) ?? 1000); updateBattle({ capital, competitors: active.competitors.map((competitor) => ({ ...competitor, capital })) }); };

  const addOrder = (competitor) => {
    if (active.status !== "setup" || competitor.kind !== "mine") return;
    const draft = drafts[competitor.id] ?? {}; const row = qualifiedMap.get(String(draft.ticker ?? "").trim().toUpperCase());
    if (!row) return setNotice("Escolha um ativo do universo qualificado.");
    const allocation = finite(draft.allocation) ?? Math.round(competitor.capital / 5);
    const order = planOrder(row, allocation, active.startDate, "user", draft);
    if (!orderValid(order)) return setNotice("Use stop abaixo da entrada, alvo acima da entrada e capital maior que zero.");
    if (allocationSum(competitor) + allocation > competitor.capital) return setNotice("A soma das ordens não pode ultrapassar o capital da disputa.");
    updateCompetitor(competitor.id, (current) => ({ ...current, orders: [...current.orders, order] }));
    setDrafts((current) => ({ ...current, [competitor.id]: {} })); setNotice("");
  };

  const autoFillModel = (competitor) => {
    if (active.status !== "setup" || competitor.kind !== "model") return;
    const candidates = uniqueByIssuer(qualified.filter((row) => row.score.signal === "buy")).slice(0, 5);
    if (!candidates.length) return setNotice("A IA não encontrou ações com COMPRA e dados suficientes.");
    const allocation = competitor.capital / candidates.length;
    updateCompetitor(competitor.id, { orders: candidates.map((row) => planOrder(row, allocation, active.startDate, "model-auto")) }); setNotice("");
  };

  const importPortfolio = (competitor, portfolioId) => {
    if (active.status !== "setup" || competitor.kind !== "mine") return;
    const portfolio = sourcePortfolios.find((item) => item.id === portfolioId);
    const rows = uniqueByIssuer((portfolio?.holdings ?? []).map((holding) => qualifiedMap.get(holding.ticker)).filter(Boolean));
    if (!rows.length) return setNotice("Essa carteira não tem ativos no universo qualificado do duelo.");
    const allocation = competitor.capital / rows.length;
    updateCompetitor(competitor.id, { orders: rows.map((row) => planOrder(row, allocation, active.startDate, `portfolio:${portfolio.id}`)) }); setNotice("");
  };

  const deleteOrder = (competitorId, orderId) => {
    if (active.status !== "setup") return;
    updateCompetitor(competitorId, (competitor) => ({ ...competitor, orders: competitor.orders.filter((order) => order.id !== orderId) }));
  };

  const startBattle = () => {
    const mine = active.competitors.find((competitor) => competitor.kind === "mine"); const model = active.competitors.find((competitor) => competitor.kind === "model");
    if (!mine?.orders?.length || !model?.orders?.length) return setNotice("Monte sua carteira e gere a carteira da IA antes de iniciar.");
    if ([mine, model].some((competitor) => allocationSum(competitor) > active.capital || competitor.orders.some((order) => !orderValid(order)))) return setNotice("Revise capital, entrada, stop e alvo das duas carteiras.");
    const startDate = active.startDate > localDate() ? active.startDate : nextTradingDate(); const lockedAt = new Date().toISOString();
    const dataReferenceDate = assets.map((asset) => asset.date).filter(Boolean).sort().at(-1) ?? null;
    updateBattle({ status: "running", startDate, lockedAt, dataReferenceDate, competitors: active.competitors.map((competitor) => ({ ...competitor, capital: active.capital, orders: competitor.orders.map((order) => ({ ...order, startDate, lockedAt })) })) }); setNotice("");
  };

  const manualClose = (competitor, order) => {
    if (active.status !== "running" || competitor.kind !== "mine" || order.status !== "open") return;
    const asset = assetMap.get(order.ticker); const price = finite(asset?.price);
    if (price == null) return setNotice("Preço atual indisponível para encerrar a posição.");
    updateCompetitor(competitor.id, (current) => ({ ...current, orders: current.orders.map((item) => item.id === order.id ? closeOrder(item, price, asset.date || localDate(), "DECISÃO DO USUÁRIO") : item) }));
  };

  const finishBattle = () => {
    if (active.status !== "running") return;
    const finishedAt = new Date().toISOString();
    const competitors = active.competitors.map((competitor) => ({ ...competitor, orders: competitor.orders.map((order) => {
      if (order.status === "waiting") return { ...order, status: "cancelled", exitReason: "FIM DA DISPUTA", updatedAt: finishedAt };
      if (order.status !== "open") return order;
      const asset = assetMap.get(order.ticker); const price = finite(asset?.price);
      return price == null ? order : closeOrder(order, price, asset.date || localDate(), "FIM DA DISPUTA");
    }) }));
    if (competitors.some((competitor) => competitor.orders.some((order) => order.status === "open"))) return setNotice("Há posição aberta sem preço atual; tente novamente quando a cotação estiver disponível.");
    const endDate = assets.map((asset) => asset.date).filter(Boolean).sort().at(-1) ?? localDate();
    updateBattle({ status: "finished", finishedAt, endDate, competitors }); setNotice("");
  };

  if (!active) return <section className="battle-arena"><header className="battle-intro"><div><span>DISPUTA</span><h2>Você contra a IA no swing trade.</h2><p>Mesmo capital, mesmos pregões e escolhas congeladas antes do início.</p></div><button onClick={createBattle}>Criar primeira disputa</button></header></section>;

  const competitors = active.competitors.filter((competitor) => ["mine", "model"].includes(competitor.kind));
  const metricRows = competitors.map((competitor) => ({ competitor, metrics: competitorMetrics(competitor, assetMap) }));
  const equityRows = battleEquitySeries({ ...active, competitors }, assetMap, anomalies);
  const stats = Object.fromEntries(competitors.map((competitor) => [competitor.id, equityStats(equityRows, competitor.id)]));
  const ranked = [...metricRows].sort((a, b) => b.metrics.returnPct - a.metrics.returnPct);
  const leader = ranked.length === 2 && ranked[0].metrics.returnPct !== ranked[1].metrics.returnPct ? ranked[0].competitor : null;
  const draft = (competitorId) => drafts[competitorId] ?? {};
  const setDraft = (competitorId, patch) => setDrafts((current) => ({ ...current, [competitorId]: { ...(current[competitorId] ?? {}), ...patch } }));
  const editable = active.status === "setup";

  return <section className="battle-arena">
    <header className="battle-intro"><div><span>VOCÊ VS IA · SWING TRADE</span><h2>Mesmas regras. Decisões diferentes.</h2><p>Você escolhe sua carteira; a IA escolhe a dela. A decisão de comprar no mundo real continua sendo somente sua.</p></div><button onClick={createBattle}>Nova disputa</button></header>
    <div className="battle-tabs">{battles.map((battle) => <button className={battle.id === activeId ? "active" : ""} key={battle.id} onClick={() => setActiveId(battle.id)}>{battle.name}</button>)}</div>

    <section className="battle-setup">
      <div className="battle-setup-main"><label>Nome<input value={active.name} disabled={!editable} onChange={(event) => updateBattle({ name: event.target.value || "Disputa" })} /></label><label>Estratégia<input value="Swing Trade" disabled /></label><label>Primeiro pregão<input type="date" min={nextTradingDate()} value={active.startDate} disabled={!editable} onChange={(event) => updateBattle({ startDate: event.target.value < nextTradingDate() ? nextTradingDate() : event.target.value })} /></label><label>Capital para cada um<input type="number" min="1000" step="100" value={active.capital} disabled={!editable} onChange={(event) => setCapital(event.target.value)} /></label></div>
      <div className={`battle-status ${active.status}`}><b>{statusLabel(active.status)}</b><span>{active.status === "setup" ? "Planos ainda editáveis" : `Planos travados em ${new Date(active.lockedAt ?? active.finishedAt).toLocaleString("pt-BR")}`}</span></div>
      <button className="battle-delete" onClick={removeBattle}>Excluir disputa</button>
    </section>
    {notice && <div className="battle-notice" role="alert">{notice}</div>}

    <section className="battle-scoreboard"><header><div><span>PLACAR DIÁRIO</span><h3>{leader ? `${leader.name} está na frente` : "Disputa empatada"}</h3></div><small>Desde {formatDate(active.startDate)}</small></header><div>{ranked.map(({ competitor, metrics }, index) => <article key={competitor.id} className={competitor.kind}><em>#{index + 1}</em><div><b>{competitor.name}</b><small>{competitor.kind === "mine" ? "Suas escolhas" : "Top 5 da IA congelado"}</small></div><strong className={metrics.returnPct >= 0 ? "positive" : "negative"}>{pct(metrics.returnPct)}</strong><span>{money(metrics.equity)}</span><small>{metrics.open} abertas · {metrics.closed} fechadas · {metrics.waiting} aguardando · acerto {pct(metrics.winRate)}</small><i>Dia {pct(stats[competitor.id]?.dailyPct)} · drawdown {pct(stats[competitor.id]?.maxDrawdownPct)}</i></article>)}</div></section>

    <section className="battle-chart-card"><header><div><span>GRÁFICO DIÁRIO</span><h3>Evolução do patrimônio</h3></div><small>Capital não alocado permanece em caixa</small></header><BattleDailyChart rows={equityRows} competitors={competitors} />{equityRows.length > 0 && <details><summary>Ver fechamento diário</summary><div className="battle-daily-table"><div><b>Data</b>{competitors.map((competitor) => <b key={competitor.id}>{competitor.name}</b>)}</div>{equityRows.slice(-10).reverse().map((row) => <div key={row.date}><span>{formatDate(row.date)}</span>{competitors.map((competitor) => <span key={competitor.id}>{money(row.values[competitor.id])}</span>)}</div>)}</div></details>}</section>

    {editable && <div className="battle-start"><div><b>1. Monte a sua carteira</b><span>2. Gere a carteira da IA</span><span>3. Inicie e congele as escolhas</span></div><button onClick={startBattle}>Iniciar disputa no próximo pregão</button></div>}
    {active.status === "running" && <div className="battle-start running"><div><b>Disputa em andamento</b><span>As ordens não podem mais ser editadas. Você pode encerrar apenas suas posições abertas.</span></div><button onClick={finishBattle}>Encerrar disputa</button></div>}

    <section className="battle-competitors">{competitors.map((competitor) => {
      const d = draft(competitor.id); const metrics = competitorMetrics(competitor, assetMap);
      return <article className={`battle-competitor ${competitor.kind}`} key={competitor.id}><header><div><h3>{competitor.name}</h3><small>{money(competitor.capital)} · alocado {money(allocationSum(competitor))} · resultado {pct(metrics.returnPct)}</small></div><div>{editable && competitor.kind === "model" && <button onClick={() => autoFillModel(competitor)}>Gerar Top 5 da IA</button>}{editable && sourcePortfolios.length > 0 && competitor.kind === "mine" && <select defaultValue="" onChange={(event) => event.target.value && importPortfolio(competitor, event.target.value)}><option value="">Importar carteira...</option>{sourcePortfolios.map((portfolio) => <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>)}</select>}</div></header>
        {editable && competitor.kind === "mine" && <div className="battle-order-create"><label>Ativo<input list={`qualified-${competitor.id}`} value={d.ticker ?? ""} onChange={(event) => setDraft(competitor.id, { ticker: event.target.value.toUpperCase() })} placeholder="Ex.: PETR4" /><datalist id={`qualified-${competitor.id}`}>{qualified.map((row) => <option key={row.asset.ticker} value={row.asset.ticker}>{row.asset.name} · score {row.score.score}</option>)}</datalist></label><label>Entrada<input type="number" step="0.01" value={d.plannedEntry ?? ""} onChange={(event) => setDraft(competitor.id, { plannedEntry: event.target.value })} /></label><label>Stop<input type="number" step="0.01" value={d.stop ?? ""} onChange={(event) => setDraft(competitor.id, { stop: event.target.value })} /></label><label>Alvo<input type="number" step="0.01" value={d.target ?? ""} onChange={(event) => setDraft(competitor.id, { target: event.target.value })} /></label><label>Capital<input type="number" step="100" value={d.allocation ?? ""} onChange={(event) => setDraft(competitor.id, { allocation: event.target.value })} placeholder={String(Math.round(competitor.capital / 5))} /></label><label>Prazo<input type="date" min={active.startDate} value={d.deadline ?? ""} onChange={(event) => setDraft(competitor.id, { deadline: event.target.value })} /></label><button onClick={() => addOrder(competitor)}>Adicionar</button></div>}
        <div className="battle-orders">{competitor.orders.map((order) => {
          const asset = assetMap.get(order.ticker); const current = finite(asset?.price);
          const currentPnl = order.status === "open" && current != null && finite(order.entryPrice) != null && finite(order.quantity) != null ? (current - order.entryPrice) * order.quantity : finite(order.pnl);
          const currentReturn = order.status === "open" && current != null && finite(order.entryPrice) != null ? (current / order.entryPrice - 1) * 100 : finite(order.returnPct);
          return <section className={`battle-order ${order.status}`} key={order.id}><div className="battle-order-main"><div><strong>{order.ticker}</strong><span>{order.name}</span><small>Plano congelado: score {order.scoreAtPlan ?? "N/D"} · {order.signalAtPlan ?? "N/D"}</small></div><em>{order.status === "waiting" ? "AGUARDANDO ENTRADA" : order.status === "open" ? "POSIÇÃO ABERTA" : order.status === "closed" ? `ENCERRADA · ${order.exitReason}` : "CANCELADA"}</em><b className={currentReturn == null ? "" : currentReturn >= 0 ? "positive" : "negative"}>{pct(currentReturn)}</b></div><div className="battle-order-numbers"><span>Entrada planejada<b>{money(order.plannedEntry)}</b></span><span>Executada<b>{order.entryDate ? `${money(order.entryPrice)} · ${formatDate(order.entryDate)}` : "N/D"}</b></span><span>Stop<b>{money(order.stop)}</b></span><span>Alvo<b>{money(order.target)}</b></span><span>Prazo<b>{formatDate(order.deadline)}</b></span><span>Resultado<b>{money(currentPnl)}</b></span></div>{order.qualification?.length > 0 && <p className="battle-qualification">Qualificação: {order.qualification.join(" · ")}</p>}<footer>{active.status === "running" && competitor.kind === "mine" && order.status === "open" && <button onClick={() => manualClose(competitor, order)}>Encerrar no preço atual</button>}{editable && <button className="danger-link" onClick={() => deleteOrder(competitor.id, order.id)}>Excluir plano</button>}</footer></section>;
        })}{!competitor.orders.length && <p className="battle-empty">{competitor.kind === "mine" ? "Adicione suas escolhas de swing trade." : "Clique em “Gerar Top 5 da IA”."}</p>}</div>
      </article>;
    })}</section>

    <aside className="battle-method-note"><b>Regras do duelo</b><p>O início é sempre prospectivo. As duas carteiras usam o mesmo capital e a mesma série diária. Entrada, stop, alvo e prazo só são executados quando tocados pelo OHLC oficial. Se stop e alvo forem tocados no mesmo candle, vale o stop — regra conservadora igual para os dois. A IA escolhe até cinco emissores distintos com nota COMPRA (70+); depois do início, seus planos ficam imutáveis.</p></aside>
  </section>;
}
