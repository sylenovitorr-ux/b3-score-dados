import { fairValueRange } from "./opportunity-engine.js";
import { buildBuySellScore } from "./analysis/buy-sell-score.js";

const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value) => value == null ? "N/D" : `${Number(value) > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const STRATEGY_KEY = "b3-score-radar-strategy-v1";

export default function AssetSummaryPanel({ asset, analysis }) {
  const sector = asset.kind === "fii" ? asset.fund?.segment : asset.fundamentals?.sector;
  const strategy = typeof localStorage === "undefined" ? "swing" : localStorage.getItem(STRATEGY_KEY) || "swing";
  const unified = buildBuySellScore({ asset, analysis, strategy });
  const fair = fairValueRange(asset);
  const potential = fair?.base && asset.price ? (fair.base / asset.price - 1) * 100 : null;
  const direction = asset.changepct == null ? "neutral" : asset.changepct >= 0 ? "up" : "down";
  const signalTone = unified.signal === "buy" ? "buy" : unified.signal === "sell" ? "sell" : "unavailable";
  const reasons = [
    unified.fundamentalScore != null ? { label: "Fundamentos", value: `${Math.round(unified.fundamentalScore)}/100`, good: unified.fundamentalScore >= 70 } : null,
    unified.valuation != null ? { label: "Valuation", value: `${Math.round(unified.valuation)}/100`, good: unified.valuation >= 70 } : null,
    strategy === "swing" && unified.momentum != null ? { label: "Timing", value: `${Math.round(unified.momentum)}/100`, good: unified.momentum >= 70 } : null,
    strategy === "long" && unified.growth != null ? { label: "Crescimento", value: `${Math.round(unified.growth)}/100`, good: unified.growth >= 70 } : null,
    strategy === "dividends" && unified.dividends != null ? { label: "Dividendos", value: `${Math.round(unified.dividends)}/100`, good: unified.dividends >= 70 } : null,
  ].filter(Boolean).slice(0, 3);

  return <section className={`asset-overview decision-asset-head premium-asset-head ${signalTone}`} id="resumo-ativo">
    <div className="asset-decision-main">
      <div className="asset-identity"><span className="asset-type">{asset.kind === "fii" ? "FII" : asset.kind === "unit" ? "UNIT" : "AÇÃO"}</span><h1>{asset.ticker}</h1><p>{asset.name ?? sector ?? "Ativo B3"}</p>{sector && <small>{sector}</small>}</div>
      <div className="asset-decision-badge"><span>{unified.strategyLabel.toUpperCase()}</span><b>{unified.label}</b><small>{unified.score == null ? "dados mínimos insuficientes" : `${unified.score}/100`}</small></div>
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
    <footer><span>{asset.intraday ? "Cotação intradiária" : "Último fechamento disponível"}</span><small>{unified.score == null ? "Sem dados mínimos, o modelo não emite COMPRA/VENDA." : "A decisão final é do usuário."}</small></footer>
  </section>;
}
