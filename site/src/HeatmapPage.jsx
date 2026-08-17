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
    <header className="v2-page-head"><button onClick={onBack}>← Início</button><div><span>VISÃO DE MERCADO</span><h1>Mapa de calor B3</h1><p>Uma leitura visual de variação por grupo. O tamanho do bloco segue a liquidez observada; a cor não é recomendação.</p></div></header>
    <section className={`intraday-status ${intraday?.available ? "available" : "unavailable"}`}><b>{intraday?.available ? "Cotações intradiárias" : "Último fechamento disponível"}</b><span>{intraday?.available ? `${intraday.delayMinutes != null ? `atraso informado: ${intraday.delayMinutes} min • ` : ""}${updated ?? "horário não informado"}${intraday.source ? ` • ${intraday.source}` : ""}` : "Não há fonte intradiária configurada. O mapa usa a última fotografia oficial e não a chama de tempo real."}</span></section>
    <section className="heatmap-controls"><label>Universo<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="stocks">Ações e units</option><option value="fiis">FIIs</option><option value="all">Todos</option></select></label><span>{rows.length} ativos com preço</span></section>
    <section className="heatmap-legend" aria-label="Legenda"><i className="strong-down" /> queda forte <i className="down" /> queda <i className="flat" /> estável <i className="up" /> alta <i className="strong-up" /> alta forte</section>
    <div className="heatmap-groups">{groups.map(([group, items]) => <section key={group}><header><h2>{group}</h2><span>{items.length} ativos</span></header><div className="heatmap-grid">{items.map(({ asset, change }) => <button key={asset.ticker} className={`heatmap-tile ${tone(change)}`} style={{ flexGrow: Math.max(1, Math.min(5, Math.log10(Math.max(asset.volume ?? 1, 1)))) }} onClick={() => onOpen(asset.ticker)}><b>{asset.ticker}</b><span>{formatPercent(change)}</span><small>{formatMoney(asset.price)}</small></button>)}</div></section>)}</div>
    {!rows.length && <p className="quant-empty">Dados insuficientes para montar o mapa.</p>}
    <section className="radar-method"><h2>Como usar</h2><p>Use o mapa para localizar onde o movimento está concentrado e depois abra o ativo ou comparador. Variação de preço não prova qualidade nem define entrada.</p></section>
  </main>;
}
