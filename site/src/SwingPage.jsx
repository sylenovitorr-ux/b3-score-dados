import { useMemo, useState } from "react";
import { fairValueRange } from "./opportunity-engine.js";
import { buildQuantAnalysis } from "./quant/quant-engine.js";
import { buildBuySellScore } from "./analysis/buy-sell-score.js";
import "./SwingPage.css";

const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value) => value == null ? "N/D" : `${value > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const ten = (value) => value == null ? "N/D" : `${Math.round(value / 10)}/10`;
const riskLabel = (risk) => risk == null ? "N/D" : risk >= 70 ? "baixo" : risk >= 45 ? "médio" : "alto";
const STRATEGY_KEY = "b3-score-radar-strategy-v1";

const STRATEGY_COPY = {
  swing: { label: "Swing Trade", eyebrow: "2–6 MESES", title: "Timing para capturar assimetria.", text: "Fundamentos continuam sendo filtro, mas o radar dá mais peso a timing e momentum para encontrar entradas melhores.", metric: "Timing" },
  long: { label: "Longo Prazo", eyebrow: "QUALIDADE + VALOR", title: "Empresas fortes por preços razoáveis.", text: "Prioriza fundamentos, valuation, crescimento e risco estrutural. O foco é qualidade que pode atravessar ciclos.", metric: "Crescimento" },
  dividends: { label: "Dividendos", eyebrow: "RENDA RECORRENTE", title: "Renda com sustentabilidade.", text: "Dá mais peso à qualidade financeira e ao bloco de dividendos. O objetivo é evitar yield alto sustentado por negócio frágil.", metric: "Dividendos" },
};

export default function SwingPage({ assets, anomalies, onBack, onOpen }) {
  const [filter, setFilter] = useState("top20");
  const [strategy, setStrategy] = useState(() => {
    const saved = localStorage.getItem(STRATEGY_KEY);
    return STRATEGY_COPY[saved] ? saved : "swing";
  });
  const copy = STRATEGY_COPY[strategy];
  const chooseStrategy = (id) => { localStorage.setItem(STRATEGY_KEY, id); setStrategy(id); setFilter("top20"); };

  const ranking = useMemo(() => assets
    .filter((asset) => asset.kind !== "fii" && asset.fundamentals?.scores?.overall != null)
    .map((asset) => {
      const anomaly = anomalies?.assets?.[asset.ticker];
      const quant = buildQuantAnalysis(asset, assets, anomaly, strategy === "swing" ? "swing_3_6m" : "long_term");
      const score = buildBuySellScore({ asset, analysis: quant, strategy });
      const fair = fairValueRange(asset);
      const potential = fair?.base && asset.price ? (fair.base / asset.price - 1) * 100 : null;
      return { asset, quant, score, fair, potential };
    })
    .filter(({ score }) => score.score != null)
    .sort((a, b) => {
      const coreGap = (b.score.coreScore ?? -1) - (a.score.coreScore ?? -1);
      return coreGap || (b.score.score ?? -1) - (a.score.score ?? -1);
    }), [assets, anomalies, strategy]);

  const top20 = useMemo(() => ranking.slice(0, 20), [ranking]);
  const top4 = useMemo(() => [...top20].filter((row) => row.score.signal === "buy").sort((a, b) => (b.score.score ?? -1) - (a.score.score ?? -1)).slice(0, 4), [top20]);
  const rows = useMemo(() => filter === "top4" ? top4 : filter === "buy" ? ranking.filter((row) => row.score.signal === "buy") : filter === "sell" ? ranking.filter((row) => row.score.signal === "sell") : filter === "all" ? ranking : top20, [filter, ranking, top20, top4]);
  const top4Set = useMemo(() => new Set(top4.map((row) => row.asset.ticker)), [top4]);
  const buyCount = ranking.filter((row) => row.score.signal === "buy").length;
  const sellCount = ranking.filter((row) => row.score.signal === "sell").length;

  return <div className="swing-page decision-radar">
    <div className="daily-radar-top"><button className="back-btn" onClick={onBack}>← Início</button><span>RADAR B3 SCORE</span></div>
    <section className="strategy-switcher" aria-label="Escolher estratégia">{Object.entries(STRATEGY_COPY).map(([id, item]) => <button key={id} className={strategy === id ? "active" : ""} onClick={() => chooseStrategy(id)}><span>{item.eyebrow}</span><b>{item.label}</b></button>)}</section>
    <section className="swing-hero decision-hero premium-hero"><div><span>{copy.eyebrow}</span><h1>{copy.title}</h1><p>{copy.text}</p><div className="hero-rule"><b>70+</b><span>COMPRA</span><i /><b>0–69</b><span>VENDA</span></div></div><aside><div><span>Universo</span><b>{ranking.length}</b></div><div><span>Compra</span><b>{buyCount}</b></div><div><span>Venda</span><b>{sellCount}</b></div><div><span>Top picks</span><b>{top4.length}/4</b></div></aside></section>
    <section className="top4-strip premium-top4"><div className="top4-heading"><span>TOP PICKS • {copy.label.toUpperCase()}</span><h2>As melhores entre as 20.</h2><p>Shortlist do modelo. A decisão final continua sendo do usuário.</p></div><div className="top4-grid">{top4.map(({ asset, score, potential }, index) => <button key={asset.ticker} className="top4-card" onClick={() => onOpen(asset.ticker)}><span className="rank">#{index + 1}</span><div><strong>{asset.ticker}</strong><small>{asset.name}</small></div><em>COMPRA</em><b>{score.score}/100</b><small>{money(asset.price)} • {potential == null ? "valor justo N/D" : `${pct(potential)} até valor justo`}</small></button>)}{!top4.length && <p className="quant-empty">Nenhuma das 20 melhores atingiu 70 pontos nesta estratégia.</p>}</div></section>
    <section className="decision-filters"><button className={filter === "top20" ? "active" : ""} onClick={() => setFilter("top20")}>Top 20</button><button className={filter === "top4" ? "active" : ""} onClick={() => setFilter("top4")}>Top 4</button><button className={filter === "buy" ? "active" : ""} onClick={() => setFilter("buy")}>COMPRA ≥ 70</button><button className={filter === "sell" ? "active" : ""} onClick={() => setFilter("sell")}>VENDA &lt; 70</button><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Todas</button></section>
    <section className="decision-grid">{rows.map(({ asset, score, fair, potential }) => { const fourthMetric = strategy === "long" ? score.growth : strategy === "dividends" ? score.dividends : score.momentum; return <button className={`decision-card ${score.tone} ${top4Set.has(asset.ticker) ? "top-pick" : ""}`} key={asset.ticker} onClick={() => onOpen(asset.ticker)}><div className="decision-card-top"><div><strong>{asset.ticker}</strong><span>{asset.name}</span></div><em>{score.label}</em></div><div className="decision-price"><b>{money(asset.price)}</b><span>Nota {score.score}/100</span></div><div className="score-meter"><i style={{ width: `${score.score}%` }} /></div><div className="decision-fair"><span>Valor justo estimado</span><b>{money(fair?.base)}</b><small>{potential == null ? "potencial indisponível" : `potencial ${pct(potential)}`}</small></div><div className="decision-metrics"><article><span>Fundamentos</span><b>{ten(score.fundamentalScore)}</b></article><article><span>Valuation</span><b>{ten(score.valuation)}</b></article><article><span>{copy.metric}</span><b>{ten(fourthMetric)}</b></article><article><span>Risco</span><b>{riskLabel(score.risk)}</b></article></div><footer><span>{top4Set.has(asset.ticker) ? "TOP 4" : copy.label}</span><b>{top4Set.has(asset.ticker) ? "Destaque" : score.horizon}</b><i>Ver análise →</i></footer></button>; })}</section>
    {!rows.length && <p className="quant-empty">Nenhum ativo atende a este filtro com os dados disponíveis.</p>}
    <details className="decision-method"><summary>Como esta estratégia calcula a nota</summary><p>{ranking[0]?.score.formula || "A nota usa apenas indicadores disponíveis e não transforma ausência de dado em zero."}. Nota 70 ou mais mostra COMPRA; abaixo de 70 mostra VENDA. Sem dados mínimos, o ativo fica NÃO AVALIÁVEL.</p></details>
  </div>;
}
