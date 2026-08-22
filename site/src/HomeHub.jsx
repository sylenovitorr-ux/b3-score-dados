import { useEffect, useMemo, useState } from "react";
import "./usability-v3.css";

export default function HomeHub({ assets, statusText, asOf, loading, onNavigate, onOpenAsset }) {
  const [ticker, setTicker] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const matches = useMemo(() => {
    const term = ticker.trim().toUpperCase();
    return term ? assets.filter((asset) => asset.ticker.includes(term) || asset.name?.toUpperCase().includes(term)).slice(0, 6) : [];
  }, [assets, ticker]);

  useEffect(() => {
    if (!loading) return undefined;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [loading]);

  const open = (value = ticker) => {
    const exact = assets.find((asset) => asset.ticker === value.trim().toUpperCase());
    if (exact) onOpenAsset(exact.ticker);
  };

  const status = loading ? `Atualizando… ${elapsedSeconds}s` : statusText;

  return <div className="v2-home simple-home decision-home">
    <section className="simple-hero decision-home-hero">
      <div>
        <span className="v2-kicker">B3 SCORE • ATÉ 6 MESES</span>
        <h1>Nota simples.<br/>Decisão clara.</h1>
        <p>O app lê fundamentos, valuation, timing e risco, monta o Top 20 e destaca até 4 ações. Nota 70 ou mais = COMPRA. Abaixo de 70 = VENDA.</p>
      </div>
      <aside><b>{status}</b><span>{assets.length || "—"} ativos monitorados</span><small>Ações {asOf.stockPriceAsOf ?? "N/D"} • FIIs {asOf.fiiPriceAsOf ?? "N/D"}</small></aside>
    </section>

    <section className="simple-search">
      <label><span>Analisar um ativo</span><div><input aria-label="Pesquisar ativo" value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} onKeyDown={(event) => event.key === "Enter" && open()} placeholder="Ex.: PETR4" autoComplete="off"/><button onClick={() => open()} disabled={!assets.some((asset) => asset.ticker === ticker.trim().toUpperCase())}>Abrir</button></div></label>
      {matches.length > 0 && <div className="v2-search-results">{matches.map((asset) => <button key={asset.ticker} onClick={() => open(asset.ticker)}><b>{asset.ticker}</b><span>{asset.name}</span><em>{asset.price?.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</em></button>)}</div>}
    </section>

    <section className="decision-home-actions">
      <button className="primary" onClick={() => onNavigate("swing")}><span><small>1</small><b>Radar 6M</b><em>Top 20 fundamentalistas, Top 4 e sinal COMPRA/VENDA.</em></span><strong>→</strong></button>
      <button onClick={() => onNavigate("portfolio")}><span><small>2</small><b>Minha carteira</b><em>Preço médio, resultado e tempo na posição.</em></span><strong>→</strong></button>
    </section>

    <details className="decision-home-more"><summary>Ferramentas avançadas</summary><div><button onClick={() => onNavigate("analyze")}>Análise completa</button><button onClick={() => onNavigate("compare")}>Comparar ativos</button><button onClick={() => onNavigate("methodology")}>Metodologia</button><button onClick={() => onNavigate("advanced")}>Outras ferramentas</button></div></details>
  </div>;
}
