import { useMemo, useState } from "react";
import { formatCompactMoney } from "./formatters";

const GROUPS = [
  ["Visão do mercado", [["radar", "Radar diário", "Movimentos e contexto do último pregão", "⌁"], ["opportunities", "Oportunidades", "Preço, qualidade, risco e confiança", "◇"], ["compare", "Comparador", "Ativos lado a lado e performance base 100", "⇄"]]],
  ["Análise", [["analyze", "Analisar ativo", "Pesquisa, filtros e análise completa", "⌕"], ["quant", "Central Quant", "Valuation, momentum, risco e auditoria", "∑"], ["integrity", "Alertas", "Movimentos estatísticos sem acusação automática", "◎"]]],
  ["Ferramentas", [["simulator", "Simuladores", "Risco, alvo, aportes e cenários", "▤"], ["options", "Opções", "Contratos, gregas, IV e payoff", "◉"], ["portfolio", "Carteira", "Posições, exposição e concentração", "▦"]]],
  ["Aprender", [["methodology", "Metodologia", "Fontes, fórmulas, limitações e guia de uso", "ⓘ"]]],
];

export default function HomeHub({ assets, market, statusText, asOf, onNavigate, onOpenAsset }) {
  const [ticker, setTicker] = useState("");
  const matches = useMemo(() => {
    const term = ticker.trim().toUpperCase();
    return term ? assets.filter((asset) => asset.ticker.includes(term) || asset.name?.toUpperCase().includes(term)).slice(0, 6) : [];
  }, [assets, ticker]);
  const open = (value = ticker) => {
    const exact = assets.find((asset) => asset.ticker === value.trim().toUpperCase());
    if (exact) onOpenAsset(exact.ticker);
  };
  return <div className="v2-home">
    <section className="v2-home-hero"><div><span className="v2-kicker">CENTRAL DE ANÁLISE B3</span><h1>Entenda primeiro.<br /><em>Decida depois.</em></h1><p>Dados reais, cálculos reproduzíveis e ferramentas separadas para analisar ações, FIIs e opções.</p></div><aside><span>{statusText}</span><b>{assets.length || "—"}</b><small>ativos monitorados</small><i>Ações {asOf.stockPriceAsOf ?? "N/D"} • FIIs {asOf.fiiPriceAsOf ?? "N/D"}</i></aside></section>
    <section className="v2-search"><label><span>Pesquisar ativo</span><div><input aria-label="Pesquisar ativo na central" value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} onKeyDown={(event) => event.key === "Enter" && open()} placeholder="PETR4, BBSE3, HGLG11..."/><button onClick={() => open()} disabled={!assets.some((asset) => asset.ticker === ticker.trim().toUpperCase())}>Analisar →</button></div></label>{matches.length > 0 && <div className="v2-search-results">{matches.map((asset) => <button key={asset.ticker} onClick={() => open(asset.ticker)}><b>{asset.ticker}</b><span>{asset.name}</span><em>{asset.price?.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</em></button>)}</div>}</section>
    <section className="v2-market-strip"><article><span>Ações/units</span><b>{market.stocks}</b></article><article><span>FIIs</span><b>{market.fiis}</b></article><article><span>Com CVM</span><b>{market.covered}</b></article><article><span>Volume monitorado</span><b>{formatCompactMoney(assets.reduce((sum, asset) => sum + (asset.volume || 0), 0))}</b></article></section>
    {GROUPS.map(([title, items]) => <section className="v2-hub-group" key={title}><div className="v2-section-title"><h2>{title}</h2></div><div className="v2-nav-grid">{items.map(([page, label, text, icon]) => <button key={page} onClick={() => onNavigate(page)}><i>{icon}</i><span><b>{label}</b><small>{text}</small></span><em>→</em></button>)}</div></section>)}
    <section className="v2-safety"><b>Sem dados inventados</b><span>Ausências permanecem como “Dado indisponível”. Score e preço justo apoiam o estudo, não são ordens de investimento.</span></section>
  </div>;
}
