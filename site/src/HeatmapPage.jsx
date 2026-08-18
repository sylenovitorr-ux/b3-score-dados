import { useMemo, useState } from "react";
import { formatMoney, formatPercent } from "./formatters";

const label = (asset) => asset.sector || asset.segment || asset.group || (asset.kind === "fii" ? "FIIs" : "Sem setor classificado");
const tone = (value) => value == null ? "unknown" : value >= 2 ? "strong-up" : value > 0 ? "up" : value <= -2 ? "strong-down" : value < 0 ? "down" : "flat";

export default function HeatmapPage({ assets, intraday, onBack, onOpen }) {
  const [kind, setKind] = useState("stocks");
  const rows = useMemo(() => assets.filter((asset) => kind === "all" ? true : kind === "fiis" ? asset.kind === "fii" : asset.kind !== "fii").filter((asset) => asset.price != null).map((asset) => ({ asset, group: label(asset), change: asset.changepct })).sort((a, b) => (b.asset.volume ?? 0) - (a.asset.volume ?? 0)), [assets, kind]);
  const groups = useMemo(() => Object.entries(rows.reduce((all, row) => { (all[row.group] ??= []).push(row); return all; }, {})).sort(([a], [b]) => a.localeCompare(b, "pt-BR")), [rows]);
  const updated = intraday?.updatedAt ? new Date(intraday.updatedAt).toLocaleString("pt-BR") : null;
  return <main className="v2-page heatmap-page">
    <header className="v2-page-head"><button onClick={onBack}>← Início</button><div><span>VISÃO DE MERCADO</span><h1>Mapa de calor B3</h1><p>Encontre rapidamente onde o dinheiro e o movimento estão concentrados.</p></div></header>
    <section className={`intraday-status ${intraday?.available ? "available" : "unavailable"}`}><b>{intraday?.available ? "Cotações intradiárias" : "Último fechamento disponível"}</b><span>{intraday?.available ? `${intraday.delayMinutes != null ? `atraso informado: ${intraday.delayMinutes} min • ` : ""}${updated ?? "horário não informado"}${intraday.source ? ` • ${intraday.source}` : ""}` : "Sem fotografia intradiária válida. O mapa usa a última cotação disponível."}</span></section>
    <section className="heatmap-how"><h2>Como usar em 10 segundos</h2><div><article><b>1. Veja a cor</b><span>Verde = alta. Vermelho = queda. Quanto mais intensa a cor, maior o movimento.</span></article><article><b>2. Veja o tamanho</b><span>Blocos maiores representam maior liquidez/volume relativo no conjunto mostrado.</span></article><article><b>3. Clique no ativo</b><span>Abra a análise completa para ver histórico diário, sinal COMPRA/VENDA, níveis e livro de ofertas.</span></article></div></section>
    <section className="heatmap-controls"><label>Universo<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="stocks">Ações e units</option><option value="fiis">FIIs</option><option value="all">Todos</option></select></label><span>{rows.length} ativos com preço</span></section>
    <section className="heatmap-legend" aria-label="Legenda"><i className="strong-down" /> queda forte <i className="down" /> queda <i className="flat" /> estável <i className="up" /> alta <i className="strong-up" /> alta forte</section>
    <div className="heatmap-groups">{groups.map(([group, items]) => <section key={group}><header><h2>{group}</h2><span>{items.length} ativos</span></header><div className="heatmap-grid">{items.map(({ asset, change }) => <button key={asset.ticker} className={`heatmap-tile ${tone(change)}`} style={{ flexGrow: Math.max(1, Math.min(5, Math.log10(Math.max(asset.volume ?? 1, 1)))) }} onClick={() => onOpen(asset.ticker)}><b>{asset.ticker}</b><span>{formatPercent(change)}</span><small>{formatMoney(asset.price)}</small></button>)}</div></section>)}</div>
    {!rows.length && <p className="quant-empty">Dados insuficientes para montar o mapa.</p>}
  </main>;
}
