import { useEffect, useMemo, useState } from "react";
import { intradaySummary, marketTime, normalizeIntradaySeries, snapshotIntradaySeries } from "./intraday-series.js";
import "./IntradayChart.css";

const money = (value) => value == null ? "N/D" : Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (value) => value == null ? "N/D" : `${value > 0 ? "+" : ""}${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

function cached(ticker) {
  try {
    const value = JSON.parse(localStorage.getItem(`b3-score-intraday-series-v1:${ticker}`) ?? "null");
    return value && Date.now() - Number(value.savedAt) < 2 * 60 * 1000 && Array.isArray(value.rows) ? value : null;
  } catch { return null; }
}

export default function IntradayChart({ asset }) {
  const fallback = useMemo(() => snapshotIntradaySeries(asset?.intradaySeries ?? []), [asset?.intradaySeries]);
  const [rows, setRows] = useState(fallback);
  const [state, setState] = useState("loading");
  const [source, setSource] = useState(fallback.length ? asset?.intradaySource ?? "Fotografias acumuladas" : null);

  useEffect(() => {
    let cancelled = false;
    const fromCache = cached(asset.ticker);
    if (fromCache?.rows?.length) { setRows(fromCache.rows); setSource(fromCache.source); setState("ready"); return () => { cancelled = true; }; }
    setState("loading");
    const symbol = encodeURIComponent(asset.ticker);
    const urls = [
      `https://brapi.dev/api/v2/stocks/historical?symbols=${symbol}&range=1d&interval=5m&sortOrder=asc`,
      `https://brapi.dev/api/quote/${symbol}?range=1d&interval=5m`,
    ];
    const attempt = (index) => fetch(urls[index], { cache: "no-store" }).then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status)))).then((payload) => {
      const next = normalizeIntradaySeries(payload, asset.ticker);
      if (next.length < 2) throw new Error("série curta");
      return next;
    }).catch((error) => index + 1 < urls.length ? attempt(index + 1) : Promise.reject(error));
    attempt(0).then((next) => {
      if (cancelled) return;
      setRows(next); setSource("brapi.dev · candles de 5 min"); setState("ready");
      try { localStorage.setItem(`b3-score-intraday-series-v1:${asset.ticker}`, JSON.stringify({ savedAt: Date.now(), rows: next, source: "brapi.dev · candles de 5 min" })); } catch {}
    }).catch(() => { if (!cancelled) { setRows(fallback); setSource(fallback.length ? asset?.intradaySource ?? "Fotografias acumuladas" : null); setState(fallback.length ? "ready" : "failed"); } });
    return () => { cancelled = true; };
  }, [asset.ticker, asset?.intradaySource, fallback]);

  const summary = intradaySummary(rows);
  if (state === "loading" && !rows.length) return <div className="intraday-chart-empty"><b>Carregando o pregão completo de {asset.ticker}…</b><span>Buscando candles de cinco minutos.</span></div>;
  if (!rows.length) return <div className="intraday-chart-empty"><b>Movimentação intradiária indisponível.</b><span>A análise diária continua disponível; o app não inventa pontos ausentes.</span></div>;

  const width = 900; const height = 320; const pad = { x: 42, top: 24, bottom: 38 };
  const values = rows.flatMap((row) => [row.low, row.high, row.close]).filter(Number.isFinite);
  const min = Math.min(...values); const max = Math.max(...values); const spread = Math.max(max - min, max * .002, .01);
  const x = (index) => pad.x + index / Math.max(1, rows.length - 1) * (width - pad.x * 2);
  const y = (value) => pad.top + (max + spread * .08 - value) / (spread * 1.16) * (height - pad.top - pad.bottom);
  const line = rows.map((row, index) => `${x(index)},${y(row.close)}`).join(" ");
  const area = `${pad.x},${height - pad.bottom} ${line} ${width - pad.x},${height - pad.bottom}`;
  const tone = summary.changePct == null ? "neutral" : summary.changePct >= 0 ? "positive" : "negative";

  return <figure className={`intraday-full-chart ${tone}`}>
    <div className="intraday-summary"><article><span>Abertura</span><b>{money(summary.open)}</b></article><article><span>Último</span><b>{money(summary.close)}</b></article><article><span>Máxima</span><b>{money(summary.high)}</b></article><article><span>Mínima</span><b>{money(summary.low)}</b></article><article><span>No pregão</span><b>{pct(summary.changePct)}</b></article></div>
    <div className="intraday-svg-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Movimentação completa de ${asset.ticker} no pregão, em intervalos de cinco minutos`}>
      {[0, .25, .5, .75, 1].map((ratio) => <line key={ratio} className="grid" x1={pad.x} x2={width - pad.x} y1={pad.top + ratio * (height - pad.top - pad.bottom)} y2={pad.top + ratio * (height - pad.top - pad.bottom)} />)}
      <polygon points={area} /><polyline points={line} />
      <text x={width - pad.x + 5} y={y(max) + 4}>{money(max)}</text><text x={width - pad.x + 5} y={y(min) + 4}>{money(min)}</text>
    </svg><div className="intraday-axis"><span>{marketTime(rows[0].timestamp)}</span><span>{marketTime(rows[Math.floor(rows.length / 2)].timestamp)}</span><span>{marketTime(rows.at(-1).timestamp)}</span></div></div>
    <figcaption><span>{rows.length} pontos do pregão de {new Date(`${rows.at(-1).date}T12:00:00`).toLocaleDateString("pt-BR")}</span><small>{source}{asset?.intradayDelayMinutes != null ? ` · atraso informado ${asset.intradayDelayMinutes} min` : ""}</small></figcaption>
    <details><summary>Últimas movimentações</summary><table><thead><tr><th>Hora</th><th>Abertura</th><th>Máxima</th><th>Mínima</th><th>Último</th></tr></thead><tbody>{rows.slice(-8).reverse().map((row) => <tr key={row.timestamp}><td>{marketTime(row.timestamp)}</td><td>{money(row.open)}</td><td>{money(row.high)}</td><td>{money(row.low)}</td><td>{money(row.close)}</td></tr>)}</tbody></table></details>
  </figure>;
}
