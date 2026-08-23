import { useEffect, useMemo, useState } from "react";
import PortfolioCore from "./PortfolioCore.jsx";
import BattleArena from "./BattleArena.jsx";
import "./PortfolioManager.css";
import "./PortfolioWorkspace.css";

const KEY = "b3-score-portfolios-v6";
const finite = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value) => value == null ? "N/D" : `${Number(value) > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const daysBetween = (start, end) => start && end ? Math.max(0, Math.floor((new Date(`${end}T12:00:00`) - new Date(`${start}T12:00:00`)) / 86400000)) : null;

function loadPortfolios() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "null");
    return Array.isArray(parsed?.portfolios) ? parsed.portfolios : [];
  } catch {
    return [];
  }
}

function ClosedTradeEditor() {
  const [portfolios, setPortfolios] = useState(() => loadPortfolios());
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    const onFocus = () => setPortfolios(loadPortfolios());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const trades = useMemo(() => portfolios.flatMap((portfolio) => (portfolio.closedTrades ?? []).map((trade) => ({ portfolioId: portfolio.id, portfolioName: portfolio.name, trade }))).sort((a, b) => String(b.trade.exitDate ?? "").localeCompare(String(a.trade.exitDate ?? ""))), [portfolios]);

  const edit = (row) => {
    setSelected(row);
    setDraft({ ...row.trade, editReason: "" });
  };

  const save = () => {
    if (!selected || !draft) return;
    const updated = portfolios.map((portfolio) => {
      if (portfolio.id !== selected.portfolioId) return portfolio;
      return {
        ...portfolio,
        closedTrades: (portfolio.closedTrades ?? []).map((trade) => {
          if (trade.id !== selected.trade.id) return trade;
          const entryPrice = finite(draft.entryPrice);
          const exitPrice = finite(draft.exitPrice);
          const quantity = finite(draft.quantity);
          const cost = entryPrice != null && quantity != null ? entryPrice * quantity : finite(draft.cost);
          const value = exitPrice != null && quantity != null ? exitPrice * quantity : finite(draft.value);
          const pnl = cost != null && value != null ? value - cost : finite(draft.pnl);
          const returnPct = entryPrice && exitPrice != null ? (exitPrice / entryPrice - 1) * 100 : finite(draft.returnPct);
          const next = {
            ...trade,
            entryPrice,
            exitPrice,
            quantity,
            entryDate: draft.entryDate || null,
            exitDate: draft.exitDate || null,
            thesis: draft.thesis ?? "",
            invalidation: draft.invalidation ?? "",
            exitReason: draft.exitReason ?? trade.exitReason ?? "",
            cost,
            value,
            pnl,
            returnPct,
            daysHeld: daysBetween(draft.entryDate, draft.exitDate),
            editedAt: new Date().toISOString(),
          };
          next.audit = [...(trade.audit ?? []), {
            at: next.editedAt,
            type: "closed-trade-edit",
            reason: String(draft.editReason || "correção manual").trim(),
            before: { entryPrice: trade.entryPrice, exitPrice: trade.exitPrice, quantity: trade.quantity, entryDate: trade.entryDate, exitDate: trade.exitDate, thesis: trade.thesis, invalidation: trade.invalidation, exitReason: trade.exitReason },
            after: { entryPrice: next.entryPrice, exitPrice: next.exitPrice, quantity: next.quantity, entryDate: next.entryDate, exitDate: next.exitDate, thesis: next.thesis, invalidation: next.invalidation, exitReason: next.exitReason },
          }];
          return next;
        }),
      };
    });
    setPortfolios(updated);
    localStorage.setItem(KEY, JSON.stringify({ version: 6, portfolios: updated }));
    setSelected(null);
    setDraft(null);
  };

  return <section className="closed-editor">
    <header><span>OPERAÇÕES ENCERRADAS</span><h2>Edite sem apagar o passado.</h2><p>Qualquer correção guarda o valor anterior, data e motivo da alteração.</p></header>
    {trades.length ? <div className="closed-editor-list">{trades.map((row) => <article key={`${row.portfolioId}-${row.trade.id}`}><div><strong>{row.trade.ticker}</strong><small>{row.portfolioName}</small></div><span>Entrada<b>{money(row.trade.entryPrice)}</b><small>{row.trade.entryDate ?? "N/D"}</small></span><span>Saída<b>{money(row.trade.exitPrice)}</b><small>{row.trade.exitDate ?? "N/D"}</small></span><span>Resultado<b className={row.trade.returnPct == null ? "" : row.trade.returnPct >= 0 ? "positive" : "negative"}>{pct(row.trade.returnPct)}</b></span><span>Alterações<b>{row.trade.audit?.length ?? 0}</b></span><button onClick={() => edit(row)}>Editar</button></article>)}</div> : <p className="portfolio-empty-state">Nenhuma posição encerrada ainda.</p>}

    {selected && draft && <div className="closed-editor-backdrop"><section className="closed-editor-modal" role="dialog" aria-modal="true"><header><div><span>EDITAR OPERAÇÃO</span><h3>{selected.trade.ticker}</h3></div><button onClick={() => { setSelected(null); setDraft(null); }}>Fechar</button></header><div className="closed-editor-grid"><label>Preço de entrada<input type="number" step="0.01" value={draft.entryPrice ?? ""} onChange={(e) => setDraft({ ...draft, entryPrice: e.target.value })} /></label><label>Data de entrada<input type="date" value={draft.entryDate ?? ""} onChange={(e) => setDraft({ ...draft, entryDate: e.target.value })} /></label><label>Quantidade<input type="number" step="1" value={draft.quantity ?? ""} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} /></label><label>Preço de saída<input type="number" step="0.01" value={draft.exitPrice ?? ""} onChange={(e) => setDraft({ ...draft, exitPrice: e.target.value })} /></label><label>Data de saída<input type="date" value={draft.exitDate ?? ""} onChange={(e) => setDraft({ ...draft, exitDate: e.target.value })} /></label><label>Motivo da saída<input value={draft.exitReason ?? ""} onChange={(e) => setDraft({ ...draft, exitReason: e.target.value })} /></label><label className="wide">Tese<textarea value={draft.thesis ?? ""} onChange={(e) => setDraft({ ...draft, thesis: e.target.value })} /></label><label className="wide">O que invalidava a tese<textarea value={draft.invalidation ?? ""} onChange={(e) => setDraft({ ...draft, invalidation: e.target.value })} /></label><label className="wide">Motivo desta edição<input value={draft.editReason ?? ""} onChange={(e) => setDraft({ ...draft, editReason: e.target.value })} placeholder="Ex.: corrigi o preço de execução da corretora" /></label></div>{selected.trade.audit?.length > 0 && <details className="closed-audit"><summary>Histórico de alterações ({selected.trade.audit.length})</summary>{[...selected.trade.audit].reverse().map((item, index) => <article key={`${item.at}-${index}`}><b>{new Date(item.at).toLocaleString("pt-BR")}</b><span>{item.reason || item.type}</span></article>)}</details>}<footer><button className="primary" onClick={save}>Salvar correção</button></footer></section></div>}
  </section>;
}

export default function PortfolioManager({ assets = [], asOf = {} }) {
  const [tab, setTab] = useState("portfolio");
  const [sourcePortfolios, setSourcePortfolios] = useState(() => loadPortfolios());

  const switchTab = (next) => {
    setSourcePortfolios(loadPortfolios());
    setTab(next);
  };

  return <div className="portfolio-workspace-shell">
    <nav className="portfolio-workspace-tabs" aria-label="Área de carteira"><button className={tab === "portfolio" ? "active" : ""} onClick={() => switchTab("portfolio")}>Carteiras</button><button className={tab === "battle" ? "active" : ""} onClick={() => switchTab("battle")}>Disputa</button><button className={tab === "closed" ? "active" : ""} onClick={() => switchTab("closed")}>Encerradas</button></nav>
    {tab === "portfolio" ? <PortfolioCore assets={assets} asOf={asOf} /> : tab === "battle" ? <BattleArena assets={assets} sourcePortfolios={sourcePortfolios} /> : <ClosedTradeEditor />}
  </div>;
}
