import { fairValueRange } from "./opportunity-engine.js";

const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value) => value == null ? "N/D" : `${Number(value) > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

export default function AssetSummaryPanel({ asset }) {
  const sector = asset.kind === "fii" ? asset.fund?.segment : asset.fundamentals?.sector;
  const scores = asset.kind === "fii" ? asset.fund?.scores : asset.fundamentals?.scores;
  const score = scores?.overall ?? null;
  const quality = scores?.quality ?? null;
  const valuation = scores?.price ?? null;
  const fair = fairValueRange(asset);
  const potential = fair?.base && asset.price ? (fair.base / asset.price - 1) * 100 : null;
  const direction = asset.changepct == null ? "neutral" : asset.changepct >= 0 ? "up" : "down";
  const signal = score != null && score >= 70 ? "COMPRA" : "VENDA";
  const signalTone = signal === "COMPRA" ? "buy" : "sell";
  const reasons = [
    quality != null ? { label: "Qualidade", value: `${Math.round(quality)}/100`, good: quality >= 70 } : null,
    valuation != null ? { label: "Valuation", value: `${Math.round(valuation)}/100`, good: valuation >= 70 } : null,
    potential != null ? { label: "Potencial", value: pct(potential), good: potential > 0 } : null,
  ].filter(Boolean);

  return <section className={`asset-overview decision-asset-head premium-asset-head ${signalTone}`} id="resumo-ativo">
    <div className="asset-decision-main">
      <div className="asset-identity"><span className="asset-type">{asset.kind === "fii" ? "FII" : asset.kind === "unit" ? "UNIT" : "AÇÃO"}</span><h1>{asset.ticker}</h1><p>{asset.name ?? sector ?? "Ativo B3"}</p>{sector && <small>{sector}</small>}</div>
      <div className="asset-decision-badge"><span>DECISÃO</span><b>{signal}</b><small>{score == null ? "score indisponível" : `${Math.round(score)}/100`}</small></div>
    </div>
    <div className="asset-decision-data">
      <article><span>Preço</span><b>{money(asset.price)}</b><strong className={direction}>{pct(asset.changepct)}</strong></article>
      <article><span>Valor justo</span><b>{money(fair?.base)}</b><small>estimativa do modelo</small></article>
      <article><span>Potencial</span><b>{pct(potential)}</b><small>até valor justo</small></article>
    </div>
    <div className="asset-decision-reasons">
      {reasons.map((reason) => <div key={reason.label} className={reason.good ? "good" : "weak"}><i>{reason.good ? "✓" : "!"}</i><span>{reason.label}</span><b>{reason.value}</b></div>)}
      {!reasons.length && <div className="weak"><i>•</i><span>Dados</span><b>N/D</b></div>}
    </div>
    <footer><span>{asset.intraday ? "Cotação intradiária" : "Último fechamento disponível"}</span><small>A decisão final é do usuário.</small></footer>
  </section>;
}
