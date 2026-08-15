import { useEffect, useMemo, useRef, useState } from "react";
import { movingAverage } from "./financial-chart-math.js";

const money = (value) => value == null ? "N/D" : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const shortDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR") : "N/D";

export default function FinancialChart({ series = [], fairValue, events = [], ticker }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [period, setPeriod] = useState("1y");
  const [mode, setMode] = useState("candles");
  const [hover, setHover] = useState(null);
  const sessions = { "1m": 22, "3m": 66, "6m": 132, "1y": 260, max: Infinity }[period];
  const rows = useMemo(() => series.slice(-sessions), [series, sessions]);
  const averages = useMemo(() => ({ ma20: movingAverage(rows, 20), ma50: movingAverage(rows, 50), ma200: movingAverage(rows, 200) }), [rows]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || rows.length < 2) return undefined;
    const draw = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(320, wrap.clientWidth);
      const height = 390;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      ctx.scale(ratio, ratio);
      const css = getComputedStyle(document.documentElement);
      const ink = css.getPropertyValue("--chart-ink").trim() || "#173629";
      const grid = css.getPropertyValue("--chart-grid").trim() || "#dce7e1";
      const green = css.getPropertyValue("--chart-up").trim() || "#087a45";
      const red = css.getPropertyValue("--chart-down").trim() || "#a53e3e";
      const surface = css.getPropertyValue("--chart-surface").trim() || "#ffffff";
      ctx.fillStyle = surface;
      ctx.fillRect(0, 0, width, height);
      const pad = { left: 12, right: 66, top: 18, bottom: 28 };
      const priceBottom = 285;
      const values = rows.flatMap((row) => [row.low, row.high, row.close]).filter(Number.isFinite);
      if (Number.isFinite(fairValue)) values.push(fairValue);
      const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
      const x = (index) => pad.left + (index + .5) / rows.length * (width - pad.left - pad.right);
      const y = (value) => pad.top + (max - value) / span * (priceBottom - pad.top);
      ctx.strokeStyle = grid;
      ctx.fillStyle = ink;
      ctx.font = "11px system-ui";
      for (let i = 0; i <= 4; i += 1) {
        const value = max - span * i / 4, py = y(value);
        ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(width - pad.right, py); ctx.stroke();
        ctx.fillText(money(value), width - pad.right + 5, py + 4);
      }
      const candleWidth = Math.max(1.5, Math.min(10, (width - pad.left - pad.right) / rows.length * .64));
      if (mode === "candles") rows.forEach((row, index) => {
        const color = row.close >= row.open ? green : red;
        ctx.strokeStyle = color; ctx.fillStyle = color;
        ctx.beginPath(); ctx.moveTo(x(index), y(row.high)); ctx.lineTo(x(index), y(row.low)); ctx.stroke();
        const top = y(Math.max(row.open, row.close)), bottom = y(Math.min(row.open, row.close));
        ctx.fillRect(x(index) - candleWidth / 2, top, candleWidth, Math.max(1, bottom - top));
      });
      else {
        ctx.strokeStyle = green; ctx.lineWidth = 2; ctx.beginPath();
        rows.forEach((row, index) => index ? ctx.lineTo(x(index), y(row.close)) : ctx.moveTo(x(index), y(row.close)));
        ctx.stroke(); ctx.lineWidth = 1;
      }
      [[averages.ma20, "#286f9b"], [averages.ma50, "#a87818"], [averages.ma200, "#6b4c9a"]].forEach(([ma, color]) => {
        ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.beginPath(); let started = false;
        ma.forEach((value, index) => { if (!Number.isFinite(value)) return; if (!started) { ctx.moveTo(x(index), y(value)); started = true; } else ctx.lineTo(x(index), y(value)); });
        if (started) ctx.stroke(); ctx.lineWidth = 1;
      });
      if (Number.isFinite(fairValue)) {
        ctx.strokeStyle = "#087a45"; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(pad.left, y(fairValue)); ctx.lineTo(width - pad.right, y(fairValue)); ctx.stroke(); ctx.setLineDash([]);
      }
      const maxVolume = Math.max(...rows.map((row) => Number(row.volume) || 0), 1);
      rows.forEach((row, index) => { const h = (Number(row.volume) || 0) / maxVolume * 70; ctx.fillStyle = row.close >= row.open ? `${green}80` : `${red}80`; ctx.fillRect(x(index) - candleWidth / 2, height - pad.bottom - h, candleWidth, h); });
      const eventDates = new Set(events.map((event) => String(event.date).slice(0, 10)));
      rows.forEach((row, index) => { if (!eventDates.has(row.date)) return; ctx.fillStyle = "#a87818"; ctx.beginPath(); ctx.arc(x(index), Math.max(10, y(row.high) - 8), 4, 0, Math.PI * 2); ctx.fill(); });
      if (hover !== null && rows[hover]) {
        ctx.strokeStyle = ink; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x(hover), pad.top); ctx.lineTo(x(hover), height - pad.bottom); ctx.stroke(); ctx.setLineDash([]);
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [rows, averages, fairValue, events, hover, mode]);

  if (rows.length < 2) return <p className="intelligence-empty">Dados insuficientes para gerar este gráfico.</p>;
  const hovered = hover === null ? null : rows[hover];
  const pointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const usable = Math.max(1, rect.width - 78);
    setHover(Math.max(0, Math.min(rows.length - 1, Math.floor((event.clientX - rect.left - 12) / usable * rows.length))));
  };
  return <figure className="financial-chart" ref={wrapRef}>
    <div className="chart-toolbar"><div>{Object.entries({ "1m": "1 mês", "3m": "3 meses", "6m": "6 meses", "1y": "1 ano", max: "Máximo" }).map(([key, label]) => <button type="button" className={period === key ? "active" : ""} onClick={() => setPeriod(key)} key={key}>{label}</button>)}</div><div><button type="button" className={mode === "candles" ? "active" : ""} onClick={() => setMode("candles")}>Candles</button><button type="button" className={mode === "line" ? "active" : ""} onClick={() => setMode("line")}>Linha</button></div></div>
    <div className="financial-canvas-shell"><canvas ref={canvasRef} onPointerMove={pointer} onPointerLeave={() => setHover(null)} role="img" aria-label={`Gráfico financeiro de ${ticker}: preço, volume, médias móveis, eventos e valor justo`} />{hovered && <output className="financial-tooltip"><b>{shortDate(hovered.date)}</b><span>A {money(hovered.open)} • Mx {money(hovered.high)}</span><span>Mn {money(hovered.low)} • F {money(hovered.close)}</span><span>Volume {money(hovered.volume)}</span></output>}</div>
    <figcaption><span><i className="legend-price" />Preço</span><span><i className="legend-ma20" />MM20</span><span><i className="legend-ma50" />MM50</span><span><i className="legend-ma200" />MM200</span><span><i className="legend-fair" />Valor justo atual</span><small>{rows.length} pregões • B3 COTAHIST • sem ajuste retroativo por proventos</small></figcaption>
    <details className="chart-accessible-data"><summary>Últimas cotações em texto</summary><table><thead><tr><th>Data</th><th>Abertura</th><th>Máxima</th><th>Mínima</th><th>Fechamento</th></tr></thead><tbody>{rows.slice(-5).reverse().map((row) => <tr key={row.date}><td>{shortDate(row.date)}</td><td>{money(row.open)}</td><td>{money(row.high)}</td><td>{money(row.low)}</td><td>{money(row.close)}</td></tr>)}</tbody></table></details>
  </figure>;
}
