import { useMemo, useState } from "react";
import { fairValueRange } from "./opportunity-engine.js";
import { buildQuantAnalysis } from "./quant/quant-engine.js";
import { buildSwingCandidate } from "./quant/swing-engine.js";
import "./SwingPage.css";

const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value) => value == null ? "N/D" : `${value > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const ten = (value) => value == null ? "N/D" : `${Math.round(value / 10)}/10`;

const classify = (candidate, valuationScore) => {
  if (candidate.score == null) return { label: "DADOS INSUFICIENTES", tone: "neutral" };
  const weakQuality = candidate.quality != null && candidate.quality < 45;
  const highRisk = candidate.risk != null && candidate.risk < 35;
  const negativeTrend = candidate.timing?.trend?.tone === "negative";
  if (weakQuality || highRisk || negativeTrend) return { label: "EVITAR", tone: "avoid" };
  const goodQuality = candidate.quality != null && candidate.quality >= 65;
  const goodTiming = candidate.timing?.score != null && candidate.timing.score >= 55;
  const goodValuation = valuationScore == null || valuationScore >= 55;
  if (candidate.score >= 72 && goodQuality && goodTiming && goodValuation) return { label: "CANDIDATA", tone: "candidate" };
  return { label: "ACOMPANHAR", tone: "watch" };
};

const riskLabel = (risk) => risk == null ? "N/D" : risk >= 70 ? "baixo" : risk >= 45 ? "médio" : "alto";

export default function SwingPage({ assets, anomalies, onBack, onOpen }) {
  const [filter, setFilter] = useState("candidate");
  const rows = useMemo(() => assets
    .filter((asset) => asset.kind !== "fii")
    .map((asset) => {
      const anomaly = anomalies?.assets?.[asset.ticker];
      const quant = buildQuantAnalysis(asset, assets, anomaly, "swing_3_6m");
      const candidate = buildSwingCandidate(asset, quant, anomaly);
      const fair = fairValueRange(asset);
      const potential = fair?.base && asset.price ? (fair.base / asset.price - 1) * 100 : null;
      const valuationScore = asset.fundamentals?.scores?.price ?? null;
      const decision = classify(candidate, valuationScore);
      return { asset, candidate, fair, potential, valuationScore, decision };
    })
    .filter(({ candidate }) => candidate.score != null)
    .filter(({ decision }) => filter === "all" || decision.tone === filter)
    .sort((a, b) => (b.candidate.score ?? -1) - (a.candidate.score ?? -1)), [assets, anomalies, filter]);

  return <div className="swing-page decision-radar">
    <div className="daily-radar-top"><button className="back-btn" onClick={onBack}>← Início</button><span>RADAR 6M</span></div>

    <section className="swing-hero decision-hero">
      <div>
        <span>ASSIMETRIA • ATÉ 6 MESES</span>
        <h1>O que merece<br /><em>seu dinheiro?</em></h1>
        <p>O motor filtra qualidade, valuation, timing e risco. A tela mostra apenas o necessário para decidir onde investigar primeiro.</p>
      </div>
      <aside><b>{rows.length}</b><small>ativos no filtro</small><p>Horizonte operacional: 2–6 meses.</p></aside>
    </section>

    <section className="decision-filters">
      <button className={filter === "candidate" ? "active" : ""} onClick={() => setFilter("candidate")}>🟢 Candidatas</button>
      <button className={filter === "watch" ? "active" : ""} onClick={() => setFilter("watch")}>🟡 Acompanhar</button>
      <button className={filter === "avoid" ? "active" : ""} onClick={() => setFilter("avoid")}>🔴 Evitar</button>
      <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Todas</button>
    </section>

    <section className="decision-grid">
      {rows.map(({ asset, candidate, fair, potential, valuationScore, decision }) => <button className={`decision-card ${decision.tone}`} key={asset.ticker} onClick={() => onOpen(asset.ticker)}>
        <div className="decision-card-top"><div><strong>{asset.ticker}</strong><span>{asset.name}</span></div><em>{decision.label}</em></div>
        <div className="decision-price"><b>{money(asset.price)}</b><span>Nota {candidate.score}/100</span></div>
        <div className="decision-fair"><span>Valor justo estimado</span><b>{money(fair?.base)}</b><small>{potential == null ? "potencial indisponível" : `potencial ${pct(potential)}`}</small></div>
        <div className="decision-metrics">
          <article><span>Qualidade</span><b>{ten(candidate.quality)}</b></article>
          <article><span>Valuation</span><b>{ten(valuationScore)}</b></article>
          <article><span>Timing</span><b>{ten(candidate.timing.score)}</b></article>
          <article><span>Risco</span><b>{riskLabel(candidate.risk)}</b></article>
        </div>
        <footer><span>Horizonte</span><b>2–6 meses</b><i>Ver análise →</i></footer>
      </button>)}
    </section>

    {!rows.length && <p className="quant-empty">Nenhum ativo atende a este filtro com os dados disponíveis.</p>}

    <details className="decision-method"><summary>Como a nota é formada</summary><p>Qualidade filtra empresas frágeis; valuation procura desconto; timing evita entrar cedo demais; risco reduz a prioridade de operações assimétricas ruins. Métricas ausentes permanecem como N/D e não viram nota zero.</p></details>
  </div>;
}
