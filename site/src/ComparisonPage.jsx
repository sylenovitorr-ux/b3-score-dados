import { useEffect, useMemo, useState } from "react";
import { base100Series, comparisonMetrics, relativePosition } from "./comparison-engine";
import { formatCompactMoney, formatMoney, formatNumber, formatPercent } from "./formatters";

const COLORS = ["#087a45", "#25638c", "#b56b16", "#8b4f9f"];
const METRICS = [
  ["score", "Score", true, (v) => formatNumber(v, 0)], ["confidence", "Confiança", true, (v) => formatPercent(v, false)], ["pe", "P/L", false, formatNumber], ["pb", "P/VP", false, formatNumber], ["roe", "ROE", true, (v) => formatPercent(v, false)], ["growth", "Cresc. receita", true, formatPercent], ["debt", "Dívida/EBITDA", false, formatNumber], ["dividendYield", "Dividend yield", true, (v) => formatPercent(v, false)], ["momentum20", "Retorno 20 pregões", true, formatPercent], ["volatility", "Volatilidade a.a.", false, (v) => formatPercent(v, false)], ["volume", "Liquidez", true, formatCompactMoney],
];

function PerformanceChart({ selected, anomalies }) {
  const lines = selected.map((asset, index) => ({ asset, color: COLORS[index], rows: base100Series(anomalies?.assets?.[asset.ticker]?.series ?? []).slice(-126) })).filter((item) => item.rows.length > 1);
  if (!lines.length) return <p className="v2-empty">Dados históricos insuficientes para comparar.</p>;
  const all = lines.flatMap((line) => line.rows.map((row) => row.value)); const min = Math.min(...all), max = Math.max(...all), range = max - min || 1;
  const points = (rows) => rows.map((row, index) => `${28 + index / Math.max(1, rows.length - 1) * 704},${230 - (row.value - min) / range * 190}`).join(" ");
  return <figure className="v2-comparison-chart"><svg viewBox="0 0 760 260" role="img" aria-label="Performance normalizada em base 100">{[0,1,2,3,4].map((i)=><line key={i} x1="28" x2="732" y1={40+i*47.5} y2={40+i*47.5}/>) }{lines.map((line)=><polyline key={line.asset.ticker} points={points(line.rows)} style={{stroke:line.color}}/> )}</svg><figcaption>{lines.map((line)=><span key={line.asset.ticker}><i style={{background:line.color}}/>{line.asset.ticker} <b>{formatNumber(line.rows.at(-1).value,1)}</b></span>)}</figcaption></figure>;
}

export default function ComparisonPage({ assets, anomalies, onBack, onOpen }) {
  const [tickers, setTickers] = useState(() => { try { const saved=JSON.parse(localStorage.getItem("b3-score-comparison-v1")??"[]"); return Array.isArray(saved)?saved.slice(0,4):[]; } catch { return []; } });
  const [candidate, setCandidate] = useState("");
  useEffect(() => localStorage.setItem("b3-score-comparison-v1", JSON.stringify(tickers)), [tickers]);
  const selected = tickers.map((ticker) => assets.find((asset) => asset.ticker === ticker)).filter(Boolean);
  const rows = useMemo(() => selected.map((asset) => ({ asset, values: comparisonMetrics(asset, anomalies?.assets?.[asset.ticker]) })), [selected, anomalies]);
  const add = () => { const ticker=candidate.toUpperCase(); if (assets.some((asset)=>asset.ticker===ticker)&&!tickers.includes(ticker)&&tickers.length<4) setTickers([...tickers,ticker]); setCandidate(""); };
  const lead = selected[0]; const sector = lead?.fundamentals?.sector ?? lead?.fund?.segment ?? null;
  const peers = sector ? assets.filter((asset) => (asset.fundamentals?.sector ?? asset.fund?.segment) === sector && (asset.fundamentals || asset.fund)).slice(0,30) : [];
  return <div className="v2-page"><header className="v2-page-head"><button onClick={onBack}>← Início</button><div><span>COMPARAÇÃO MULTIDIMENSIONAL</span><h1>Comparador de ativos</h1><p>Compare até quatro ativos. Campos ausentes não entram como zero.</p></div></header>
    <section className="v2-picker"><label>Adicionar ativo<input list="compare-assets" value={candidate} onChange={(e)=>setCandidate(e.target.value.toUpperCase())} onKeyDown={(e)=>e.key==="Enter"&&add()} placeholder="PETR4"/><datalist id="compare-assets">{assets.map((asset)=><option key={asset.ticker} value={asset.ticker}>{asset.name}</option>)}</datalist></label><button onClick={add} disabled={!candidate||tickers.length>=4}>Adicionar</button><div>{selected.map((asset,index)=><button key={asset.ticker} style={{borderColor:COLORS[index]}} onClick={()=>setTickers(tickers.filter((ticker)=>ticker!==asset.ticker))}>{asset.ticker} ×</button>)}</div></section>
    {!selected.length ? <div className="v2-empty"><b>Selecione de dois a quatro ativos.</b><span>Use empresas do mesmo setor para múltiplos e ativos diferentes para observar risco e performance.</span></div> : <><section className="v2-chart-card"><div className="v2-section-title"><span>ÚLTIMOS 126 PREGÕES</span><h2>Performance normalizada</h2><p>Todos começam em 100; isso compara retorno, não preços nominais.</p></div><PerformanceChart selected={selected} anomalies={anomalies}/></section>
    <section className="v2-compare-table"><div className="v2-compare-row head"><span>Indicador</span>{rows.map(({asset})=><button key={asset.ticker} onClick={()=>onOpen(asset.ticker)}>{asset.ticker}<small>{formatMoney(asset.price)}</small></button>)}</div>{METRICS.map(([key,label,higher,format])=><div className="v2-compare-row" key={key}><span>{label}<small>{higher?"maior tende a ser melhor":"menor exige contexto"}</small></span>{rows.map(({asset,values})=><b key={asset.ticker}>{values[key]===null?"Dado indisponível":format(values[key])}</b>)}</div>)}</section>
    {lead && <section className="v2-sector"><div className="v2-section-title"><span>COMPARAÇÃO COM PARES</span><h2>{sector ?? "Setor indisponível"}</h2><p>{sector ? `${peers.length} ativos com a mesma classificação disponível.` : "Não existe classificação segura para formar o grupo."}</p></div>{sector && <div>{[["pe","P/L",false],["pb","P/VP",false],["roe","ROE",true],["score","Score",true]].map(([key,label,higher])=>{const current=comparisonMetrics(lead,anomalies?.assets?.[lead.ticker])[key];const values=peers.map((peer)=>comparisonMetrics(peer,anomalies?.assets?.[peer.ticker])[key]);const pos=relativePosition(current,values,higher);return <article key={key}><span>{label}</span><b>{current===null?"N/D":formatNumber(current)}</b><small>{pos.available?`mediana ${formatNumber(pos.median)} • posição ${pos.rank}/${pos.total}`:"Dados insuficientes"}</small></article>})}</div>}</section>}
    <section className="v2-benchmark-missing"><b>Benchmark sincronizado indisponível</b><span>IBOV, CDI e índices setoriais só serão adicionados quando existirem séries históricas reais na mesma janela.</span></section></>}
  </div>;
}
