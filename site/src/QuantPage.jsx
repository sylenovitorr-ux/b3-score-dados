import { useEffect, useMemo, useState } from "react";
import { DEFAULT_QUANT_PROFILE, PROFILE_CONFIG, profileConfig } from "./quant/config";
import { backtestMomentum, buildQuantAnalysis } from "./quant/quant-engine";
import { calculatePortfolio, migratePortfolio, normalizePosition, PORTFOLIO_STORAGE_KEY } from "./quant/portfolio-engine";

const money = (value) => value === null || value === undefined ? "Dado indisponível" : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const number = (value, digits = 2) => value === null || value === undefined ? "Dado indisponível" : value.toLocaleString("pt-BR", { maximumFractionDigits: digits });
const pct = (value) => value === null || value === undefined ? "Dado indisponível" : `${value > 0 ? "+" : ""}${number(value)}%`;
const LABELS = { valuation: "Valuation", quality: "Qualidade", growth: "Crescimento", profitability: "Rentabilidade", debt: "Endividamento", momentum: "Momentum", risk: "Risco", liquidity: "Liquidez", consistency: "Consistência", asymmetry: "Assimetria" };

function Trace({ title, result }) {
  return <details className="quant-trace"><summary><span>{title}</span><b>Como chegamos neste resultado?</b><i>⌄</i></summary><div>
    <dl><div><dt>Dado/resultado</dt><dd>{result.value === null || result.value === undefined ? "Dados insuficientes para calcular." : number(result.value)}</dd></div><div><dt>Fonte</dt><dd>{result.source ?? "Dado indisponível."}</dd></div><div><dt>Data de referência</dt><dd>{result.referenceDate ?? "Dado indisponível."}</dd></div><div><dt>Qualidade e confiança</dt><dd>{result.quality ?? "não classificada"} • {result.confidence ?? 0}/100</dd></div><div><dt>Fórmula</dt><dd>{result.formula ?? "Dados insuficientes para calcular."}</dd></div></dl>
    {result.inputs?.length ? <section className="trace-inputs">{result.inputs.map((item, index) => <span key={`${item.label}-${index}`}><b>{item.label}</b>{item.value === null || item.value === undefined ? "Dado indisponível" : number(item.value)}{item.source ? <small>{item.source}</small> : null}</span>)}</section> : null}
    <p><b>Interpretação:</b> {result.state === "unavailable" ? "O bloco não participa do Score e seu peso é redistribuído apenas entre evidências válidas." : "Pontuação normalizada de 0 a 100; deve ser combinada com os demais blocos."}</p>
    {result.limitation && <p><b>Limitação:</b> {result.limitation}</p>}
  </div></details>;
}

function DataHealth({ health }) {
  return <section className="quant-health"><h2>Validade e fonte dos dados</h2><div>{Object.entries(health).map(([key, item]) => <article key={key}><span>{key === "price" ? "Cotação" : key === "fundamentals" ? "Fundamentos" : "Histórico"}</span><b className={item.freshness.tone}>{item.freshness.label}</b><small>{item.source ?? "Dado indisponível"} • {item.referenceDate ?? "data indisponível"}</small><em>confiança {item.confidence}/100</em></article>)}</div></section>;
}

function QuantReading({ analysis }) {
  const items = [];
  const current = analysis.levels.current, fair = analysis.levels.fair, ma50 = analysis.technical.ma50, volatility = analysis.risk.volatility60Pct ?? analysis.risk.volatility20Pct;
  if (current !== null && fair !== null) items.push(current < fair ? `Negocia ${number((fair / current - 1) * 100)}% abaixo do valor justo consensual.` : `Negocia ${number((current / fair - 1) * 100)}% acima do valor justo consensual.`);
  if (current !== null && ma50 !== null) items.push(`Preço ${current >= ma50 ? "acima" : "abaixo"} da média móvel de 50 períodos.`);
  if (volatility !== null) items.push(`Volatilidade de ${pct(volatility)}; limite configurado do perfil: ${pct(analysis.profile.limits.volatilityPct)}.`);
  if (analysis.levels.riskReward !== null) items.push(`Relação risco/retorno de ${number(analysis.levels.riskReward)}, ${analysis.levels.riskReward >= analysis.profile.limits.minimumRiskReward ? "dentro" : "abaixo"} do mínimo configurado.`);
  items.push(`Cobertura ${analysis.coverage}% e confiança ${analysis.confidence}/100; ausências não foram convertidas em zero.`);
  return <section className="quant-reading"><div><span>LEITURA QUANT</span><h2>O que os blocos indicam em conjunto</h2><p>Resumo determinístico; abra a auditoria para verificar cada entrada.</p></div><ul>{items.map((item)=><li key={item}>{item}</li>)}</ul></section>;
}

function ValuationBlock({ analysis }) {
  const { valuation, levels } = analysis;
  return <section className="quant-section"><div className="quant-section-head"><div><span>VALUATION MULTIMODELO</span><h2>Valor justo consensual</h2></div><strong>{money(valuation.weighted)}</strong></div>
    <div className="valuation-consensus"><article><span>Média simples</span><b>{money(valuation.simple)}</b></article><article><span>Média ponderada</span><b>{money(valuation.weighted)}</b></article><article><span>Confiança</span><b>{valuation.confidence}/100</b></article><article><span>Entrada ({levels.safetyMarginPct}%)</span><b>{money(levels.entry)}</b></article></div>
    <div className="scenario-grid">{valuation.scenarios.map((scenario) => <article key={scenario.id}><span>{scenario.label}</span><b>{money(scenario.value)}</b><small>{scenario.premise}</small></article>)}</div><p className="quant-note">{valuation.probabilityLimitation}</p>
    <div className="valuation-models">{valuation.models.map((model) => <details key={model.model} className={model.available ? "available" : "unavailable"}><summary><span>{model.model}<small>{model.available ? `peso final ${valuation.weights[model.model] ?? 0}% • confiança ${model.confidence}/100` : "não participa do consenso"}</small></span><b>{model.available ? money(model.value) : "Dados insuficientes"}</b><i>⌄</i></summary><div><p><b>Fórmula:</b> {model.formula ?? "Dados insuficientes para calcular."}</p><p><b>Resultado intermediário:</b> {model.calculation ? JSON.stringify(model.calculation) : "Dados insuficientes para calcular."}</p><p><b>Limitação:</b> {model.limitation}</p>{model.inputs?.map((item) => <span key={item.label}>{item.label}: <b>{item.value === null ? "Dado indisponível" : number(item.value)}</b> <small>{item.source} • {item.referenceDate ?? "data não aplicável à premissa"} • {item.state}</small></span>)}</div></details>)}</div>
  </section>;
}

function RiskBlock({ analysis }) {
  const { technical: t, risk: r, levels } = analysis;
  const items = [["Retorno 1 mês", pct(t.return1m)], ["Retorno 3 meses", pct(t.return3m)], ["Retorno 6 meses", pct(t.return6m)], ["Retorno 12 meses", pct(t.return12m)], ["MM20", money(t.ma20)], ["MM50", money(t.ma50)], ["MM200", money(t.ma200)], ["RSI14", number(t.rsi14)], ["Volatilidade 20d a.a.", pct(r.volatility20Pct)], ["Volatilidade 60d a.a.", pct(r.volatility60Pct)], ["VaR histórico 95% (1d)", pct(r.historicalVaR95OneDayPct)], ["Drawdown máximo", pct(r.maximumDrawdown?.valuePct)], ["Relação risco/retorno", number(levels.riskReward)], ["Beta", "Dados insuficientes para calcular."]];
  return <section className="quant-section"><div className="quant-section-head"><div><span>RISCO E MOMENTUM</span><h2>Janela e fórmula visíveis</h2></div><strong>{t.sessions} pregões</strong></div><div className="risk-grid">{items.map(([label, value]) => <article key={label}><span>{label}</span><b>{value}</b></article>)}</div>
    {r.maximumDrawdown && <details className="quant-trace"><summary><span>Drawdown auditável</span><b>pico, fundo e recuperação</b><i>⌄</i></summary><div><p>Pico: <b>{money(r.maximumDrawdown.peak)}</b> em {r.maximumDrawdown.peakDate}. Fundo: <b>{money(r.maximumDrawdown.trough)}</b> em {r.maximumDrawdown.troughDate}.</p><p>Tempo até o fundo: {r.maximumDrawdown.daysToTrough} pregões. Recuperação: {r.maximumDrawdown.recovered ? `${r.maximumDrawdown.daysToRecovery} pregões, em ${r.maximumDrawdown.recoveryDate}` : "não observada na janela"}.</p></div></details>}
    <p className="quant-note">{r.formula} Todo indicador técnico é contexto e não gera ordem isoladamente.</p>
  </section>;
}

function PortfolioBook({ assets, anomalies, profile }) {
  const [positions, setPositions] = useState(() => {
    try { return migratePortfolio(JSON.parse(localStorage.getItem(PORTFOLIO_STORAGE_KEY) ?? "null")).positions; } catch { return []; }
  });
  const [form, setForm] = useState({ ticker: "", quantity: "", averagePrice: "", date: "", brokerage: "" });
  useEffect(() => { localStorage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify({ version: 2, positions })); }, [positions]);
  const portfolio = useMemo(() => calculatePortfolio(positions, assets, anomalies?.assets, profile), [positions, assets, anomalies, profile]);
  const add = (event) => {
    event.preventDefault();
    const asset = assets.find((item) => item.ticker === form.ticker.trim().toUpperCase());
    const next = normalizePosition({ ...form, quantity: Number(form.quantity), averagePrice: Number(form.averagePrice), brokerage: form.brokerage === "" ? null : Number(form.brokerage), assetType: asset?.kind });
    if (!next) return;
    setPositions((current) => [...current, next]);
    setForm({ ticker: "", quantity: "", averagePrice: "", date: "", brokerage: "" });
  };
  return <section className="quant-section portfolio-book"><div className="quant-section-head"><div><span>CARTEIRA REAL • LOCAL</span><h2>Posições e concentração</h2></div><strong>{money(portfolio.currentValue)}</strong></div>
    <form onSubmit={add} className="position-form"><label>Ticker<input required value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value.toUpperCase() })} placeholder="BBSE3" /></label><label>Quantidade<input required min="0.0001" step="any" type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></label><label>Preço médio<input required min="0" step="any" type="number" value={form.averagePrice} onChange={(e) => setForm({ ...form, averagePrice: e.target.value })} /></label><label>Data<input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label><label>Corretagem<input min="0" step="any" type="number" value={form.brokerage} onChange={(e) => setForm({ ...form, brokerage: e.target.value })} placeholder="opcional" /></label><button>Adicionar posição</button></form>
    <div className="portfolio-totals"><article><span>Custo</span><b>{money(portfolio.totalCost)}</b></article><article><span>P&amp;L</span><b className={portfolio.pnl >= 0 ? "positive" : "negative"}>{money(portfolio.pnl)}</b></article><article><span>Rentabilidade</span><b>{pct(portfolio.returnPct)}</b></article><article><span>Top 3</span><b>{pct(portfolio.top3Pct)}</b></article><article><span>Top 5</span><b>{pct(portfolio.top5Pct)}</b></article><article><span>Cobertura</span><b>{number(portfolio.coveragePct)}%</b></article></div>
    {portfolio.rows.length ? <div className="positions-table">{portfolio.rows.map((row) => <article key={row.id}><span><b>{row.ticker}</b><small>{row.className} • {row.sector}</small></span><span><b>{number(row.quantity)}</b><small>quantidade</small></span><span><b>{money(row.averagePrice)}</b><small>preço médio</small></span><span><b>{money(row.currentPrice)}</b><small>preço atual</small></span><span><b>{pct(row.returnPct)}</b><small>{row.weightPct === undefined ? "peso indisponível" : `${number(row.weightPct)}% da carteira`}</small></span><button aria-label={`Remover ${row.ticker}`} onClick={() => setPositions((current) => current.filter((item) => item.id !== row.id))}>×</button></article>)}</div> : <p className="quant-empty">Nenhuma posição cadastrada. Os dados ficam apenas neste navegador.</p>}
    {portfolio.alerts.map((alert) => <p className="portfolio-alert" key={alert}>{alert}</p>)}
    <p className="quant-note"><b>Volatilidade agregada:</b> Dados insuficientes para calcular. {portfolio.aggregateVolatilityLimitation}</p>
  </section>;
}

export default function QuantPage({ assets, anomalies, initialTicker, onBack, onOpen }) {
  const [profileId, setProfileId] = useState(() => localStorage.getItem("b3-score-quant-profile-v1") || DEFAULT_QUANT_PROFILE);
  const [overrides, setOverrides] = useState({ limits: {} });
  const [ticker, setTicker] = useState(() => initialTicker ?? assets.find((asset) => asset.ticker === "BBSE3")?.ticker ?? assets.find((asset) => asset.fundamentals || asset.fund)?.ticker ?? "");
  useEffect(() => { localStorage.setItem("b3-score-quant-profile-v1", profileId); }, [profileId]);
  useEffect(() => { if (!ticker && assets.length) setTicker(assets.find((asset) => asset.fundamentals || asset.fund)?.ticker ?? assets[0].ticker); }, [assets, ticker]);
  useEffect(() => { if (initialTicker && assets.some((asset) => asset.ticker === initialTicker)) setTicker(initialTicker); }, [assets, initialTicker]);
  const profile = useMemo(() => profileConfig(profileId, overrides), [profileId, overrides]);
  const asset = assets.find((item) => item.ticker === ticker) ?? null;
  const analysis = useMemo(() => asset ? buildQuantAnalysis(asset, assets, anomalies?.assets?.[ticker], profile) : null, [asset, assets, anomalies, ticker, profile]);
  const backtest = useMemo(() => backtestMomentum(anomalies?.assets?.[ticker]?.series ?? []), [anomalies, ticker]);
  const setLimit = (key, value) => setOverrides((current) => ({ ...current, limits: { ...current.limits, [key]: Number(value) } }));
  return <div className="quant-page"><div className="daily-radar-top"><button className="back-btn" onClick={onBack}>← Visão geral</button><span>Motor quantitativo auditável • versão 1.0</span></div>
    <section className="quant-hero"><div><span className="eyebrow">CENTRAL QUANTITATIVA</span><h1>Fatos não mudam.<br /><em>Limites mudam.</em></h1><p>O perfil altera pesos, filtros e tolerâncias — nunca cotações, volatilidade, balanços ou qualquer fato observado.</p></div><div className="quant-profile-card"><label>Perfil<select value={profileId} onChange={(e) => setProfileId(e.target.value)}>{Object.values(PROFILE_CONFIG).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><strong>{profile.label}</strong><span>Pesos somam {analysis?.weightValidation.total ?? 100}%</span><small>Perfil padrão do projeto: Agressivo</small></div></section>
    <details className="profile-limits"><summary>Configurar limites auditáveis do perfil <i>⌄</i></summary><div>{[["maxAssetPct", "Máximo por ativo (%)"], ["maxSectorPct", "Máximo por setor (%)"], ["drawdownPct", "Drawdown tolerado (%)"], ["volatilityPct", "Volatilidade tolerada (%)"], ["derivativesPct", "Máximo em derivativos (%)"], ["minimumDailyVolume", "Liquidez mínima (R$)"], ["minimumRiskReward", "Assimetria mínima"], ["safetyMarginPct", "Margem de segurança (%)"]].map(([key, label]) => <label key={key}>{label}<input type="number" step="any" value={profile.limits[key]} onChange={(e) => setLimit(key, e.target.value)} /></label>)}</div></details>
    <section className="quant-selector"><label>Ativo analisado<input list="quant-assets" value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="Digite um ticker" /><datalist id="quant-assets">{assets.map((item) => <option key={item.ticker} value={item.ticker}>{item.name}</option>)}</datalist></label>{asset && <button onClick={() => onOpen(asset.ticker)}>Abrir análise fundamental completa →</button>}</section>
    {!analysis ? <div className="quant-empty">Dado indisponível. Selecione um ativo válido.</div> : <>
      <DataHealth health={analysis.dataHealth} />
      <section className="quant-score"><div className="quant-score-main"><span>B3 SCORE QUANTITATIVO</span><strong>{analysis.score ?? "N/D"}<small>/100</small></strong><b>{analysis.classification}</b><em>Confiança {analysis.confidence}/100 • cobertura {analysis.coverage}%</em></div><div className="quant-components">{Object.entries(analysis.components).map(([key, component]) => <article key={key} className={component.value === null ? "missing" : ""}><span>{LABELS[key]} <small>peso {analysis.profile.weights[key]}%</small></span><b>{component.value ?? "N/D"}</b><i><em style={{ width: `${component.value ?? 0}%` }} /></i></article>)}</div></section>
      <QuantReading analysis={analysis} />
      <section className="trace-list"><h2>Auditoria do Score</h2>{Object.entries(analysis.components).map(([key, component]) => <Trace key={key} title={LABELS[key]} result={component} />)}</section>
      <ValuationBlock analysis={analysis} />
      <section className="quant-levels"><article><span>Preço atual</span><b>{money(analysis.levels.current)}</b><small>B3 em {asset.date}</small></article><article><span>Valor justo</span><b>{money(analysis.levels.fair)}</b><small>consenso dos modelos válidos</small></article><article><span>Entrada</span><b>{money(analysis.levels.entry)}</b><small>margem explícita de {analysis.levels.safetyMarginPct}%</small></article><article><span>Saída/alvo</span><b>{money(analysis.levels.exit)}</b><small>referência de valuation, não ordem</small></article><article><span>Saída defensiva</span><b>{money(analysis.levels.stop)}</b><small>mínima recente versus limite do perfil</small></article><article><span>Assimetria R:R</span><b>{number(analysis.levels.riskReward)}</b><small>upside {pct(analysis.levels.upsidePct)} / downside {pct(analysis.levels.downsidePct)}</small></article></section>
      <RiskBlock analysis={analysis} />
      <section className="quant-section"><div className="quant-section-head"><div><span>BACKTEST</span><h2>Regra MM20/MM50</h2></div><strong>{backtest.available ? `${backtest.operations} operações` : "Indisponível"}</strong></div>{backtest.available ? <div className="portfolio-totals"><article><span>Taxa de acerto</span><b>{pct(backtest.winRatePct)}</b></article><article><span>Ganho médio</span><b>{pct(backtest.averageGainPct)}</b></article><article><span>Perda média</span><b>{pct(-backtest.averageLossPct)}</b></article><article><span>Expectância</span><b>{pct(backtest.expectancyPct)}</b></article><article><span>Profit factor</span><b>{number(backtest.profitFactor)}</b></article></div> : <p className="quant-empty">{backtest.reason}</p>}<p className="quant-note">{backtest.methodology ?? "O teste não é executado quando a amostra não sustenta estatística mínima."}</p></section>
      <PortfolioBook assets={assets} anomalies={anomalies} profile={profile} />
      <section className="quant-section"><div className="quant-section-head"><div><span>BENCHMARKS</span><h2>CDI, IBOV e IPCA</h2></div><strong>Dado indisponível</strong></div><p className="quant-empty">A arquitetura está preparada, mas não existe ainda uma série oficial sincronizada desses três benchmarks no repositório. Nenhum histórico foi inventado.</p></section>
    </>}
  </div>;
}
