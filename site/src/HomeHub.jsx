import { useMemo, useState } from "react";
import { formatCompactMoney } from "./formatters";

const QUICK_ACTIONS = [
  ["radar", "◉", "Ver o mercado agora", "Altas, quedas e movimentos que merecem atenção."],
  ["analyze", "⌕", "Analisar uma ação", "Histórico diário, COMPRA/VENDA, níveis e fundamentos."],
  ["heatmap", "▦", "Abrir mapa de calor", "Encontre rapidamente os setores e ativos em movimento."],
  ["portfolio", "▤", "Minha carteira", "Acompanhe posições, concentração e desempenho."],
];

const MORE = [
  ["compare", "Comparar ativos"], ["opportunities", "Oportunidades"], ["swing", "Candidatas 3–6 meses"],
  ["options", "Opções"], ["simulator", "Simuladores"], ["quant", "Central Quant"],
  ["integrity", "Integridade"], ["methodology", "Metodologia"], ["advanced", "Todas as ferramentas"],
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

  return <div className="v2-home simple-home">
    <section className="simple-hero">
      <div><span className="v2-kicker">B3 SCORE</span><h1>O que você quer fazer?</h1><p>Pesquise uma ação ou escolha uma das quatro tarefas principais.</p></div>
      <aside><b>{loading ? "Atualizando…" : statusText}</b><span>{shown(assets.length)} ativos monitorados</span><small>Ações {asOf.stockPriceAsOf ?? "N/D"} • FIIs {asOf.fiiPriceAsOf ?? "N/D"}</small></aside>
    </section>

    <section className="simple-search">
      <label><span>Digite o código da ação</span><div><input aria-label="Pesquisar ativo" value={ticker} onChange={(event) => setTicker(event.target.value.toUpperCase())} onKeyDown={(event) => event.key === "Enter" && open()} placeholder="Ex.: PETR4" autoComplete="off"/><button onClick={() => open()} disabled={!assets.some((asset) => asset.ticker === ticker.trim().toUpperCase())}>Abrir análise</button></div></label>
      {matches.length > 0 && <div className="v2-search-results">{matches.map((asset) => <button key={asset.ticker} onClick={() => open(asset.ticker)}><b>{asset.ticker}</b><span>{asset.name}</span><em>{asset.price?.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</em></button>)}</div>}
    </section>

    <section className="simple-actions">{QUICK_ACTIONS.map(([page, icon, title, text]) => <button key={page} onClick={() => onNavigate(page)}><i>{icon}</i><span><b>{title}</b><small>{text}</small></span><em>→</em></button>)}</section>

    <section className="simple-market"><article><span>Ações/units</span><b>{shown(market.stocks)}</b></article><article><span>FIIs</span><b>{shown(market.fiis)}</b></article><article><span>Com dados CVM</span><b>{shown(market.covered)}</b></article><article><span>Volume monitorado</span><b>{shown(formatCompactMoney(assets.reduce((sum, asset) => sum + (asset.volume || 0), 0)))}</b></article></section>

    <details className="simple-more"><summary>Mais ferramentas <span>⌄</span></summary><div>{MORE.map(([page, title]) => <button key={page} onClick={() => onNavigate(page)}>{title}<span>→</span></button>)}</div></details>
  </div>;
}
