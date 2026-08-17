import { useMemo } from "react";
import { buildTradeSignal } from "./analysis/trade-signal-engine.js";

const money = (value) => value == null ? "N/D" : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const number = (value, digits = 0) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { maximumFractionDigits: digits });

function Reason({ reason }) {
  const icon = reason.kind === "positive" ? "✓" : reason.kind === "negative" ? "!" : "•";
  return <li className={`trade-reason ${reason.kind}`}><i>{icon}</i><span>{reason.label}</span></li>;
}

export default function TradeSignalPanel({ asset, analysis, book = null }) {
  const signal = useMemo(() => buildTradeSignal({ asset, analysis, book }), [asset, analysis, book]);
  const hasBook = signal.bookPressure != null || signal.bestBid != null || signal.bestAsk != null;

  return <section className={`trade-signal-panel trade-${signal.tone}`} aria-label={`Indicativo operacional de ${asset.ticker}`}>
    <header className="trade-signal-head">
      <div>
        <span className="eyebrow">INDICATIVO DE ENTRADA E SAÍDA</span>
        <h3>{signal.label}</h3>
        <p>Confluência quantitativa para apoio à decisão. A decisão final continua sendo sua.</p>
      </div>
      <div className="trade-signal-price">
        <span>{asset.ticker}</span>
        <b>{money(signal.price)}</b>
        <small>{signal.sourceStatus === "intraday" ? "Cotação intradiária" : "Último dado disponível"}</small>
        <em>{signal.updatedAt ? `Atualizado: ${signal.updatedAt}` : "Horário indisponível"}</em>
      </div>
    </header>

    <div className="trade-signal-scorebar">
      <article><span>Confluência</span><b>{signal.confidence}%</b></article>
      <article><span>Fundamentos</span><b>{signal.score == null ? "N/D" : `${Math.round(signal.score)}/100`}</b></article>
      <article><span>Momentum</span><b>{signal.momentum == null ? "N/D" : `${Math.round(signal.momentum)}/100`}</b></article>
      <article><span>Risco</span><b>{signal.risk == null ? "N/D" : `${Math.round(signal.risk)}/100`}</b></article>
      <article><span>Book</span><b>{signal.bookPressure == null ? "N/D" : `${signal.bookPressure > 0 ? "+" : ""}${Math.round(signal.bookPressure)}`}</b></article>
    </div>

    <div className="trade-level-grid">
      <article><span>Faixa de entrada</span><b>{money(signal.entryLow)} a {money(signal.entryHigh)}</b><small>zona indicativa, não ordem automática</small></article>
      <article><span>Stop técnico</span><b>{money(signal.stop)}</b><small>nível de invalidação quantitativa</small></article>
      <article><span>Alvo 1</span><b>{money(signal.target1)}</b><small>R/R {number(signal.riskReward1, 1)}</small></article>
      <article><span>Alvo 2</span><b>{money(signal.target2)}</b><small>R/R {number(signal.riskReward2, 1)}</small></article>
    </div>

    <div className="trade-signal-detail">
      <article>
        <h4>Por que este sinal?</h4>
        <ul>{signal.reasons.map((reason, index) => <Reason key={`${reason.label}-${index}`} reason={reason} />)}</ul>
      </article>
      <article>
        <h4>Livro de ofertas</h4>
        {hasBook ? <div className="trade-book-grid">
          <p><span>Melhor compra</span><b>{money(signal.bestBid)}</b></p>
          <p><span>Melhor venda</span><b>{money(signal.bestAsk)}</b></p>
          <p><span>Spread</span><b>{signal.spread == null ? "N/D" : money(signal.spread)}</b></p>
          <p><span>Pressão</span><b>{signal.bookPressure == null ? "N/D" : `${signal.bookPressure > 0 ? "+" : ""}${Math.round(signal.bookPressure)}`}</b></p>
        </div> : <p className="trade-book-empty">Sem fonte L2 válida no momento. O app não simula profundidade nem inventa ordens.</p>}
      </article>
    </div>

    <footer>{signal.disclaimer}</footer>
  </section>;
}
