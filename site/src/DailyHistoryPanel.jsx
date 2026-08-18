const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const compact = (value) => value == null ? "N/D" : new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value));
const shortDate = (value) => value ? new Date(`${String(value).slice(0,10)}T12:00:00`).toLocaleDateString("pt-BR") : "N/D";

export default function DailyHistoryPanel({ series = [], ticker }) {
  const rows = series.slice(-20).reverse().map((row, index, all) => {
    const previous = all[index + 1]?.close;
    const changePct = Number.isFinite(row.close) && Number.isFinite(previous) && previous !== 0 ? (row.close / previous - 1) * 100 : null;
    return { ...row, changePct };
  });
  if (!rows.length) return null;
  return <section className="daily-history" id="historico-diario">
    <header><div><span className="eyebrow">HISTÓRICO DIÁRIO</span><h3>{ticker} • últimos pregões</h3></div><small>B3 COTAHIST</small></header>
    <div className="daily-history-scroll"><table><thead><tr><th>Data</th><th>Abertura</th><th>Máxima</th><th>Mínima</th><th>Fechamento</th><th>Variação</th><th>Volume</th></tr></thead><tbody>{rows.map((row) => <tr key={row.date}><td>{shortDate(row.date)}</td><td>{money(row.open)}</td><td>{money(row.high)}</td><td>{money(row.low)}</td><td><b>{money(row.close)}</b></td><td className={row.changePct == null ? "" : row.changePct >= 0 ? "daily-up" : "daily-down"}>{row.changePct == null ? "N/D" : `${row.changePct > 0 ? "+" : ""}${row.changePct.toFixed(2)}%`}</td><td>{compact(row.volume)}</td></tr>)}</tbody></table></div>
    <p>Use o histórico para enxergar sequência de altas/baixas, amplitude diária e comportamento de volume. O gráfico completo abaixo permite trocar entre candles e linha.</p>
  </section>;
}
