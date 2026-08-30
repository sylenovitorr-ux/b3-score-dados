import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PortfolioManager from "./PortfolioManager.jsx";
import { normalizeAsset } from "./data/normalize-asset.js";
import { applyIntradayQuotesIncremental, normalizeIntraday } from "./data/intraday.js";
import { freshness } from "./quant/data-quality.js";
import "./AppLite.css";

const STOCK_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/b3-fundamentals.json";
const INTRADAY_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/intraday.json";
const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value) => value == null ? "N/D" : `${Number(value) > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const dateBR = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR") : "N/D";
const scoreOf = (asset) => asset?.fundamentals?.scores?.overall ?? null;
const confidenceOf = (asset) => asset?.fundamentals?.scores?.confidence ?? null;
function currentSaoPauloDate() { const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day}`; }

export default function AppLite() {
  const [assets, setAssets] = useState([]);
  const assetsRef = useRef([]);
  const [intraday, setIntraday] = useState(null);
  const [changedTickers, setChangedTickers] = useState([]);
  const [page, setPage] = useState("home");
  const [query, setQuery] = useState("");
  const [selectedTicker, setSelectedTicker] = useState(null);
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
      await loadIntraday(rows);
    } catch (err) { setError(err?.message || "Não foi possível carregar os dados."); }
    finally { setLoading(false); }
  }, [loadIntraday, publishAssets]);

  useEffect(() => { void loadAll(); }, [loadAll]);
  useEffect(() => { const timer = window.setInterval(() => { if (!document.hidden) void loadIntraday(); }, 60_000); return () => window.clearInterval(timer); }, [loadIntraday]);

  const filtered = useMemo(() => { const term = query.trim().toUpperCase(); return assets.filter((asset) => !term || asset.ticker.includes(term) || asset.name?.toUpperCase().includes(term) || asset.fundamentals?.companyName?.toUpperCase().includes(term)).sort((a, b) => (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1)); }, [assets, query]);
  const selected = useMemo(() => assets.find((asset) => asset.ticker === selectedTicker) ?? null, [assets, selectedTicker]);
  const officialFreshness = useMemo(() => freshness(asOf.stockPriceAsOf, "price"), [asOf.stockPriceAsOf]);
  const liveCount = assets.filter((asset) => asset.intraday).length;
  const units = assets.filter((asset) => asset.kind === "unit").length;
  const stocks = assets.length - units;

  return <main className="lite-app">
    <header className="lite-topbar"><button className="lite-brand" onClick={() => setPage("home")}><b>B3</b><span>Score</span></button><nav><button className={page === "home" ? "active" : ""} onClick={() => setPage("home")}>Início</button><button className={page === "stocks" ? "active" : ""} onClick={() => setPage("stocks")}>Ações</button><button className={page === "portfolio" ? "active" : ""} onClick={() => setPage("portfolio")}>Carteira</button></nav><button className="lite-refresh" disabled={loading} onClick={() => void loadAll()}>{loading ? "Atualizando…" : "Atualizar"}</button></header>
    {page === "home" && <div className="lite-page"><section className="lite-hero"><div><span>FOCO: AÇÕES B3</span><h1>Preço, análise, carteira e disputa.</h1><p>Sem FIIs e sem opções. O fechamento oficial forma a base e cada nova fotografia intradiária atualiza somente os ativos que realmente mudaram.</p></div><div className="lite-status"><article><span>Data atual</span><b>{dateBR(currentSaoPauloDate())}</b></article><article><span>Último pregão oficial</span><b>{dateBR(asOf.stockPriceAsOf)}</b></article><article><span>Situação</span><b>{officialFreshness.label}</b></article><article><span>Intraday ativo</span><b>{liveCount} ativos</b></article></div></section>{error && <div className="lite-error">{error}</div>}<section className="lite-kpis"><article><span>Ações</span><b>{stocks}</b></article><article><span>Units</span><b>{units}</b></article><article><span>Alterados no último ciclo</span><b>{changedTickers.length}</b></article><article><span>Última consulta</span><b>{lastRefresh ? lastRefresh.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "N/D"}</b></article></section><section className="lite-actions"><button onClick={() => setPage("stocks")}><b>Analisar ações</b><span>Pesquisar, ordenar por score e abrir fundamentos.</span></button><button onClick={() => setPage("portfolio")}><b>Carteira e disputa</b><span>Comprar, vender e competir contra a IA N+2.</span></button></section></div>}
    {page === "stocks" && <div className="lite-page"><section className="lite-section-head"><div><span>AÇÕES E UNITS</span><h1>Universo monitorado</h1><p>Preço, carteira e disputa reagem somente quando a cotação recebida muda.</p></div><label>Pesquisar<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="PETR4, VALE3, SANB11..." /></label></section><section className="lite-stock-grid">{filtered.map((asset) => <button key={asset.ticker} className="lite-stock" onClick={() => setSelectedTicker(asset.ticker)}><div><b>{asset.ticker}</b><small>{asset.kind === "unit" ? "UNIT" : "AÇÃO"}{asset.intraday ? " · INTRADAY" : ""}</small></div><strong>{money(asset.price)}</strong><span className={(asset.changepct ?? 0) >= 0 ? "positive" : "negative"}>{pct(asset.changepct)}</span><em>Score {scoreOf(asset) ?? "N/D"}</em></button>)}</section></div>}
    {page === "portfolio" && <div className="lite-page"><section className="lite-section-head"><div><span>CARTEIRA</span><h1>Carteira e disputa N+2</h1><p>Quando um preço muda, o novo objeto do ativo chega automaticamente aos motores de carteira e disputa.</p></div></section><PortfolioManager assets={assets} asOf={asOf} /></div>}
    {selected && <div className="lite-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelectedTicker(null)}><section className="lite-modal"><header><div><span>{selected.kind === "unit" ? "UNIT" : "AÇÃO"}</span><h2>{selected.ticker}</h2><p>{selected.name || selected.fundamentals?.companyName}</p></div><button onClick={() => setSelectedTicker(null)}>Fechar</button></header><div className="lite-detail-grid"><article><span>Preço atual</span><b>{money(selected.price)}</b></article><article><span>Variação</span><b>{pct(selected.changepct)}</b></article><article><span>Score</span><b>{scoreOf(selected) ?? "N/D"}</b></article><article><span>Confiança</span><b>{confidenceOf(selected) == null ? "N/D" : `${confidenceOf(selected)}%`}</b></article><article><span>P/L</span><b>{selected.fundamentals?.pe?.toLocaleString?.("pt-BR", { maximumFractionDigits: 2 }) ?? "N/D"}</b></article><article><span>P/VP</span><b>{selected.fundamentals?.pb?.toLocaleString?.("pt-BR", { maximumFractionDigits: 2 }) ?? "N/D"}</b></article><article><span>ROE</span><b>{selected.fundamentals?.roe == null ? "N/D" : pct(selected.fundamentals.roe)}</b></article><article><span>Referência CVM</span><b>{dateBR(selected.fundamentals?.referenceDate)}</b></article></div>{selected.intraday && <p className="lite-live-note">Cotação intradiária aplicada sobre a fotografia oficial. Fonte: {selected.intradaySource || "fonte intradiária configurada"}.</p>}</section></div>}
  </main>;
}
