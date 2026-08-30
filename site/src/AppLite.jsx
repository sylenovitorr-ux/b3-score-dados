import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PortfolioManager from "./PortfolioManager.jsx";
import AssetAnalysisTabs from "./AssetAnalysisTabs.jsx";
import { normalizeAsset } from "./data/normalize-asset.js";
import { applyIntradayQuotesIncremental, normalizeIntraday } from "./data/intraday.js";
import { freshness } from "./quant/data-quality.js";
import { buildQuantAnalysis } from "./quant/quant-engine.js";
import { rankSwingCandidates } from "./swing-ranking.js";
import "./v2.css";
import "./v2-extra-1.css";
import "./v2-extra-2.css";
import "./AppLite.css";

const STOCK_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/b3-fundamentals.json";
const INTRADAY_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/intraday.json";
const ANOMALY_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/market-anomalies.json";
const BENCHMARK_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/benchmarks.json";
const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value) => value == null ? "N/D" : `${Number(value) > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const num = (value, digits = 1) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { maximumFractionDigits: digits });
const dateBR = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR") : "N/D";
const scoreOf = (asset) => asset?.fundamentals?.scores?.overall ?? null;
const confidenceOf = (asset) => asset?.fundamentals?.scores?.confidence ?? null;
function currentSaoPauloDate() { const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day}`; }

function setupLabel(status) {
  return ({ "na-faixa": "NA FAIXA", "aguardar-pullback": "AGUARDAR PULLBACK", monitorar: "MONITORAR", invalidado: "INVALIDADO" })[status] ?? "N/D";
}

export default function AppLite() {
  const [assets, setAssets] = useState([]);
  const assetsRef = useRef([]);
  const [intraday, setIntraday] = useState(null);
  const [anomalies, setAnomalies] = useState(null);
  const [benchmarks, setBenchmarks] = useState(null);
  const [changedTickers, setChangedTickers] = useState([]);
  const [page, setPage] = useState("home");
  const [query, setQuery] = useState("");
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [swingMonths, setSwingMonths] = useState(3);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);
  const [asOf, setAsOf] = useState({ stockPriceAsOf: null, cvmFilesAsOf: null });
  const publishAssets = useCallback((rows) => { assetsRef.current = rows; setAssets(rows); }, []);

  const loadIntraday = useCallback(async (base = null) => {
    try {
      const response = await fetch(`${INTRADAY_URL}?t=${Date.now()}`, { cache: "no-store" });
      const payload = response.ok ? await response.json() : null;
      const normalized = normalizeIntraday(payload);
      setIntraday(normalized);
      const source = base ?? assetsRef.current;
      if (source.length) {
        const result = applyIntradayQuotesIncremental(source, normalized);
        if (result.changed) publishAssets(result.assets);
        setChangedTickers(result.changedTickers);
      }
      setLastRefresh(new Date());
    } catch { setLastRefresh(new Date()); }
  }, [publishAssets]);

  const loadSupplemental = useCallback(async () => {
    const cacheBust = Date.now();
    const [anomalyResult, benchmarkResult] = await Promise.allSettled([
      fetch(`${ANOMALY_URL}?t=${cacheBust}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
      fetch(`${BENCHMARK_URL}?t=${cacheBust}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null),
    ]);
    if (anomalyResult.status === "fulfilled" && anomalyResult.value) setAnomalies(anomalyResult.value);
    if (benchmarkResult.status === "fulfilled" && benchmarkResult.value) setBenchmarks(benchmarkResult.value);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`${STOCK_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Falha ao carregar a base B3");
      const raw = await response.json();
      const rows = (Array.isArray(raw) ? raw : raw?.assets ?? []).map(normalizeAsset).filter((asset) => asset?.ticker && asset.kind !== "fii" && asset.price > 0);
      if (!rows.length) throw new Error("Base de ações vazia");
      publishAssets(rows);
      const stockPriceAsOf = rows.map((asset) => asset.date).filter(Boolean).sort().at(-1) ?? null;
      const cvmFilesAsOf = rows.map((asset) => asset.fundamentals?.referenceDate).filter(Boolean).sort().at(-1) ?? null;
      setAsOf({ stockPriceAsOf, cvmFilesAsOf });
      await Promise.all([loadIntraday(rows), loadSupplemental()]);
    } catch (err) { setError(err?.message || "Não foi possível carregar os dados."); }
    finally { setLoading(false); }
  }, [loadIntraday, loadSupplemental, publishAssets]);

  useEffect(() => { void loadAll(); }, [loadAll]);
  useEffect(() => { const timer = window.setInterval(() => { if (!document.hidden) void loadIntraday(); }, 60_000); return () => window.clearInterval(timer); }, [loadIntraday]);

  const filtered = useMemo(() => { const term = query.trim().toUpperCase(); return assets.filter((asset) => !term || asset.ticker.includes(term) || asset.name?.toUpperCase().includes(term) || asset.fundamentals?.companyName?.toUpperCase().includes(term)).sort((a, b) => (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1)); }, [assets, query]);
  const selected = useMemo(() => assets.find((asset) => asset.ticker === selectedTicker) ?? null, [assets, selectedTicker]);
  const selectedAnomaly = selected ? anomalies?.assets?.[selected.ticker] ?? null : null;
  const selectedAnalysis = useMemo(() => selected ? buildQuantAnalysis(selected, assets, selectedAnomaly, "swing_3_6m") : null, [selected, assets, selectedAnomaly]);
  const swingRanking = useMemo(() => rankSwingCandidates(assets, anomalies, swingMonths), [assets, anomalies, swingMonths]);
  const topSwing = swingRanking.slice(0, 10);
  const officialFreshness = useMemo(() => freshness(asOf.stockPriceAsOf, "price"), [asOf.stockPriceAsOf]);
  const liveCount = assets.filter((asset) => asset.intraday).length;
  const units = assets.filter((asset) => asset.kind === "unit").length;
  const stocks = assets.length - units;

  return <main className="lite-app">
    <header className="lite-topbar"><button className="lite-brand" onClick={() => setPage("home")}><b>B3</b><span>Score</span></button><nav><button className={page === "home" ? "active" : ""} onClick={() => setPage("home")}>Início</button><button className={page === "stocks" ? "active" : ""} onClick={() => setPage("stocks")}>Ações</button><button className={page === "swing" ? "active" : ""} onClick={() => setPage("swing")}>Top 10 Swing</button><button className={page === "portfolio" ? "active" : ""} onClick={() => setPage("portfolio")}>Carteira</button></nav><button className="lite-refresh" disabled={loading} onClick={() => void loadAll()}>{loading ? "Atualizando…" : "Atualizar"}</button></header>

    {page === "home" && <div className="lite-page"><section className="lite-hero"><div><span>FOCO: AÇÕES B3</span><h1>Preço, análise, swing e disputa.</h1><p>O fechamento oficial alimenta fundamentos, histórico técnico, ranking de swing trade e carteiras. O intraday altera apenas o que realmente mudou.</p></div><div className="lite-status"><article><span>Data atual</span><b>{dateBR(currentSaoPauloDate())}</b></article><article><span>Último pregão oficial</span><b>{dateBR(asOf.stockPriceAsOf)}</b></article><article><span>Situação</span><b>{officialFreshness.label}</b></article><article><span>Intraday ativo</span><b>{liveCount} ativos</b></article></div></section>{error && <div className="lite-error">{error}</div>}<section className="lite-kpis"><article><span>Ações</span><b>{stocks}</b></article><article><span>Units</span><b>{units}</b></article><article><span>Alterados no último ciclo</span><b>{changedTickers.length}</b></article><article><span>Última consulta</span><b>{lastRefresh ? lastRefresh.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "N/D"}</b></article></section><section className="lite-actions"><button onClick={() => setPage("stocks")}><b>Analisar ações</b><span>Abrir histórico fundamentalista, técnico e valuation.</span></button><button onClick={() => setPage("swing")}><b>Top 10 Swing</b><span>Ranking dinâmico de 1 a 6 meses, com entrada, stop e alvo.</span></button><button onClick={() => setPage("portfolio")}><b>Carteira e disputa</b><span>Comprar, vender e competir contra a IA N+2.</span></button></section></div>}

    {page === "stocks" && <div className="lite-page"><section className="lite-section-head"><div><span>AÇÕES E UNITS</span><h1>Universo monitorado</h1><p>Clique em qualquer ativo para abrir novamente a análise completa, com fundamentos históricos, gráfico técnico, risco, valuation e benchmarks.</p></div><label>Pesquisar<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="PETR4, VALE3, SANB11..." /></label></section><section className="lite-stock-grid">{filtered.map((asset) => <button key={asset.ticker} className="lite-stock" onClick={() => setSelectedTicker(asset.ticker)}><div><b>{asset.ticker}</b><small>{asset.kind === "unit" ? "UNIT" : "AÇÃO"}{asset.intraday ? " · INTRADAY" : ""}</small></div><strong>{money(asset.price)}</strong><span className={(asset.changepct ?? 0) >= 0 ? "positive" : "negative"}>{pct(asset.changepct)}</span><em>Score {scoreOf(asset) ?? "N/D"}</em></button>)}</section></div>}

    {page === "swing" && <div className="lite-page"><section className="lite-section-head swing-head"><div><span>RADAR SWING TRADE</span><h1>As 10 melhores para 1 a 6 meses</h1><p>Além do ranking, cada ativo recebe um plano operacional calculado a partir do histórico B3: zona de entrada, stop técnico, alvos e relação risco/retorno líquida dos custos.</p></div><label>Horizonte<select value={swingMonths} onChange={(event) => setSwingMonths(Number(event.target.value))}>{[1,2,3,4,5,6].map((month) => <option key={month} value={month}>{month} {month === 1 ? "mês" : "meses"}</option>)}</select></label></section><div className="swing-method-note"><b>Janela: {swingMonths} {swingMonths === 1 ? "mês" : "meses"}</b><span>Entrada por pullback/tendência, stop por ATR14 e suporte, alvo por resistência ou valor fundamental. O cálculo de R:R desconta 0,031% na compra e 0,031% na venda.</span></div><section className="swing-top10-grid">{topSwing.map((row, index) => { const plan = row.tradePlan; return <article className="swing-pick-card" key={row.asset.ticker}><button className="swing-pick-open" onClick={() => setSelectedTicker(row.asset.ticker)}><div className="swing-rank"><span>#{index + 1}</span><em className={`swing-${row.signal}`}>{row.signal === "forte" ? "FORTE" : row.signal === "observar" ? "OBSERVAR" : "FRACO"}</em></div><div className="swing-name"><strong>{row.asset.ticker}</strong><small>{row.asset.name || row.asset.fundamentals?.companyName}</small></div><div className="swing-score"><b>{row.score}</b><span>/100</span></div></button>{plan ? <><div className="swing-trade-strip"><article><span>Preço atual</span><b>{money(plan.current)}</b></article><article><span>Entrada</span><b>{money(plan.entryLow)} a {money(plan.entryHigh)}</b></article><article><span>Stop</span><b>{money(plan.stop)}</b><small>{pct(-plan.riskPct)}</small></article><article><span>Alvo 1</span><b>{money(plan.target)}</b><small>{pct(plan.rewardPct)}</small></article><article><span>Alvo 2</span><b>{money(plan.target2)}</b></article><article><span>Risco/retorno</span><b>{plan.riskReward == null ? "N/D" : `${num(plan.riskReward, 2)}x`}</b></article></div><div className="swing-setup-line"><b className={`setup-${plan.setupStatus}`}>{setupLabel(plan.setupStatus)}</b><span>ATR14 {money(plan.atr14)} · suporte {money(plan.support)} · resistência {money(plan.resistance)}</span></div><div className="swing-thesis"><article><b>Por que entrou no Top 10</b>{plan.reasons.length ? <ul>{plan.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p>Combinação quantitativa favorável no conjunto disponível.</p>}</article><article><b>O que pode invalidar</b>{plan.cautions.length ? <ul>{plan.cautions.map((caution) => <li key={caution}>{caution}</li>)}</ul> : <p>Nenhum alerta quantitativo adicional foi acionado.</p>}</article></div></> : <div className="lite-error">Histórico insuficiente para calcular plano operacional sem inventar níveis.</div>}<footer><span>ref. técnica {dateBR(row.technicalReferenceDate)} · cobertura {row.coverage}%</span><button onClick={() => setSelectedTicker(row.asset.ticker)}>Ver análise completa →</button></footer></article>; })}</section>{!topSwing.length && <div className="lite-error">Ainda não há histórico técnico suficiente para montar o Top 10 desta janela. O ranking não inventa dados ausentes.</div>}</div>}

    {page === "portfolio" && <div className="lite-page"><section className="lite-section-head"><div><span>CARTEIRA</span><h1>Carteira e disputa N+2</h1><p>Quando um preço muda, somente as posições daquele ticker são reprocessadas na disputa. A seleção da IA fica congelada após o início.</p></div></section><PortfolioManager assets={assets} asOf={asOf} changedTickers={changedTickers} /></div>}

    {selected && selectedAnalysis && <div className="lite-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelectedTicker(null)}><section className="lite-modal lite-modal-analysis"><header><div><span>{selected.kind === "unit" ? "UNIT" : "AÇÃO"}</span><h2>{selected.ticker}</h2><p>{selected.name || selected.fundamentals?.companyName}</p></div><button onClick={() => setSelectedTicker(null)}>Fechar</button></header><div className="lite-detail-grid"><article><span>Preço atual</span><b>{money(selected.price)}</b></article><article><span>Variação</span><b>{pct(selected.changepct)}</b></article><article><span>Score fundamental</span><b>{scoreOf(selected) ?? "N/D"}</b></article><article><span>Confiança</span><b>{confidenceOf(selected) == null ? "N/D" : `${confidenceOf(selected)}%`}</b></article><article><span>Momentum</span><b>{selectedAnalysis.components?.momentum?.value == null ? "N/D" : Math.round(selectedAnalysis.components.momentum.value)}</b></article><article><span>Risco</span><b>{selectedAnalysis.components?.risk?.value == null ? "N/D" : Math.round(selectedAnalysis.components.risk.value)}</b></article><article><span>P/L</span><b>{selected.fundamentals?.pe?.toLocaleString?.("pt-BR", { maximumFractionDigits: 2 }) ?? "N/D"}</b></article><article><span>ROE</span><b>{selected.fundamentals?.roe == null ? "N/D" : pct(selected.fundamentals.roe)}</b></article></div>{selected.intraday && <p className="lite-live-note">Cotação intradiária aplicada sobre a fotografia oficial. Fonte: {selected.intradaySource || "fonte intradiária configurada"}.</p>}<AssetAnalysisTabs asset={selected} analysis={selectedAnalysis} anomaly={selectedAnomaly} strategy="swing" coreProps={{ asset: selected, assets, anomaly: selectedAnomaly, radar: null, benchmarks }} /></section></div>}
  </main>;
}
