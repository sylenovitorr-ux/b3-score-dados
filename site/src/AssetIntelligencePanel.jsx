import { useMemo, useState } from "react";
import { buildQuantAnalysis } from "./quant/quant-engine.js";
import { detectMovement, explainPrice, marketContextScore, normalizeEvents, scenarioBands } from "./quant/context-engine.js";
import FinancialChart from "./FinancialChart.jsx";
import FundamentalReport from "./FundamentalReport.jsx";
import { expectedTotalReturn } from "./analysis/expected-return.js";
import { dividendSustainability } from "./analysis/dividend-sustainability.js";

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

function ExpectedReturnPanel({ asset, benchmarks }) {
  const reading = useMemo(() => expectedTotalReturn(asset, benchmarks), [asset, benchmarks]);
  const assessmentTone = reading.premiumAssessment.status === "adequate" ? "good" : reading.premiumAssessment.status === "insufficient" ? "bad" : "mid";
  return <section className={`expected-return-panel ${assessmentTone}`}><div className="section-heading"><div><span>RETORNO TOTAL ESPERADO</span><h4>Valorização, renda e custo de oportunidade</h4></div><b>{reading.status === "estimated" ? "Estimativa auditável" : "Dados insuficientes"}</b></div>{reading.status === "estimated" ? <><div className="expected-return-grid"><article><span>Valorização estimada</span><b>{pct(reading.appreciationPct)}</b><small>{reading.fairModel}</small></article><article><span>Proventos no horizonte</span><b>{pct(reading.incomePct)}</b><small>{reading.incomeBasis}</small></article><article><span>Retorno total</span><b>{pct(reading.totalPct)}</b><small>{reading.horizonMonths} meses</small></article><article><span>Retorno anualizado</span><b>{pct(reading.annualizedPct)}</b><small>estimativa, não promessa</small></article><article><span>CDI anualizado</span><b>{pct(reading.cdi.value)}</b><small>{reading.cdi.sessions} sessões • {reading.cdi.source}</small></article><article><span>Prêmio sobre CDI</span><b>{pct(reading.premiumPct)}</b><small>pontos percentuais ao ano</small></article><article><span>Margem de segurança</span><b>{pct(reading.marginOfSafetyPct)}</b><small>preço versus valor justo central</small></article><article><span>Confiança do valuation</span><b>{reading.valuationConfidence == null ? "N/D" : `${Math.round(reading.valuationConfidence)}%`}</b><small>{reading.valuationDispersionPct == null ? "uma âncora ou dispersão indisponível" : `dispersão das âncoras: ${pct(reading.valuationDispersionPct)}`}</small></article></div><p className="expected-return-assessment"><b>{reading.premiumAssessment.label}.</b> {reading.premiumAssessment.reason}. O limiar considera o Score de risco disponível; não é recomendação de aporte.</p><details><summary>Como chegamos neste resultado? <i>⌄</i></summary><p><b>Fórmula:</b> {reading.formula}</p><p><b>Premissas:</b> valor justo do modelo existente, DY/rendimento observado nos últimos 12 meses e horizonte de {reading.horizonMonths} meses. O CDI é composto a partir da série oficial disponível.</p><p><b>Limitações:</b> valor justo e proventos futuros podem mudar; o prêmio positivo não prova que o risco será compensado.</p></details></> : <p className="intelligence-empty"><b>Dados insuficientes para calcular o retorno total esperado.</b> Faltam: {reading.missing.join(", ") || "dados vinculados"}. O app não assume provento zero nem inventa CDI.</p>}</section>
}

function DividendSustainabilityPanel({asset}){const r=useMemo(()=>dividendSustainability(asset),[asset]);return <section className="dividend-sustainability"><div className="section-heading"><div><span>SUSTENTABILIDADE DOS PROVENTOS</span><h4>Renda observada não é renda garantida</h4></div><b>{r.status==="available"?`cobertura ${r.confidence}%`:"dados insuficientes"}</b></div>{r.status==="available"?<><div className="expected-return-grid"><article><span>DY 12 meses</span><b>{pct(r.dy12)}</b><small>observado</small></article><article><span>Regularidade</span><b>{pct(r.regularity)}</b><small>{r.recurring}</small></article>{asset.kind!=="fii"&&<article><span>Payout</span><b>{pct(r.payout)}</b><small>{r.payoutState}</small></article>}<article><span>Eventos analisados</span><b>{r.events}</b><small>fonte B3 quando disponível</small></article></div><p className="expected-return-assessment"><b>Eventos fora do padrão:</b> {r.extraordinary}</p><details><summary>Fórmula e limitações <i>⌄</i></summary><p>{r.formula}</p><p>{r.limitations}</p></details></>:<p className="intelligence-empty"><b>Dados insuficientes para avaliar sustentabilidade.</b> Faltam: {r.missing.join(", ")}.</p>}</section>}

function RelativePerformance({ assetSeries = [], benchmarks }) {
  const assetRows = assetSeries.filter((row) => Number.isFinite(row.close)).slice(-260);
  const benchmarkRows = Object.values(benchmarks?.series ?? {}).filter((item) => item.series?.length);
  if (assetRows.length < 2 || !benchmarkRows.length) return <p className="intelligence-empty">Séries oficiais sincronizadas ainda indisponíveis. Nenhum benchmark foi aproximado ou inventado.</p>;
  const startDate = assetRows[0].date, endDate = assetRows.at(-1).date;
  const results = [{ id: "ATIVO", name: "Ativo", value: (assetRows.at(-1).close / assetRows[0].close - 1) * 100, source: "B3 COTAHIST", referenceDate: endDate }];
  benchmarkRows.forEach((item) => {
    const matches = item.series.filter((row) => row.date >= startDate && row.date <= endDate && Number.isFinite(row.base100));
    if (matches.length < 2) return;
    results.push({ id: item.id, name: item.name, value: (matches.at(-1).base100 / matches[0].base100 - 1) * 100, source: item.source, referenceDate: matches.at(-1).date });
  });
  return <div className="relative-performance"><header><b>Janela comum</b><span>{date(startDate)} a {date(endDate)} • sem preencher dias ausentes</span></header><div>{results.map((row) => <article key={row.id}><span>{row.id}</span><b>{pct(row.value)}</b><small>{row.source}</small><em>ref. {date(row.referenceDate)}</em></article>)}</div><p>Retorno = valor final ÷ valor inicial − 1. CDI é composto pelas taxas diárias SGS 12; índices usam fechamento B3.</p></div>;
}

function DecisionSummary({ asset, analysis, justification, context, events, movement }) {
  const fundamentals = asset.kind === "fii" ? asset.fund ?? {} : asset.fundamentals ?? {};
  const score = fundamentals.scores?.overall ?? null;
  const discount = justification.gapPct == null ? null : -justification.gapPct;
  const confidence = analysis.confidence ?? null;
  const risk = analysis.components?.risk?.value ?? null;
  const valuation = analysis.components?.valuation?.value ?? null;
  const favorable = [];
  const cautions = [];
  if (discount != null && discount >= 15) favorable.push(`preço ${pct(discount)} abaixo do consenso dos modelos válidos`);
  if (score != null && score >= 65) favorable.push(`score fundamental de ${Math.round(score)}/100`);
  if (valuation != null && valuation >= 60) favorable.push(`valuation de ${Math.round(valuation)}/100`);
  if (risk != null && risk >= 60) favorable.push(`risco quantitativo dentro da faixa mais favorável (${Math.round(risk)}/100)`);
  if (discount != null && discount < 0) cautions.push(`preço ${pct(-discount)} acima do consenso dos modelos válidos`);
  if (score != null && score < 50) cautions.push(`fundamentos ainda frágeis (${Math.round(score)}/100)`);
  if (risk != null && risk < 50) cautions.push(`risco quantitativo elevado na janela observada (${Math.round(risk)}/100)`);
  if (movement.relevant) cautions.push("movimento recente estatisticamente relevante; não confundir volatilidade com oportunidade");
  if (confidence != null && confidence < 60) cautions.push(`confiança dos dados limitada (${Math.round(confidence)}/100)`);
  if (justification.fairValue == null) cautions.push("sem consenso de valor justo calculável");
  const companyEvents = events.filter((event) => event.relation === "empresa" && event.relevance >= 35).slice(0, 2);
  const externalEvents = events.filter((event) => ["setor", "macroeconomia"].includes(event.relation) && event.relevance >= 35).slice(0, 2);
  const studyState = confidence != null && confidence < 50 ? "Dados insuficientes para formar uma leitura de aquisição"
    : favorable.length >= 3 && cautions.length <= 1 ? "Faixa para estudo aprofundado"
      : cautions.length >= 3 ? "Priorizar investigação antes de alocar"
        : "Acompanhar antes de considerar uma posição";
  return <section className="decision-summary"><header><div><span className="eyebrow">SÍNTESE FINAL PARA ESTUDO</span><h3>{studyState}</h3><p>Esta leitura organiza evidências para decidir se vale aprofundar a análise. Não é recomendação de compra, venda ou garantia de retorno.</p></div><b>{confidence == null ? "Confiança N/D" : `Confiança ${Math.round(confidence)}/100`}</b></header><div className="decision-summary-grid"><article><h4>Por que considerar</h4>{favorable.length ? <ul>{favorable.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Nenhum fator favorável suficientemente verificável foi identificado no conjunto atual.</p>}</article><article><h4>Por que não agir agora</h4>{cautions.length ? <ul>{cautions.map((item) => <li key={item}>{item}</li>)}</ul> : <p>Nenhuma ressalva quantitativa relevante foi identificada; isso não elimina riscos não observados.</p>}</article></div><div className="decision-context"><article><span>CONTEXTO LOCAL — EMPRESA</span>{companyEvents.length ? companyEvents.map((event) => <p key={`${event.date}-${event.title}`}>{event.title} <small>({event.sentiment}; {event.source ?? "fonte indisponível"}; {date(event.date)})</small></p>) : <p>Sem evento corporativo relevante vinculado no conjunto atual.</p>}</article><article><span>CONTEXTO GLOBAL E SETORIAL</span>{externalEvents.length ? externalEvents.map((event) => <p key={`${event.date}-${event.title}`}>{event.title} <small>({event.sentiment}; {event.source ?? "fonte indisponível"}; {date(event.date)})</small></p>) : <p>Sem evento macroeconômico ou setorial relevante vinculado no conjunto atual.</p>}</article></div><footer><b>Por que o preço está nesse nível:</b> {justification.explanation} <span>Preço de referência: {money(justification.currentPrice)} em {date(asset.date)}. Valor justo consensual: {money(justification.fairValue)}. A divergência descreve uma hipótese quantitativa, não a causa comprovada do preço.</span></footer></section>;
}

export default function AssetIntelligencePanel({ asset, assets, anomaly, radar, benchmarks }) {
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

    <ExpectedReturnPanel asset={asset} benchmarks={benchmarks} />
    <DividendSustainabilityPanel asset={asset} />

    <section className="movement-panel"><div className="section-heading"><h4>Detector de movimentos</h4><span>janelas iguais e critérios estatísticos</span></div><div>{[["1 pregão", movement.return1Pct], ["5 pregões", movement.return5Pct], ["20 pregões", movement.return20Pct], ["Volatilidade a.a.", movement.annualizedVolatilityPct], ["Volume vs. média 20", movement.volumeVsAverage20Pct], ["Aceleração", movement.accelerationPct]].map(([label, value]) => <article key={label}><span>{label}</span><b>{pct(value)}</b></article>)}</div>{movement.limitations.map((item) => <small key={item}>{item}</small>)}</section>

    <FinancialChart series={anomaly?.series ?? []} fairValue={analysis.levels.fair} events={events} ticker={asset.ticker} />

    <section className={`price-justification ${justification.state.tone}`}><div><span>RESUMO DO PREÇO ATUAL</span><h4>{justification.state.label}</h4><p>{justification.explanation}</p><small>Leitura baseada no último fechamento B3 disponível, no consenso dos modelos válidos e nas evidências abaixo. Ela explica a divergência observada; não afirma causa nem prevê o próximo preço.</small></div><div className="price-gap"><span>Preço × valor fundamental</span><b>{money(justification.currentPrice)} × {money(justification.fairValue)}</b><em>{pct(justification.gapPct)}</em></div><div className="context-factors"><article><b>O que sustenta a leitura</b>{justification.positives.length ? justification.positives.map((item) => <span key={item}>+ {item}</span>) : <span>Não houve fator positivo verificável no conjunto disponível.</span>}</article><article><b>O que pode pressionar o preço</b>{justification.negatives.length ? justification.negatives.map((item) => <span key={item}>− {item}</span>) : <span>Não houve fator negativo verificável no conjunto disponível.</span>}</article></div></section>

    <details className="intelligence-disclosure" open><summary>Fundamentos históricos <i>⌄</i></summary><div><FundamentalsChart history={fundamentals?.history ?? []} /></div></details>
    <details className="intelligence-disclosure"><summary>Múltiplos históricos <i>⌄</i></summary><div><p className="intelligence-empty">Dados insuficientes para gerar uma série histórica de múltiplos. O app não combina o preço atual com lucros antigos para fabricar um histórico.</p></div></details>
    <details className="intelligence-disclosure"><summary>Performance relativa: IBOV, CDI e índices setoriais <i>⌄</i></summary><div><RelativePerformance assetSeries={anomaly?.series ?? []} benchmarks={benchmarks} /></div></details>
    <details className="intelligence-disclosure" open><summary>Cenários futuros em faixas <i>⌄</i></summary><div><ScenarioChart bands={scenarios} current={asset.price} /><p className="chart-limitation">Estimativa baseada nos modelos válidos e na volatilidade observada; não é previsão garantida. Probabilidades não são exibidas sem calibração estatística.</p></div></details>

    <details className="evidence-panel" id="evidencias-ativo"><summary>Ver evidências ({events.length}) <i>⌄</i></summary><div>{events.length ? events.map((event, index) => <article key={`${event.date}-${index}`}><header><span>{EVENT_LABELS[event.category] ?? "E"}</span><div><b>{event.title}</b><small>{date(event.date)} • {event.source ?? "Fonte indisponível"} • relevância {Math.round(event.relevance)}/100</small></div><em className={`sentiment-${event.sentiment}`}>{event.sentiment}</em></header><p>{event.causality}</p><dl><div><dt>Relação</dt><dd>{event.relation}</dd></div><div><dt>Após 1 pregão</dt><dd>{pct(event.returnAfter1Pct)}</dd></div><div><dt>Após 5 pregões</dt><dd>{pct(event.returnAfter5Pct)}</dd></div><div><dt>Após 20 pregões</dt><dd>{pct(event.returnAfter20Pct)}</dd></div></dl>{event.url ? <a href={event.url} target="_blank" rel="noreferrer">Abrir evidência ↗</a> : <small>URL indisponível para esta evidência calculada.</small>}</article>) : <p className="intelligence-empty">Dado indisponível. Nenhum evento oficial ou notícia relevante foi vinculado ao ativo.</p>}</div></details>
    <p className="intelligence-method"><b>Como interpretar:</b> o painel separa fatos, cálculos, contexto e cenários. Notícias de baixa relevância não alteram a leitura. A decisão permanece com o usuário.</p>
    <FundamentalReport asset={asset} assets={assets} anomaly={anomaly} />
    <DecisionSummary asset={asset} analysis={analysis} justification={justification} context={context} events={events} movement={movement} />
  </section>;
}
