import { useMemo, useState } from "react";
import { formatCompactMoney } from "./formatters";

const GROUPS = [
  ["Análises complementares", [["swing", "Swing 3–6M", "Filtro separado de qualidade e timing", "↗"], ["compare", "Comparador", "Ativos lado a lado e performance base 100", "⇄"], ["quant", "Central Quant", "Risco, momentum, estatística e auditoria", "∑"], ["integrity", "Integridade", "Movimentos atípicos para investigar, sem acusação", "◎"]]],
  ["Planejamento e estudo", [["simulator", "Simuladores", "Risco, alvo, aportes e cenários", "▤"], ["options", "Opções", "Contratos, gregas, IV e payoff", "◉"], ["portfolio", "Carteira", "Posições, exposição e concentração", "▦"], ["methodology", "Metodologia", "Fontes, fórmulas, limitações e guia de uso", "ⓘ"]]],
];

const JOURNEY = [
  ["radar", "1", "Radar diário", "Comece pelo que mudou no último pregão. É triagem de curto prazo, não valuation."],
  ["opportunities", "2", "Valuation", "Verifique preço justo, margem de segurança, qualidade e sensibilidade do modelo."],
  ["analyze", "3", "Análise do ativo", "Abra fontes, indicadores, gráficos, entrada, saída e prazo mínimo de reavaliação."],
  ["portfolio", "4", "Carteira", "Decida o tamanho da posição pelos riscos, concentração e objetivos da carteira."],
];

export default function HomeHub({ assets, market, statusText, asOf, loading, onNavigate, onOpenAsset }) {
  const [ticker, setTicker] = useState("");
  const matches = useMemo(() => {
    const term = ticker.trim().toUpperCase();
    return term ? assets.filter((asset) => asset.ticker.includes(term) || asset.name?.toUpperCase().includes(term)).slice(0, 6) : [];
  }, [assets, ticker]);
  const open = (value = ticker) => {
    const exact = assets.find((asset) => asset.ticker === value.trim().toUpperCase());
    if (exact) onOpenAsset(exact.ticker);
  };
  const shown = (value) => loading && !assets.length ? "—" : value;
  return <div className="v2-home">
    <section className="v2-home-hero"><div><span className="v2-kicker">CENTRAL DE ANÁLISE B3</span><h1>Entenda primeiro.<br /><em>Decida depois.</em></h1><p>Dados reais, cálculos reproduzíveis e ferramentas separadas para analisar ações, FIIs e opções.</p></div><aside aria-live="polite"><span>{loading ? "Atualizando fontes…" : statusText}</span><b>{shown(assets.length)}</b><small>{loading && !assets.length ? "carregando universo" : "ativos monitorados"}</small><i>Ações {asOf.stockPriceAsOf ?? "N/D"} • FIIs {asOf.fiiPriceAsOf ?? "N/D"}</i></aside></section>
    <section className="v2-search"><label><span>Pesquisar ativo</span><div><input aria-label="Pesquisar ativo na central" value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} onKeyDown={(event) => event.key === "Enter" && open()} placeholder="PETR4, BBSE3, HGLG11..."/><button onClick={() => open()} disabled={!assets.some((asset) => asset.ticker === ticker.trim().toUpperCase())}>Analisar →</button></div></label>{matches.length > 0 && <div className="v2-search-results">{matches.map((asset) => <button key={asset.ticker} onClick={() => open(asset.ticker)}><b>{asset.ticker}</b><span>{asset.name}</span><em>{asset.price?.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</em></button>)}</div>}</section>
    <section className="v2-market-strip" aria-label="Cobertura carregada"><article><span>Ações/units</span><b>{shown(market.stocks)}</b></article><article><span>FIIs</span><b>{shown(market.fiis)}</b></article><article><span>Com CVM</span><b>{shown(market.covered)}</b></article><article><span>Volume monitorado</span><b>{shown(formatCompactMoney(assets.reduce((sum, asset) => sum + (asset.volume || 0), 0)))}</b></article></section>
    <section className="v2-journey"><div className="v2-section-title"><span>FLUXO RECOMENDADO</span><h2>Use cada ferramenta no momento certo</h2><p>Radar responde “o que mudou?”. Valuation responde “o preço faz sentido?”. Eles se complementam.</p></div><ol>{JOURNEY.map(([page, step, title, text]) => <li key={page}><button onClick={() => onNavigate(page)}><i>{step}</i><span><b>{title}</b><small>{text}</small></span><em>→</em></button></li>)}</ol></section>
    {GROUPS.map(([title, items]) => <section className="v2-hub-group" key={title}><div className="v2-section-title"><h2>{title}</h2></div><div className="v2-nav-grid">{items.map(([page, label, text, icon]) => <button key={page} onClick={() => onNavigate(page)}><i>{icon}</i><span><b>{label}</b><small>{text}</small></span><em>→</em></button>)}</div></section>)}
    <section className="v2-safety"><b>Sem dados inventados</b><span>Ausências permanecem como “Dado indisponível”. Score e preço justo apoiam o estudo, não são ordens de investimento.</span></section>
  </div>;
}
