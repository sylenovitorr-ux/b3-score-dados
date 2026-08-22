import { fairValueRange } from "./opportunity-engine.js";
import { buildBuySellScore } from "./analysis/buy-sell-score.js";

const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value) => value == null ? "N/D" : `${Number(value) > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const STRATEGY_KEY = "b3-score-radar-strategy-v1";

const metric = (label, value) => value == null ? null : ({ label, value: Math.round(value) });

export default function AssetSummaryPanel({ asset, analysis }) {
  const sector = asset.kind === "fii" ? asset.fund?.segment : asset.fundamentals?.sector;
  const strategy = typeof localStorage === "undefined" ? "swing" : localStorage.getItem(STRATEGY_KEY) || "swing";
  const unified = buildBuySellScore({ asset, analysis, strategy });
  const fair = fairValueRange(asset);
  const potential = fair?.base && asset.price ? (fair.base / asset.price - 1) * 100 : null;
  const direction = asset.changepct == null ? "neutral" : asset.changepct >= 0 ? "up" : "down";
  const signalTone = unified.signal === "buy" ? "buy" : unified.signal === "sell" ? "sell" : "unavailable";
  const metrics = [
    metric("Fundamentos", unified.fundamentalScore),
    metric("Valuation", unified.valuation),
    strategy === "swing" ? metric("Timing", unified.momentum) : null,
    strategy === "long" ? metric("Crescimento", unified.growth) : null,
    strategy === "dividends" ? metric("Dividendos", unified.dividends) : null,
    metric("Risco", unified.risk),
  ].filter(Boolean);
  const strongest = [...metrics].sort((a, b) => b.value - a.value).slice(0, 3);
  const weakest = [...metrics].sort((a, b) => a.value - b.value).slice(0, 2);
  const invalidators = unified.signal === "buy"
    ? ["score cair abaixo de 70", weakest[0] ? `${weakest[0].label.toLowerCase()} continuar deteriorando` : null, potential != null && potential < 8 ? "assimetria até valor justo ficar pequena" : null].filter(Boolean)
    : ["score recuperar 70+", strongest[0] ? `${strongest[0].label.toLowerCase()} melhorar de forma consistente` : null].filter(Boolean);

  return <section className={`asset-overview decision-asset-head premium-asset-head decision-dossier ${signalTone}`} id="resumo-ativo">
    <div className="asset-decision-main">
      <div className="asset-identity"><span className="asset-type">{asset.kind === "fii" ? "FII" : asset.kind === "unit" ? "UNIT" : "AÇÃO"}</span><h1>{asset.ticker}</h1><p>{asset.name ?? sector ?? "Ativo B3"}</p>{sector && <small>{sector}</small>}</div>
      <div className="asset-decision-badge"><span>{unified.strategyLabel.toUpperCase()}</span><b>{unified.label}</b><small>{unified.score == null ? "dados mínimos insuficientes" : `${unified.score}/100`}</small></div>
    </div>

    <div className="asset-decision-data">
      <article><span>Preço</span><b>{money(asset.price)}</b><strong className={direction}>{pct(asset.changepct)}</strong></article>
      <article><span>Valor justo</span><b>{money(fair?.base)}</b><small>estimativa do modelo</small></article>
      <article><span>Potencial</span><b>{pct(potential)}</b><small>até valor justo</small></article>
    </div>

    {unified.score != null ? <div className="decision-explain-grid">
      <article className="decision-explain positive-block"><header><span>✅</span><div><b>Por que agora</b><small>maiores forças do score</small></div></header>{strongest.map((item) => <p key={item.label}><span>{item.label}</span><b>{item.value}/100</b></p>)}</article>
      <article className="decision-explain negative-block"><header><span>⚠️</span><div><b>O que pesa contra</b><small>pontos que pedem atenção</small></div></header>{weakest.map((item) => <p key={item.label}><span>{item.label}</span><b>{item.value}/100</b></p>)}</article>
      <article className="decision-explain neutral-block"><header><span>🎯</span><div><b>{unified.signal === "buy" ? "O que faria virar VENDA" : "O que faria voltar a COMPRA"}</b><small>gatilhos objetivos do modelo</small></div></header>{invalidators.map((item) => <p key={item}><span>{item}</span></p>)}</article>
    </div> : <div className="decision-unavailable"><span>ℹ️</span><div><b>Modelo sem opinião</b><p>Os dados mínimos exigidos por {unified.strategyLabel} não estão disponíveis. O terminal mantém N/D em vez de inventar um sinal.</p></div></div>}

    <footer><span>{asset.intraday ? "Cotação intradiária" : "Último fechamento disponível"}</span><small>{unified.score == null ? "Sem dados mínimos, o modelo não emite COMPRA/VENDA." : "A decisão final é do usuário."}</small></footer>
  </section>;
}
