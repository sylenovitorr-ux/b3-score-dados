const TOOLS = [
  ["swing", "Candidatas para 3–6 meses", "Seleção quantitativa de ações para investigar no médio prazo; não é recomendação.", "↗"],
  ["heatmap", "Mapa de calor", "Variação por grupo, liquidez e status explícito de cotação intradiária ou fechamento.", "▦"],
  ["integrity", "Movimentos e integridade", "Movimentos atípicos e anomalias para investigar; não são acusações de fraude.", "◎"],
  ["quant", "Central Quant", "Risco, estatística, indicadores e auditoria quantitativa.", "∑"],
  ["options", "Opções", "Contratos, gregas, volatilidade implícita e payoff para estudo educacional.", "◉"],
  ["simulator", "Simuladores", "Tamanho de posição, risco, alvo, aportes e cenários.", "▤"],
  ["methodology", "Metodologia", "Fontes, fórmulas, pesos, limitações e como auditar cada leitura.", "ⓘ"],
];

export default function AdvancedToolsPage({ onBack, onNavigate }) {
  return <main className="v2-page advanced-tools-page">
    <header className="v2-page-head"><button onClick={onBack}>← Início</button><div><span>APROFUNDAMENTO</span><h1>Ferramentas Avançadas</h1><p>Recursos especializados preservados fora do fluxo principal de aporte. Use-os para aprofundar uma hipótese, não para substituir qualidade, preço, risco e evidências.</p></div></header>
    <section className="v2-safety"><b>Fluxo principal</b><span>Radar → Oportunidades → Análise do ativo → Comparador → Carteira. Estas ferramentas entram depois, quando houver uma tese para testar.</span></section>
    <section className="v2-nav-grid" aria-label="Ferramentas avançadas">{TOOLS.map(([page, title, text, icon]) => <button key={page} onClick={() => onNavigate(page)}><i>{icon}</i><span><b>{title}</b><small>{text}</small></span><em>→</em></button>)}</section>
  </main>;
}
