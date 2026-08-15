import { useMemo, useState } from "react";
import { buildQuantAnalysis } from "./quant/quant-engine.js";
import { detectMovement, explainPrice, marketContextScore, normalizeEvents, scenarioBands } from "./quant/context-engine.js";

const money = (value) => value == null ? "Dado indisponível" : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const number = (value, digits = 2) => value == null ? "Dado indisponível" : value.toLocaleString("pt-BR", { maximumFractionDigits: digits });
const pct = (value) => value == null ? "Dado indisponível" : `${value > 0 ? "+" : ""}${number(value)}%`;
const date = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "Dado indisponível";
const EVENT_LABELS = { dividend: "D", news: "N", anomaly: "A", macro: "M", sector: "C", result: "R" };
const METRICS = {
  netIncome: ["Lucro líquido", (row) => row.income?.netIncome],
  ebitda: ["EBITDA", (row) => row.income?.ebitda],
  equity: ["Patrimônio líquido", (row) => row.balance?.equity],
  freeCashFlow: ["Fluxo de caixa livre", (row) => row.cashFlow?.freeCashFlow],
  roe: ["ROE", (row) => row.income?.roe],
};

function pathFor(values, width, height, padding = 24) {
  const valid = values.filter((row) => Number.isFinite(row.value));
  if (valid.length < 2) return null;
  const min = Math.min(...valid.map((row) => row.value));
  const max = Math.max(...valid.map((row) => row.value));
  const span = max - min || 1;
  const x = (index) => padding + index / Math.max(1, values.length - 1) * (width - padding * 2);
  const y = (value) => height - padding - (value - min) / span * (height - padding * 2);
  return { points: values.map((row, index) => Number.isFinite(row.value) ? `${x(index)},${y(row.value)}` : "").filter(Boolean).join(" "), x, y, min, max };
}

function PriceVolumeChart({ series, fairValue, events, ticker }) {
  const [period, setPeriod] = useState("1y");
  const sessions = { "1m": 22, "3m": 66, "6m": 132, "1y": 260, max: Infinity }[period];
  const rows = series.slice(-sessions);
  if (rows.length < 2) return <p className="intelligence-empty">Dados insuficientes para gerar este gráfico.</p>;
  const width = 900, height = 320, priceHeight = 228, pad = 34;
  const plot = pathFor(rows.map((row) => ({ value: row.close })), width, priceHeight, pad);
  const maxVolume = Math.max(...rows.map((row) => Number(row.volume) || 0), 1);
  const fairY = fairValue == null ? null : plot.y(Math.max(plot.min, Math.min(plot.max, fairValue)));
  const eventPoints = events.map((event) => ({ event, index: rows.findIndex((row) => row.date >= String(event.date).slice(0, 10)) })).filter((item) => item.index >= 0);
  return <div className="asset-chart-wrap"><div className="chart-toolbar"><div>{Object.entries({ "1m": "1 mês", "3m": "3 meses", "6m": "6 meses", "1y": "1 ano", max: "Máximo" }).map(([key, label]) => <button className={period === key ? "active" : ""} onClick={() => setPeriod(key)} key={key}>{label}</button>)}</div><span>{rows.length} pregões • B3</span></div>
    <svg className="asset-main-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Preço, volume, valuation e eventos de ${ticker}`} preserveAspectRatio="none">
      <line className="chart-axis" x1={pad} x2={width - pad} y1={priceHeight - pad} y2={priceHeight - pad} />
      {fairY !== null && <><line className="fair-line" x1={pad} x2={width - pad} y1={fairY} y2={fairY} /><text x={width - pad} y={Math.max(14, fairY - 6)} textAnchor="end">Valor justo atual {money(fairValue)}</text></>}
      <polyline className="price-line" points={plot.points} />
      {rows.map((row, index) => <circle className="chart-hit" key={row.date} cx={plot.x(index)} cy={plot.y(row.close)} r="5"><title>{date(row.date)} • fechamento {money(row.close)} • variação {pct(row.returnPct)} • volume {money(row.volume)}</title></circle>)}
      {eventPoints.map(({ event, index }, eventIndex) => <g className={`event-marker event-${event.category}`} key={`${event.date}-${eventIndex}`}><circle cx={plot.x(index)} cy={Math.max(14, plot.y(rows[index].close) - 18)} r="10" /><text x={plot.x(index)} y={Math.max(18, plot.y(rows[index].close) - 14)} textAnchor="middle">{EVENT_LABELS[event.category] ?? "E"}</text><title>{date(event.date)} • {event.title} • relevância {Math.round(event.relevance)}/100 • {event.causality}</title></g>)}
      {rows.map((row, index) => { const h = (Number(row.volume) || 0) / maxVolume * 62; return <rect className={(Number(row.volume) || 0) > maxVolume * .75 ? "volume-bar abnormal" : "volume-bar"} key={`v-${row.date}`} x={plot.x(index) - Math.max(1, 360 / rows.length)} y={height - 22 - h} width={Math.max(2, 720 / rows.length)} height={h}><title>{date(row.date)} • volume {money(row.volume)}</title></rect>; })}
      <text className="chart-caption" x={pad} y={height - 5}>Volume sincronizado • marcadores: D provento, N notícia, A anomalia</text>
    </svg>
    {fairValue != null && (fairValue < plot.min || fairValue > plot.max) && <p className="chart-limitation">O valor justo atual está fora da escala observada; a referência foi limitada visualmente à borda. Não existe histórico de valor justo para desenhar uma série passada.</p>}
  </div>;
}

function FundamentalsChart({ history = [] }) {
  const availableKeys = Object.entries(METRICS).filter(([, [, getter]]) => history.some((row) => Number.isFinite(getter(row))));
  const [metric, setMetric] = useState(availableKeys[0]?.[0] ?? "netIncome");
  if (!availableKeys.length) return <p className="intelligence-empty">Dados insuficientes para gerar o gráfico de fundamentos.</p>;
  const effectiveMetric = availableKeys.some(([key]) => key === metric) ? metric : availableKeys[0][0];
  const [label, getter] = METRICS[effectiveMetric];
  const rows = [...history].reverse().filter((row) => Number.isFinite(getter(row)));
  const width = 760, height = 230, pad = 36;
  const plot = pathFor(rows.map((row) => ({ value: getter(row) })), width, height, pad);
  return <div className="fundamental-chart"><label>Métrica<select value={effectiveMetric} onChange={(event) => setMetric(event.target.value)}>{availableKeys.map(([key, [name]]) => <option key={key} value={key}>{name}</option>)}</select></label>
    {plot ? <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label} por exercício`} preserveAspectRatio="none"><line className="chart-axis" x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} /><polyline className="fundamental-line" points={plot.points} />{rows.map((row, index) => <g key={row.year}><circle cx={plot.x(index)} cy={plot.y(getter(row))} r="5"><title>{row.year} • {label}: {number(getter(row))}</title></circle><text x={plot.x(index)} y={height - 12} textAnchor="middle">{row.year}</text></g>)}</svg> : <p className="intelligence-empty">São necessários ao menos dois exercícios comparáveis.</p>}
  </div>;
}

function ScenarioChart({ bands, current }) {
  const valid = bands.filter((row) => Number.isFinite(row.low) && Number.isFinite(row.high));
  if (!valid.length) return <p className="intelligence-empty">Dados insuficientes para gerar cenários.</p>;
  const min = Math.min(current ?? Infinity, ...valid.map((row) => row.low));
  const max = Math.max(current ?? -Infinity, ...valid.map((row) => row.high));
  const span = max - min || 1;
  const x = (value) => 90 + (value - min) / span * 700;
  return <svg className="scenario-chart" viewBox="0 0 880 210" role="img" aria-label="Faixas dos cenários pessimista, base e otimista" preserveAspectRatio="none">
    {valid.map((row, index) => <g key={row.id}><text x="10" y={45 + index * 58}>{row.label}</text><line className={`scenario-band scenario-${row.id}`} x1={x(row.low)} x2={x(row.high)} y1={40 + index * 58} y2={40 + index * 58} /><circle cx={x(row.value)} cy={40 + index * 58} r="7"><title>{row.label}: {money(row.low)} a {money(row.high)} • centro {money(row.value)} • incerteza ±{number(row.uncertaintyPct)}%</title></circle></g>)}
    {current != null && <><line className="scenario-current" x1={x(current)} x2={x(current)} y1="12" y2="185" /><text x={x(current)} y="204" textAnchor="middle">Atual {money(current)}</text></>}
  </svg>;
}

function ScoreCard({ label, value, note }) {
  return <article className={value == null ? "missing" : ""}><span>{label}</span><b>{value == null ? "N/D" : `${Math.round(value)}/100`}</b><small>{note}</small></article>;
}

export default function AssetIntelligencePanel({ asset, assets, anomaly, radar }) {
  const analysis = useMemo(() => buildQuantAnalysis(asset, assets, anomaly), [asset, assets, anomaly]);
  const radarRow = useMemo(() => [...(radar?.strength ?? []), ...(radar?.pressure ?? [])].find((row) => row.ticker === asset.ticker) ?? null, [radar, asset.ticker]);
  const events = useMemo(() => normalizeEvents(asset, anomaly, radarRow), [asset, anomaly, radarRow]);
  const movement = useMemo(() => detectMovement(anomaly), [anomaly]);
  const context = useMemo(() => marketContextScore(events), [events]);
  const justification = useMemo(() => explainPrice(asset, analysis, events), [asset, analysis, events]);
  const scenarios = useMemo(() => scenarioBands(analysis), [analysis]);
  const fundamentals = asset.fundamentals;
  const scores = asset.kind === "fii" ? asset.fund?.scores ?? {} : fundamentals?.scores ?? {};
  return <section className="asset-intelligence" id="painel-grafico-ativo">
    <div className="intelligence-heading"><div><span className="eyebrow">PAINEL GRÁFICO DO ATIVO</span><h3>Preço, fundamentos, contexto e cenários</h3><p>Dados oficiais e cálculos reproduzíveis. Eventos mostram associação temporal — não causalidade automática.</p></div><i className={movement.relevant ? "relevant" : "normal"}>{movement.classification}</i></div>

    <div className="separated-scores" aria-label="Scores separados da análise"><ScoreCard label="Fundamentos" value={scores.overall} note="qualidade do ativo" /><ScoreCard label="Valuation" value={analysis.components.valuation.value} note="preço versus fundamentos" /><ScoreCard label="Momentum" value={analysis.components.momentum.value} note="retornos e RSI" /><ScoreCard label="Contexto" value={context.score} note={context.coverage ? `${context.coverage} evidências relevantes` : "sem notícia suficiente"} /><ScoreCard label="Risco" value={analysis.components.risk.value} note="volatilidade, drawdown e anomalias" /><ScoreCard label="Confiança" value={analysis.confidence} note={`cobertura ${analysis.coverage}%`} /></div>

    <section className="movement-panel"><div className="section-heading"><h4>Detector de movimentos</h4><span>janelas iguais e critérios estatísticos</span></div><div>{[["1 pregão", movement.return1Pct], ["5 pregões", movement.return5Pct], ["20 pregões", movement.return20Pct], ["Volatilidade a.a.", movement.annualizedVolatilityPct], ["Volume vs. média 20", movement.volumeVsAverage20Pct], ["Aceleração", movement.accelerationPct]].map(([label, value]) => <article key={label}><span>{label}</span><b>{pct(value)}</b></article>)}</div>{movement.limitations.map((item) => <small key={item}>{item}</small>)}</section>

    <PriceVolumeChart series={anomaly?.series ?? []} fairValue={analysis.levels.fair} events={events} ticker={asset.ticker} />

    <section className={`price-justification ${justification.state.tone}`}><div><span>JUSTIFICATIVA DO PREÇO ATUAL</span><h4>{justification.state.label}</h4><p>{justification.explanation}</p></div><div className="price-gap"><span>Preço × valor fundamental</span><b>{money(justification.currentPrice)} × {money(justification.fairValue)}</b><em>{pct(justification.gapPct)}</em></div><div className="context-factors"><article><b>Fatores positivos</b>{justification.positives.length ? justification.positives.map((item) => <span key={item}>+ {item}</span>) : <span>Dado indisponível</span>}</article><article><b>Fatores negativos</b>{justification.negatives.length ? justification.negatives.map((item) => <span key={item}>− {item}</span>) : <span>Dado indisponível</span>}</article></div></section>

    <details className="intelligence-disclosure" open><summary>Fundamentos históricos <i>⌄</i></summary><div><FundamentalsChart history={fundamentals?.history ?? []} /></div></details>
    <details className="intelligence-disclosure"><summary>Múltiplos históricos <i>⌄</i></summary><div><p className="intelligence-empty">Dados insuficientes para gerar uma série histórica de múltiplos. O app não combina o preço atual com lucros antigos para fabricar um histórico.</p></div></details>
    <details className="intelligence-disclosure"><summary>Performance relativa: IBOV, CDI e IPCA <i>⌄</i></summary><div><p className="intelligence-empty">Séries oficiais sincronizadas ainda indisponíveis. Nenhum benchmark foi aproximado ou inventado.</p></div></details>
    <details className="intelligence-disclosure" open><summary>Cenários futuros em faixas <i>⌄</i></summary><div><ScenarioChart bands={scenarios} current={asset.price} /><p className="chart-limitation">Estimativa baseada nos modelos válidos e na volatilidade observada; não é previsão garantida. Probabilidades não são exibidas sem calibração estatística.</p></div></details>

    <details className="evidence-panel" id="evidencias-ativo"><summary>Ver evidências ({events.length}) <i>⌄</i></summary><div>{events.length ? events.map((event, index) => <article key={`${event.date}-${index}`}><header><span>{EVENT_LABELS[event.category] ?? "E"}</span><div><b>{event.title}</b><small>{date(event.date)} • {event.source ?? "Fonte indisponível"} • relevância {Math.round(event.relevance)}/100</small></div><em className={`sentiment-${event.sentiment}`}>{event.sentiment}</em></header><p>{event.causality}</p><dl><div><dt>Relação</dt><dd>{event.relation}</dd></div><div><dt>Após 1 pregão</dt><dd>{pct(event.returnAfter1Pct)}</dd></div><div><dt>Após 5 pregões</dt><dd>{pct(event.returnAfter5Pct)}</dd></div><div><dt>Após 20 pregões</dt><dd>{pct(event.returnAfter20Pct)}</dd></div></dl>{event.url ? <a href={event.url} target="_blank" rel="noreferrer">Abrir evidência ↗</a> : <small>URL indisponível para esta evidência calculada.</small>}</article>) : <p className="intelligence-empty">Dado indisponível. Nenhum evento oficial ou notícia relevante foi vinculado ao ativo.</p>}</div></details>
    <p className="intelligence-method"><b>Como interpretar:</b> o painel separa fatos, cálculos, contexto e cenários. Notícias de baixa relevância não alteram a leitura. A decisão permanece com o usuário.</p>
  </section>;
}
