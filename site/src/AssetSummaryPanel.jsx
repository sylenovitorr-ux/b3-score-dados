const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const compact = (value) => value == null ? "N/D" : new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value));
const pct = (value) => value == null ? "N/D" : `${Number(value) > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

const jump = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

export default function AssetSummaryPanel({ asset }) {
  const sector = asset.kind === "fii" ? asset.fund?.segment : asset.fundamentals?.sector;
  const score = asset.kind === "fii" ? asset.fund?.scores?.overall : asset.fundamentals?.scores?.overall;
  const direction = asset.changepct == null ? "neutral" : asset.changepct >= 0 ? "up" : "down";
  return <section className="asset-overview" id="resumo-ativo">
    <header className="asset-overview-head">
      <div className="asset-identity"><span className="asset-type">{asset.kind === "fii" ? "FII" : asset.kind === "unit" ? "UNIT" : "AÇÃO"}</span><h1>{asset.ticker}</h1><p>{asset.name ?? sector ?? "Ativo B3"}</p>{sector && <small>{sector}</small>}</div>
      <div className="asset-quote"><span>Preço</span><b>{money(asset.price)}</b><strong className={direction}>{pct(asset.changepct)}</strong><small>{asset.intraday ? `Intradiário${asset.intradayAsOf ? ` • ${asset.intradayAsOf}` : ""}` : "Último fechamento disponível"}</small></div>
    </header>
    <div className="asset-overview-stats">
      <article><span>Abertura</span><b>{money(asset.priceopen)}</b></article>
      <article><span>Mínima do dia</span><b>{money(asset.low)}</b></article>
      <article><span>Máxima do dia</span><b>{money(asset.high)}</b></article>
      <article><span>Volume</span><b>{compact(asset.volume)}</b></article>
      <article><span>Mín. 52 semanas</span><b>{money(asset.low52)}</b></article>
      <article><span>Máx. 52 semanas</span><b>{money(asset.high52)}</b></article>
      <article><span>Score</span><b>{score == null ? "N/D" : `${Math.round(score)}/100`}</b></article>
    </div>
    <nav className="asset-section-nav" aria-label="Seções do ativo">
      <button onClick={() => jump("sinal-atual")}>Resumo</button>
      <button onClick={() => jump("historico-diario")}>Histórico</button>
      <button onClick={() => jump("livro-ofertas")}>Livro de ofertas</button>
      <button onClick={() => jump("painel-grafico-ativo")}>Gráfico e indicadores</button>
    </nav>
  </section>;
}
