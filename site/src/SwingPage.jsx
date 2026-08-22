import { useMemo, useState } from "react";
import { fairValueRange } from "./opportunity-engine.js";
import { buildQuantAnalysis } from "./quant/quant-engine.js";
import { buildBuySellScore } from "./analysis/buy-sell-score.js";
import "./SwingPage.css";

const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value) => value == null ? "N/D" : `${value > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const ten = (value) => value == null ? "N/D" : `${Math.round(value / 10)}/10`;
const riskLabel = (risk) => risk == null ? "N/D" : risk >= 70 ? "baixo" : risk >= 45 ? "médio" : "alto";

export default function SwingPage({ assets, anomalies, onBack, onOpen }) {
  const [filter, setFilter] = useState("top20");

  const ranking = useMemo(() => assets
    .filter((asset) => asset.kind !== "fii" && asset.fundamentals?.scores?.overall != null)
    .map((asset) => {
      const anomaly = anomalies?.assets?.[asset.ticker];
      const quant = buildQuantAnalysis(asset, assets, anomaly, "swing_3_6m");
      const score = buildBuySellScore({ asset, analysis: quant });
      const fair = fairValueRange(asset);
      const potential = fair?.base && asset.price ? (fair.base / asset.price - 1) * 100 : null;
      return { asset, quant, score, fair, potential };
    })
    .sort((a, b) => {
      const fundamentalGap = (b.score.fundamentalScore ?? -1) - (a.score.fundamentalScore ?? -1);
      return fundamentalGap || (b.score.score ?? -1) - (a.score.score ?? -1);
    }), [assets, anomalies]);

  const top20 = useMemo(() => ranking.slice(0, 20), [ranking]);
  const top4 = useMemo(() => [...top20]
    .filter((row) => row.score.signal === "buy")
    .sort((a, b) => (b.score.score ?? -1) - (a.score.score ?? -1))
    .slice(0, 4), [top20]);

  const rows = useMemo(() => {
    if (filter === "top4") return top4;
    if (filter === "buy") return ranking.filter((row) => row.score.signal === "buy");
    if (filter === "sell") return ranking.filter((row) => row.score.signal === "sell");
    if (filter === "all") return ranking;
    return top20;
  }, [filter, ranking, top20, top4]);

  const top4Set = useMemo(() => new Set(top4.map((row) => row.asset.ticker)), [top4]);

  return <div className="swing-page decision-radar">
    <div className="daily-radar-top"><button className="back-btn" onClick={onBack}>← Início</button><span>RADAR 6M</span></div>

    <section className="swing-hero decision-hero">
      <div>
        <span>TOP 20 • TOP 4 • ATÉ 6 MESES</span>
        <h1>Escolher melhor.<br /><em>Decidir melhor.</em></h1>
        <p>O app lê as ações com fundamentos disponíveis, separa as 20 mais fortes e destaca até 4 com melhor combinação entre fundamentos, preço, timing, risco e confiança.</p>
      </div>
      <aside><b>{top4.length}/4</b><small>destaques de compra</small><p>Regra única: nota 70 ou mais = COMPRA. Abaixo de 70 = VENDA.</p></aside>
    </section>

    <section className="top4-strip">
      <div className="top4-heading"><span>DESTAQUES DO MODELO</span><h2>As 4 melhores entre as 20.</h2><p>Não é promessa de lucro. É uma shortlist para o usuário decidir onde estudar ou entrar.</p></div>
      <div className="top4-grid">
        {top4.map(({ asset, score, fair, potential }, index) => <button key={asset.ticker} className="top4-card" onClick={() => onOpen(asset.ticker)}>
          <span>#{index + 1}</span><strong>{asset.ticker}</strong><em>COMPRA</em><b>{score.score}/100</b><small>{money(asset.price)} • {potential == null ? "valor justo N/D" : `${pct(potential)} até valor justo`}</small>
        </button>)}
        {!top4.length && <p className="quant-empty">Nenhuma das 20 melhores atingiu 70 pontos agora.</p>}
      </div>
    </section>

    <section className="decision-filters">
      <button className={filter === "top20" ? "active" : ""} onClick={() => setFilter("top20")}>Top 20</button>
      <button className={filter === "top4" ? "active" : ""} onClick={() => setFilter("top4")}>Top 4</button>
      <button className={filter === "buy" ? "active" : ""} onClick={() => setFilter("buy")}>COMPRA ≥ 70</button>
      <button className={filter === "sell" ? "active" : ""} onClick={() => setFilter("sell")}>VENDA &lt; 70</button>
      <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Todas</button>
    </section>

    <section className="decision-grid">
      {rows.map(({ asset, score, fair, potential, quant }) => <button className={`decision-card ${score.tone} ${top4Set.has(asset.ticker) ? "top-pick" : ""}`} key={asset.ticker} onClick={() => onOpen(asset.ticker)}>
        <div className="decision-card-top"><div><strong>{asset.ticker}</strong><span>{asset.name}</span></div><em>{score.label}</em></div>
        <div className="decision-price"><b>{money(asset.price)}</b><span>Nota {score.score == null ? "N/D" : `${score.score}/100`}</span></div>
        <div className="decision-fair"><span>Valor justo estimado</span><b>{money(fair?.base)}</b><small>{potential == null ? "potencial indisponível" : `potencial ${pct(potential)}`}</small></div>
        <div className="decision-metrics">
          <article><span>Fundamentos</span><b>{ten(score.fundamentalScore)}</b></article>
          <article><span>Valuation</span><b>{ten(score.valuation)}</b></article>
          <article><span>Timing</span><b>{ten(score.momentum)}</b></article>
          <article><span>Risco</span><b>{riskLabel(score.risk)}</b></article>
        </div>
        <footer><span>{top4Set.has(asset.ticker) ? "TOP 4" : "Horizonte"}</span><b>{top4Set.has(asset.ticker) ? "Destaque" : "2–6 meses"}</b><i>Ver análise →</i></footer>
      </button>)}
    </section>

    {!rows.length && <p className="quant-empty">Nenhum ativo atende a este filtro com os dados disponíveis.</p>}

    <details className="decision-method"><summary>Como funciona a nota 0–100</summary><p>Fundamentos 50%, valuation 20%, momentum/timing 15%, risco 10% e confiança dos dados 5%. Se uma métrica secundária estiver ausente, os pesos restantes são renormalizados. Sem fundamentos, a ação não entra no ranking. Nota 70 ou mais mostra COMPRA; abaixo de 70 mostra VENDA. A decisão final é sempre do usuário.</p></details>
  </div>;
}
