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
  const stocks = assets.filter((asset) => asset.kind !== "fii").length;
  const withFundamentals = assets.filter((asset) => asset.kind !== "fii" && asset.fundamentals?.scores?.overall != null).length;

  return <div className="v2-home simple-home decision-home premium-home">
    <section className="brand-stage">
      <div className="brand-lockup">
        <span className="brand-orbit" aria-hidden="true"><i /><i /><i /></span>
        <div><b>B3 SCORE</b><small>RADAR INTELIGENTE DE AÇÕES</small></div>
      </div>
      <div className="market-status-pill"><i className={loading ? "loading" : "live"} /><span>{status}</span></div>
    </section>

    <section className="simple-hero decision-home-hero premium-home-hero">
      <div>
        <span className="v2-kicker">MENOS RUÍDO. MAIS DECISÃO.</span>
        <h1>Encontre ações que<br/><em>merecem atenção.</em></h1>
        <p>Escolha uma estratégia, deixe o modelo filtrar o mercado e receba uma leitura simples: nota de 0 a 100, COMPRA ou VENDA e os motivos principais.</p>
        <div className="home-rule"><span><b>70–100</b> COMPRA</span><i/><span><b>0–69</b> VENDA</span></div>
      </div>
      <aside className="home-market-panel">
        <div><span>Ações monitoradas</span><b>{stocks || "—"}</b></div>
        <div><span>Com fundamentos</span><b>{withFundamentals || "—"}</b></div>
        <div><span>Pregão</span><b>{asOf.stockPriceAsOf ?? "N/D"}</b></div>
        <small>FIIs {asOf.fiiPriceAsOf ?? "N/D"}</small>
      </aside>
    </section>

    <section className="home-strategies">
      <header><span>ESCOLHA COMO QUER INVESTIR</span><h2>Uma régua diferente para cada objetivo.</h2></header>
      <div>
        <button onClick={() => onNavigate("swing")}><i>↗</i><b>Swing Trade</b><span>2–6 meses</span><p>Mais peso para timing e momentum, sem abandonar fundamentos.</p></button>
        <button onClick={() => onNavigate("swing")}><i>◆</i><b>Longo Prazo</b><span>Qualidade + valor</span><p>Prioriza fundamentos, crescimento, valuation e risco estrutural.</p></button>
        <button onClick={() => onNavigate("swing")}><i>◌</i><b>Dividendos</b><span>Renda recorrente</span><p>Busca qualidade financeira e proventos sustentáveis.</p></button>
      </div>
    </section>

    <section className="simple-search premium-search">
      <label><span>Analisar uma ação</span><div><input aria-label="Pesquisar ativo" value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} onKeyDown={(event) => event.key === "Enter" && open()} placeholder="Digite um ticker, ex.: PETR4" autoComplete="off"/><button onClick={() => open()} disabled={!assets.some((asset) => asset.ticker === ticker.trim().toUpperCase())}>Analisar</button></div></label>
      {matches.length > 0 && <div className="v2-search-results">{matches.map((asset) => <button key={asset.ticker} onClick={() => open(asset.ticker)}><b>{asset.ticker}</b><span>{asset.name}</span><em>{asset.price?.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</em></button>)}</div>}
    </section>

    <section className="decision-home-actions premium-actions">
      <button className="primary" onClick={() => onNavigate("swing")}><span><small>RADAR</small><b>Top 20 → Top 4</b><em>Filtre o universo e veja as melhores leituras do modelo.</em></span><strong>→</strong></button>
      <button onClick={() => onNavigate("portfolio")}><span><small>CARTEIRA</small><b>Acompanhe sua tese</b><em>Preço médio, resultado, tempo e motivo da entrada.</em></span><strong>→</strong></button>
    </section>

    <details className="decision-home-more"><summary>Ferramentas avançadas</summary><div><button onClick={() => onNavigate("analyze")}>Análise completa</button><button onClick={() => onNavigate("compare")}>Comparar ativos</button><button onClick={() => onNavigate("methodology")}>Metodologia</button><button onClick={() => onNavigate("advanced")}>Outras ferramentas</button></div></details>
  </div>;
}
