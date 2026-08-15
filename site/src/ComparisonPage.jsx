import { useEffect, useMemo, useState } from "react";
import { base100Series, comparisonMetrics, relativePosition, synchronizedBenchmarkReturn } from "./comparison-engine";
import { formatCompactMoney, formatMoney, formatNumber, formatPercent } from "./formatters";
import { classifySector } from "./sector-classification";

const COLORS = ["#087a45", "#25638c", "#b56b16", "#8b4f9f"];
const BENCHMARK_URL = "https://raw.githubusercontent.com/sylenovitorr-ux/b3-score-dados/main/data/benchmarks.json";
const SELIC_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.1178/dados/ultimos/400?formato=json";
const METRICS = [["score", "Score", true, (v) => formatNumber(v, 0)], ["confidence", "Confiança", true, (v) => formatPercent(v, false)], ["pe", "P/L", false, formatNumber], ["pb", "P/VP", false, formatNumber], ["roe", "ROE", true, (v) => formatPercent(v, false)], ["growth", "Cresc. receita", true, formatPercent], ["debt", "Dívida/EBITDA", false, formatNumber], ["dividendYield", "Dividend yield", true, (v) => formatPercent(v, false)], ["momentum20", "Retorno 20 pregões", true, formatPercent], ["volatility", "Volatilidade a.a.", false, (v) => formatPercent(v, false)], ["volume", "Liquidez", true, formatCompactMoney]];
const date = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR") : "Dado indisponível";

function selicAccumulated(rows = []) {
  let level = 100;
  const series = rows.map((row) => {
    const value = Number(String(row.valor ?? row.value ?? "").replace(",", "."));
    const sourceDate = row.data ? row.data.split("/").reverse().join("-") : row.date;
    if (!Number.isFinite(value) || !sourceDate) return null;
    level *= (1 + value / 100) ** (1 / 252);
    return { date: sourceDate, value, base100: Number(level.toFixed(6)) };
  }).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
  return { id: "SELIC", name: "Selic acumulada", status: series.length ? "ATUALIZADO" : "INDISPONÍVEL", source: "Banco Central do Brasil — SGS 1178", referenceDate: series.at(-1)?.date ?? null, normalization: "100 × produto((1 + Selic anual/100)^(1/252))", series, limitation: "Acumulação teórica a partir da taxa Selic anualizada; CDI continua sendo a referência de retorno efetivo interbancário." };
}

function PerformanceChart({ selected, anomalies }) {
  const lines = selected.map((asset, index) => ({ asset, color: COLORS[index], rows: base100Series(anomalies?.assets?.[asset.ticker]?.series ?? []).slice(-126) })).filter((item) => item.rows.length > 1);
  if (!lines.length) return <p className="v2-empty">Dados históricos insuficientes para comparar.</p>;
  const all = lines.flatMap((line) => line.rows.map((row) => row.value)); const min = Math.min(...all), max = Math.max(...all), range = max - min || 1;
  const points = (rows) => rows.map((row, index) => `${28 + index / Math.max(1, rows.length - 1) * 704},${230 - (row.value - min) / range * 190}`).join(" ");
  return <figure className="v2-comparison-chart"><svg viewBox="0 0 760 260" role="img" aria-label="Performance normalizada em base 100">{[0,1,2,3,4].map((i)=><line key={i} x1="28" x2="732" y1={40+i*47.5} y2={40+i*47.5}/>) }{lines.map((line)=><polyline key={line.asset.ticker} points={points(line.rows)} style={{stroke:line.color}}/> )}</svg><figcaption>{lines.map((line)=><span key={line.asset.ticker}><i style={{background:line.color}}/>{line.asset.ticker} <b>{formatNumber(line.rows.at(-1).value,1)}</b></span>)}</figcaption></figure>;
}

function DataCoverage({ lead, anomalies, benchmarks, assets }) {
  const f = lead.fundamentals ?? lead.fund ?? {};
  const missing = [["Setor/segmento", lead.fundamentals?.sector ?? lead.fund?.segment], ["P/L", f.pe], ["P/VP", f.pb], ["ROE", f.roe], ["Histórico de preços", anomalies?.assets?.[lead.ticker]?.series?.length >= 2 ? true : null]].filter(([, value]) => value === null || value === undefined || value === "").map(([label]) => label);
  const loaded = Object.values(benchmarks?.series ?? {}).filter((item) => item.series?.length).length;
  const categories = assets.reduce((map, asset) => { const group = classifySector(asset).label ?? (asset.kind === "fii" ? "FIIs sem segmento" : "Sem classificação suficiente"); map.set(group, (map.get(group) ?? 0) + 1); return map; }, new Map());
  return <section className="v2-data-coverage"><div><span>COBERTURA E LACUNAS</span><h2>O que esta análise consegue afirmar</h2><p>Os campos usam somente dados vinculados. Ausência não vira zero nem estimativa silenciosa.</p></div><div className="v2-data-coverage-grid"><article><b>{lead.date ? date(lead.date) : "N/D"}</b><span>referência do preço atual</span></article><article><b>{loaded}</b><span>benchmarks oficiais carregados, incluindo Selic</span></article><article><b>{missing.length ? missing.join(", ") : "Cobertura essencial disponível"}</b><span>{missing.length ? "campos que limitam a leitura" : "campos essenciais para comparação"}</span></article></div><div className="v2-category-groups"><b>Grupos disponíveis para pares</b>{[...categories.entries()].filter(([, count]) => count >= 2).sort((a,b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => <span key={name}>{name} <i>{count}</i></span>)}</div><p className="v2-data-coverage-note">Setor oficial tem prioridade. Na ausência dele, o app usa apenas regras explícitas de atividade e identifica o grupo como inferido; sem evidência suficiente, bloqueia a comparação.</p></section>;
}

function BenchmarkPanel({ asset, anomaly, benchmarks }) {
  const assetSeries = anomaly?.assets?.[asset.ticker]?.series ?? [];
  const rows = Object.values(benchmarks?.series ?? {}).map((benchmark) => ({ ...benchmark, comparison: synchronizedBenchmarkReturn(assetSeries, benchmark.series) }));
  const valid = rows.filter((row) => row.comparison.available);
  return <section className="v2-benchmark-panel"><div className="v2-section-title"><span>BENCHMARKS OFICIAIS</span><h2>Retorno na mesma janela do ativo</h2><p>Datas coincidentes, sem preencher pregões ausentes. Retorno relativo = ativo menos benchmark.</p></div>{valid.length ? <div className="v2-benchmark-grid">{valid.map((row) => <article key={row.id}><header><b>{row.id}</b><span>{row.status}</span></header><strong>{formatPercent(row.comparison.relativeReturnPct)}</strong><small>ativo {formatPercent(row.comparison.assetReturnPct)} • {row.name} {formatPercent(row.comparison.benchmarkReturnPct)}</small><em>{row.comparison.sessions} sessões • {date(row.comparison.startDate)} a {date(row.comparison.endDate)}</em><i>{row.source} • ref. {date(row.referenceDate)}</i></article>)}</div> : <div className="v2-unavailable-box"><b>Dados insuficientes para sincronizar benchmarks</b><span>O arquivo é consultado automaticamente. A comparação só aparece quando há ao menos dois pregões idênticos entre ativo e referência.</span></div>}</section>;
}

export default function ComparisonPage({ assets, anomalies, benchmarks, onBack, onOpen }) {
  const [tickers, setTickers] = useState(() => { try { const saved=JSON.parse(localStorage.getItem("b3-score-comparison-v1")??"[]"); return Array.isArray(saved)?saved.slice(0,4):[]; } catch { return []; } });
  const [candidate, setCandidate] = useState("");
  const [liveBenchmarks, setLiveBenchmarks] = useState(benchmarks ?? null);
  useEffect(() => localStorage.setItem("b3-score-comparison-v1", JSON.stringify(tickers)), [tickers]);
  useEffect(() => { const addSelic = (payload) => fetch(SELIC_URL, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((rows) => setLiveBenchmarks({ ...payload, series: { ...payload.series, SELIC: selicAccumulated(rows ?? []) } })).catch(() => setLiveBenchmarks(payload)); if (benchmarks?.series) { addSelic(benchmarks); return; } fetch(BENCHMARK_URL, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((payload) => payload?.series && addSelic(payload)).catch(() => void 0); }, [benchmarks]);
  const selected = tickers.map((ticker) => assets.find((asset) => asset.ticker === ticker)).filter(Boolean);
  const rows = useMemo(() => selected.map((asset) => ({ asset, values: comparisonMetrics(asset, anomalies?.assets?.[asset.ticker]) })), [selected, anomalies]);
  const add = () => { const ticker=candidate.toUpperCase(); if (assets.some((asset)=>asset.ticker===ticker)&&!tickers.includes(ticker)&&tickers.length<4) setTickers([...tickers,ticker]); setCandidate(""); };
  const lead = selected[0]; const sectorInfo = lead ? classifySector(lead) : null; const sector = sectorInfo?.label ?? null;
  const peers = sector ? assets.filter((asset) => classifySector(asset).label === sector && (asset.fundamentals || asset.fund)).slice(0,30) : [];
  return <div className="v2-page"><header className="v2-page-head"><button onClick={onBack}>← Início</button><div><span>COMPARAÇÃO MULTIDIMENSIONAL</span><h1>Comparador de ativos</h1><p>Compare até quatro ativos. Campos ausentes não entram como zero.</p></div></header>
    <section className="v2-picker"><label>Adicionar ativo<input list="compare-assets" value={candidate} onChange={(e)=>setCandidate(e.target.value.toUpperCase())} onKeyDown={(e)=>e.key==="Enter"&&add()} placeholder="PETR4"/><datalist id="compare-assets">{assets.map((asset)=><option key={asset.ticker} value={asset.ticker}>{asset.name}</option>)}</datalist></label><button onClick={add} disabled={!candidate||tickers.length>=4}>Adicionar</button><div>{selected.map((asset,index)=><button key={asset.ticker} style={{borderColor:COLORS[index]}} onClick={()=>setTickers(tickers.filter((ticker)=>ticker!==asset.ticker))}>{asset.ticker} ×</button>)}</div></section>
    {!selected.length ? <div className="v2-empty"><b>Selecione de dois a quatro ativos.</b><span>Use empresas do mesmo setor para múltiplos e ativos diferentes para observar risco e performance.</span></div> : <><section className="v2-chart-card"><div className="v2-section-title"><span>ÚLTIMOS 126 PREGÕES</span><h2>Performance normalizada</h2><p>Todos começam em 100; isso compara retorno, não preços nominais.</p></div><PerformanceChart selected={selected} anomalies={anomalies}/></section>
    <section className="v2-compare-table"><div className="v2-compare-row head"><span>Indicador</span>{rows.map(({asset})=><button key={asset.ticker} onClick={()=>onOpen(asset.ticker)}>{asset.ticker}<small>{formatMoney(asset.price)}</small></button>)}</div>{METRICS.map(([key,label,higher,format])=><div className="v2-compare-row" key={key}><span>{label}<small>{higher?"maior tende a ser melhor":"menor exige contexto"}</small></span>{rows.map(({asset,values})=><b key={asset.ticker}>{values[key]===null?"Dado indisponível":format(values[key])}</b>)}</div>)}</section>
    <DataCoverage lead={lead} anomalies={anomalies} benchmarks={liveBenchmarks} assets={assets}/><section className="v2-sector"><div className="v2-section-title"><span>COMPARAÇÃO COM PARES</span><h2>{sector ?? "Grupo de pares não formado"}</h2><p>{sector ? `${peers.length} ativos no grupo. ${sectorInfo.official ? "Classificação publicada pela fonte." : "Classificação inferida por regra explícita; confirme a atividade antes de comparar."}` : "Não há evidência suficiente para classificar o ativo sem criar um grupo arbitrário."}</p></div>{sector ? <div>{[["pe","P/L",false],["pb","P/VP",false],["roe","ROE",true],["score","Score",true]].map(([key,label,higher])=>{const current=comparisonMetrics(lead,anomalies?.assets?.[lead.ticker])[key];const values=peers.map((peer)=>comparisonMetrics(peer,anomalies?.assets?.[peer.ticker])[key]);const pos=relativePosition(current,values,higher);return <article key={key}><span>{label}</span><b>{current===null?"N/D":formatNumber(current)}</b><small>{pos.available?`mediana ${formatNumber(pos.median)} • posição ${pos.rank}/${pos.total}`:"Dados insuficientes"}</small></article>})}</div> : <div className="v2-unavailable-box"><b>Qual dado falta?</b><span>Não há regra segura para este nome/atividade. O app mantém o grupo bloqueado em vez de inventar comparáveis.</span></div>}</section><BenchmarkPanel asset={lead} anomaly={anomalies} benchmarks={liveBenchmarks}/>
    </>}</div>;
}
