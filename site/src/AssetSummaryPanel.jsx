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

  return <section className="asset-overview decision-asset-head" id="resumo-ativo">
    <header className="asset-overview-head">
      <div className="asset-identity"><span className="asset-type">{asset.kind === "fii" ? "FII" : asset.kind === "unit" ? "UNIT" : "AÇÃO"}</span><h1>{asset.ticker}</h1><p>{asset.name ?? sector ?? "Ativo B3"}</p>{sector && <small>{sector}</small>}</div>
      <div className="asset-quote"><span>Preço atual</span><b>{money(asset.price)}</b><strong className={direction}>{pct(asset.changepct)}</strong><small>{asset.intraday ? "Intradiário" : "Último fechamento disponível"}</small></div>
    </header>
    <div className="asset-overview-stats decision-asset-stats">
      <article><span>Nota B3 Score</span><b>{score == null ? "N/D" : `${Math.round(score)}/100`}</b></article>
      <article><span>Qualidade</span><b>{quality == null ? "N/D" : `${Math.round(quality / 10)}/10`}</b></article>
      <article><span>Valuation</span><b>{valuation == null ? "N/D" : `${Math.round(valuation / 10)}/10`}</b></article>
      <article><span>Valor justo estimado</span><b>{money(fair?.base)}</b></article>
      <article><span>Potencial até valor justo</span><b>{pct(potential)}</b></article>
      <article><span>Horizonte do app</span><b>2–6 meses</b></article>
    </div>
  </section>;
}
