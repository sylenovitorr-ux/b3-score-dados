import { useEffect, useMemo, useState } from "react";
import { analyzeOptionContract, strategyPayoffAtExpiration } from "./quant/options-engine";
import { formatMoney, formatNumber } from "./formatters";

const STORAGE_KEY = "b3-score-option-contracts-v1";
const STRATEGIES = { "long-call": "Call comprada", "long-put": "Put comprada", "covered-call": "Call coberta", "protective-put": "Put protetiva", "bull-call": "Bull Call Spread", "bear-put": "Bear Put Spread", collar: "Collar" };
const COMPONENTS = { liquidity: "Liquidez", priceVolatility: "Preço e volatilidade", strike: "Strike", time: "Tempo", riskReturn: "Risco/retorno" };
const initialForm = { contractTicker: "", type: "call", strike: "", premium: "", expiration: "", dte: "", rate: "", volatility: "", dividendYield: "", bid: "", ask: "", volume: "", openInterest: "", strategy: "long-call", quantity: "100", width: "", secondPremium: "", scenarioPct: "10" };
const initialFilters = { type: "all", moneyness: "all", dteMin: "", dteMax: "", volumeMin: "", openInterestMin: "", spreadMax: "", deltaMin: "", deltaMax: "", ivMin: "", ivMax: "", scoreMin: "", objective: "all", sort: "score" };
const num = (value) => value === "" || value === null || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const pct = (value, digits = 2) => value === null || value === undefined || !Number.isFinite(value) ? "Dado indisponível" : `${formatNumber(value, digits)}%`;
const localContracts = () => { try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };
const assetScores = (asset) => asset?.fund?.scores ?? asset?.fundamentals?.scores ?? null;

function PayoffChart({ result, strike }) {
  if (!result?.available) return null;
  const width = 760, height = 270, pad = 40;
  const xMin = result.points[0].underlying, xMax = result.points.at(-1).underlying;
  const values = result.points.map((point) => point.payoff), yMin = Math.min(...values, 0), yMax = Math.max(...values, 0), yRange = yMax - yMin || 1;
  const x = (value) => pad + (value - xMin) / (xMax - xMin) * (width - pad * 2);
  const y = (value) => height - pad - (value - yMin) / yRange * (height - pad * 2);
  const points = result.points.map((point) => `${x(point.underlying)},${y(point.payoff)}`).join(" ");
  const marker = (value, label, className) => Number.isFinite(value) && value >= xMin && value <= xMax ? <g className={className}><line x1={x(value)} x2={x(value)} y1={pad} y2={height - pad} /><text x={x(value) + 5} y={pad + 13}>{label}</text></g> : null;
  return <figure className="payoff-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Gráfico de payoff no vencimento"><line className="zero-line" x1={pad} x2={width - pad} y1={y(0)} y2={y(0)} />{marker(strike, "Strike", "strike-marker")}{marker(result.breakEven, "Break-even", "breakeven-marker")}<polyline points={points} /></svg><figcaption>Preço do ativo no vencimento × lucro ou prejuízo. Marcadores mostram strike e break-even; custos e impostos não estão incluídos.</figcaption></figure>;
}

function Metric({ label, value, note, tone = "" }) { return <article className={tone}><span>{label}</span><b>{value}</b>{note && <small>{note}</small>}</article>; }

export default function OptionsLab({ assets, anomalies, optionChain }) {
  const stockAssets = assets.filter((item) => item.kind !== "fii" && item.price > 0);
  const [ticker, setTicker] = useState(stockAssets.find((item) => item.ticker === "BBSE3")?.ticker ?? stockAssets[0]?.ticker ?? "");
  const [form, setForm] = useState(initialForm);
  const [officialId, setOfficialId] = useState("");
  const [contracts, setContracts] = useState(localContracts);
  const [filters, setFilters] = useState(initialFilters);
  useEffect(() => {
    if (!stockAssets.length || stockAssets.some((item) => item.ticker === ticker)) return;
    setTicker(stockAssets.find((item) => item.ticker === "BBSE3")?.ticker ?? stockAssets[0].ticker);
  }, [assets, stockAssets, ticker]);
  const asset = stockAssets.find((item) => item.ticker === ticker);
  const historicalVolatilityPct = anomalies?.assets?.[ticker]?.annualizedVolatilityPct ?? null;
  const officialContracts = useMemo(() => (optionChain?.contracts ?? []).filter((item) => item.underlying === ticker), [optionChain, ticker]);
  const selectedOfficial = officialContracts.find((item) => item.ticker === officialId) ?? null;
  const contract = useMemo(() => ({
    contractTicker: form.contractTicker.trim().toUpperCase(), underlyingTicker: ticker, type: form.type, spot: asset?.price ?? null,
    strike: num(form.strike), premium: num(form.premium), expiration: form.expiration || null, dte: num(form.dte), rate: num(form.rate) === null ? null : num(form.rate) / 100,
    volatility: num(form.volatility) === null ? null : num(form.volatility) / 100, dividendYield: num(form.dividendYield) === null ? 0 : num(form.dividendYield) / 100,
    bid: num(form.bid), ask: num(form.ask), volume: num(form.volume), openInterest: num(form.openInterest), strategy: form.strategy, quantity: num(form.quantity), width: num(form.width), secondPremium: num(form.secondPremium),
    source: selectedOfficial ? "B3 COTAHIST — fechamento diário" : "Informado manualmente pelo usuário", updatedAt: selectedOfficial ? optionChain?.quoteDate : null,
  }), [form, ticker, asset, selectedOfficial, optionChain]);
  const analysis = useMemo(() => analyzeOptionContract(contract, { historicalVolatilityPct, spotSource: "B3 COTAHIST", spotReferenceDate: asset?.date }), [contract, historicalVolatilityPct, asset]);
  const score = assetScores(asset);
  const set = (key, value) => { setOfficialId(""); setForm((current) => ({ ...current, [key]: value })); };
  const selectUnderlying = (value) => { setTicker(value); setOfficialId(""); setForm(initialForm); };
  const selectOfficial = (value) => {
    setOfficialId(value);
    const row = officialContracts.find((item) => item.ticker === value);
    if (!row) return;
    setForm((current) => ({ ...current, contractTicker: row.ticker, type: row.type, strike: String(row.strike), premium: String(row.premium), expiration: row.expiration, dte: "", rate: optionChain?.referenceRate?.valuePct === null || optionChain?.referenceRate?.valuePct === undefined ? "" : String(optionChain.referenceRate.valuePct), volatility: historicalVolatilityPct === null ? "" : String(historicalVolatilityPct), bid: "", ask: "", volume: row.volume === null ? "" : String(row.volume), openInterest: "", strategy: row.type === "put" ? "long-put" : "long-call" }));
  };
  useEffect(() => {
    if (officialId || form.contractTicker || !officialContracts.length || !(asset?.price > 0)) return;
    const reference = optionChain?.quoteDate ?? "";
    const candidates = officialContracts.filter((item) => item.expiration > reference && item.premium > 0);
    const pool = candidates.length ? candidates : officialContracts;
    const nearestExpiration = [...pool].sort((a, b) => a.expiration.localeCompare(b.expiration))[0]?.expiration;
    const nearest = pool.filter((item) => item.expiration === nearestExpiration).sort((a, b) => {
      const distance = Math.abs(a.strike - asset.price) - Math.abs(b.strike - asset.price);
      return distance || (b.volume ?? 0) - (a.volume ?? 0) || a.ticker.localeCompare(b.ticker);
    })[0];
    if (nearest) selectOfficial(nearest.ticker);
  }, [officialContracts, officialId, form.contractTicker, asset?.price, optionChain?.quoteDate]);
  const field = (key, label, props = {}) => <label>{label}<input value={form[key]} onChange={(event) => set(key, event.target.value)} type={props.type ?? "number"} step={props.step ?? "any"} min={props.min ?? (props.type === "date" ? undefined : "0")} placeholder={props.placeholder} /></label>;
  const persist = (next) => { setContracts(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); };
  const save = () => {
    if (!contract.contractTicker || !(contract.strike > 0) || !(contract.premium >= 0) || (!contract.expiration && !(contract.dte >= 0))) return;
    persist([{ ...contract, id: `${Date.now()}-${contract.contractTicker}`, updatedAt: new Date().toISOString() }, ...contracts]);
  };
  const savedRows = useMemo(() => contracts.map((saved) => {
    const underlying = stockAssets.find((item) => item.ticker === saved.underlyingTicker);
    const hv = anomalies?.assets?.[saved.underlyingTicker]?.annualizedVolatilityPct ?? null;
    return { saved, underlying, result: analyzeOptionContract({ ...saved, spot: underlying?.price ?? null }, { historicalVolatilityPct: hv, spotSource: "B3 COTAHIST", spotReferenceDate: underlying?.date }) };
  }).filter(({ saved, result }) => {
    const d = result.decomposition, l = result.liquidity.metrics, m = result.model, iv = result.implied.available ? result.implied.volatility * 100 : null, s = result.optionScore.score;
    const objectiveMatch = filters.objective === "all" || (filters.objective === "up" && saved.type === "call") || (filters.objective === "down" && saved.type === "put") || (filters.objective === "income" && saved.strategy === "covered-call") || (filters.objective === "protection" && ["protective-put", "collar"].includes(saved.strategy));
    return (filters.type === "all" || saved.type === filters.type) && (filters.moneyness === "all" || d.moneyness === filters.moneyness) && objectiveMatch &&
      (num(filters.dteMin) === null || result.contract.dte >= num(filters.dteMin)) && (num(filters.dteMax) === null || result.contract.dte <= num(filters.dteMax)) &&
      (num(filters.volumeMin) === null || l.volume >= num(filters.volumeMin)) && (num(filters.openInterestMin) === null || l.openInterest >= num(filters.openInterestMin)) &&
      (num(filters.spreadMax) === null || l.spreadPct <= num(filters.spreadMax)) && (num(filters.deltaMin) === null || m.delta >= num(filters.deltaMin)) &&
      (num(filters.deltaMax) === null || m.delta <= num(filters.deltaMax)) && (num(filters.ivMin) === null || iv >= num(filters.ivMin)) && (num(filters.ivMax) === null || iv <= num(filters.ivMax)) &&
      (num(filters.scoreMin) === null || s >= num(filters.scoreMin));
  }).sort((a, b) => filters.sort === "dte" ? (a.saved.dte ?? Infinity) - (b.saved.dte ?? Infinity) : filters.sort === "spread" ? (a.result.liquidity.metrics.spreadPct ?? Infinity) - (b.result.liquidity.metrics.spreadPct ?? Infinity) : (b.result.optionScore.score ?? -1) - (a.result.optionScore.score ?? -1)), [contracts, stockAssets, anomalies, filters]);
  const scenarioPrice = analysis.contract.spot && num(form.scenarioPct) !== null ? analysis.contract.spot * (1 + num(form.scenarioPct) / 100) : null;
  const scenarioPayoff = scenarioPrice === null ? null : strategyPayoffAtExpiration(form.strategy, scenarioPrice, analysis.contract);
  const scenarioReturn = scenarioPayoff !== null && analysis.payoff.capitalRequired > 0 ? scenarioPayoff / analysis.payoff.capitalRequired * 100 : null;
  const contractIndicationReady = Boolean(selectedOfficial && analysis.model.available && analysis.implied.available && analysis.liquidity.metrics.validBook && analysis.liquidity.metrics.openInterest !== null);

  return <section className="options-lab">
    <header className="options-lab-head"><div><span>LABORATÓRIO DE CONTRATOS</span><h2>Opções com cálculo auditável</h2><p>Selecione uma série oficial do fechamento B3 ou cadastre um contrato manual. IV, Greeks, Option Score e payoff são calculados localmente e separados do score fundamentalista do ativo.</p></div><strong>ESTRATÉGIA PARA ESTUDO</strong></header>
    <div className="option-source-warning official-chain"><b>{optionChain?.contracts?.length ? `Cadeia B3 carregada • ${optionChain.contracts.length} séries` : "Cadeia B3 aguardando atualização"}</b><span>{optionChain?.contracts?.length ? `Fechamento de ${optionChain.quoteDate}. Série, vencimento, strike, último prêmio e volume são oficiais. Bid/ask e open interest permanecem N/D porque não existem no COTAHIST.` : "O modo manual continua disponível. Nenhum contrato será fabricado enquanto o arquivo oficial não estiver disponível."}</span></div>
    <div className="options-lab-grid"><aside className="option-form">
      <label>Ativo-objeto<select value={ticker} onChange={(event) => selectUnderlying(event.target.value)}>{stockAssets.map((item) => <option value={item.ticker} key={item.ticker}>{item.ticker} • {formatMoney(item.price)}</option>)}</select></label>
      <label>Série oficial B3<select value={officialId} onChange={(event) => selectOfficial(event.target.value)}><option value="">{officialContracts.length ? `Selecione entre ${officialContracts.length} séries` : "Nenhuma série vinculada"}</option>{officialContracts.map((item) => <option value={item.ticker} key={item.ticker}>{item.ticker} • {item.type.toUpperCase()} • K {formatMoney(item.strike)} • {item.expiration} • {formatMoney(item.premium)}</option>)}</select></label>
      {field("contractTicker", "Ticker do contrato", { type: "text", placeholder: "Ex.: BBSEA..." })}<label>Tipo<select value={form.type} onChange={(event) => set("type", event.target.value)}><option value="call">CALL</option><option value="put">PUT</option></select></label>
      {field("strike", "Strike (R$)")}{field("premium", "Prêmio de mercado (R$)")}{field("expiration", "Vencimento", { type: "date" })}{field("dte", "DTE manual (fallback)")}{field("rate", "Taxa livre de risco a.a. (%)")}{field("volatility", "Volatilidade usada a.a. (%)")}
      {historicalVolatilityPct !== null && <button type="button" onClick={() => set("volatility", String(historicalVolatilityPct))}>Usar HV observada: {pct(historicalVolatilityPct)}</button>}{field("dividendYield", "Dividend yield a.a. (%)")}
      <button className="save-contract" type="button" onClick={save} disabled={!contract.contractTicker || !(contract.strike > 0) || !(contract.premium >= 0) || (!contract.expiration && !(contract.dte >= 0))}>Salvar contrato no dispositivo</button>
    </aside>
    <div className="option-results">
      <div className="option-score-panels"><article className="option-score-panel primary"><span>OPTION SCORE</span><strong>{analysis.optionScore.score ?? "—"}<small>/100</small></strong><b>{analysis.optionScore.score === null ? "Dados insuficientes" : `Cobertura ${analysis.optionScore.coverage}%`}</b><small>Qualidade matemática parcial; não é indicação de contrato.</small></article><article className="option-score-panel"><span>SCORE DO ATIVO</span><strong>{score?.overall ?? "—"}<small>/100</small></strong><b>Confiança {score?.confidence ?? "—"}%</b><small>Fundamentos do ativo-objeto. Exibido apenas como contexto.</small></article><article className={`option-score-panel liquidity-${analysis.liquidity.tone}`}><span>LIQUIDEZ</span><strong>{analysis.liquidity.label}</strong><b>{analysis.liquidity.score === null ? "Sem score" : `${analysis.liquidity.score}/100`}</b><small>{analysis.liquidity.reason}</small></article></div>
      <div className={`option-contract-readiness ${contractIndicationReady ? "ready" : "blocked"}`} style={{ display: "grid", gap: 5, margin: "12px 0", padding: "12px 14px", border: `1px solid ${contractIndicationReady ? "#8ec5a6" : "#e4c8a0"}`, borderLeft: `5px solid ${contractIndicationReady ? "#087a45" : "#b06b08"}`, borderRadius: 10, background: contractIndicationReady ? "#f3fbf6" : "#fffaf1", color: contractIndicationReady ? "#174c32" : "#633e08" }}><b>{contractIndicationReady ? "Contrato apto para comparação matemática" : "Indicação de contrato bloqueada"}</b><span style={{ fontSize: 12, lineHeight: 1.55 }}>{contractIndicationReady ? "Preço, modelo, IV, book e open interest estão disponíveis para esta fotografia de mercado." : "IV, Delta, Theta e preço teórico podem ser calculados, mas bid/ask e open interest não existem no COTAHIST. Confira esses dados na corretora; o app não transforma informação incompleta em indicação."}</span></div>
      <div className="greeks-grid"><Metric label="Spot B3" value={formatMoney(asset?.price)} note={asset?.date ?? "Data indisponível"}/><Metric label="DTE" value={analysis.dte.available ? analysis.dte.value : "N/D"} note={analysis.dte.reason ?? analysis.dte.expiration}/><Metric label="Moneyness" value={analysis.decomposition.available ? analysis.decomposition.moneyness : "N/D"} note={analysis.decomposition.available ? `strike ${pct(analysis.decomposition.distancePct)}` : analysis.decomposition.reason}/><Metric label="Preço teórico" value={analysis.model.available ? formatMoney(analysis.model.price) : "N/D"} note="Black-Scholes local"/><Metric label="IV estimada" value={analysis.implied.available ? pct(analysis.implied.volatility * 100) : "N/D"} note={analysis.implied.available ? analysis.implied.method : analysis.implied.reason}/><Metric label="Spread" value={analysis.liquidity.metrics.spreadPct === null ? "N/D" : pct(analysis.liquidity.metrics.spreadPct)} note={analysis.liquidity.metrics.spread === null ? "Bid/ask necessários" : formatMoney(analysis.liquidity.metrics.spread)}/><Metric label="Intrínseco" value={analysis.decomposition.available ? formatMoney(analysis.decomposition.intrinsic) : "N/D"}/><Metric label="Extrínseco" value={analysis.decomposition.available ? formatMoney(analysis.decomposition.extrinsic) : "N/D"}/><Metric label="Break-even" value={analysis.decomposition.available ? formatMoney(analysis.decomposition.breakEven) : "N/D"}/></div>
      <div className="greeks-grid compact">{[["Delta", analysis.model.delta], ["Gamma", analysis.model.gamma], ["Theta/dia", analysis.model.theta], ["Vega/1 p.p.", analysis.model.vega], ["Rho/1 p.p.", analysis.model.rho], ["d1", analysis.model.d1], ["d2", analysis.model.d2]].map(([label, value]) => <Metric key={label} label={label} value={analysis.model.available ? formatNumber(value, 6) : "N/D"}/>)}</div>
      <details className="quant-trace"><summary><span>Por que esta nota?</span><b>componentes, parâmetros e limitações</b><i>⌄</i></summary><div><div className="option-score-components">{Object.values(analysis.optionScore.components).map((item) => <article className={item.available ? "" : "missing"} key={item.key}><span>{COMPONENTS[item.key]}</span><b>{item.available ? `${item.score}/${item.max}` : "N/D"}</b><i><em style={{ width: `${item.available ? item.score / item.max * 100 : 0}%` }} /></i><small>{item.explanation}</small></article>)}</div><p><b>Leitura:</b> {analysis.optionScore.reason}</p><p><b>Fonte do contrato:</b> {analysis.metadata.contractSource}. <b>Spot:</b> {analysis.metadata.spotSource}, referência {analysis.metadata.spotReferenceDate ?? "indisponível"}. <b>Cálculos:</b> {analysis.metadata.calculations}, modelo {analysis.metadata.modelVersion}.</p><p><b>Limitações:</b> Option Score não prevê retorno, não substitui a análise do ativo e não é calculado com cobertura inferior a 70%.</p></div></details>
    </div></div>

    <section className="option-liquidity"><h3>Mercado e liquidez do contrato</h3><div>{field("bid", "Bid (R$)")}{field("ask", "Ask (R$)")}{field("volume", "Volume (quantidade)")}{field("openInterest", "Open interest")}</div>{analysis.liquidity.alert && <strong>{analysis.liquidity.alert}</strong>}<small>{analysis.liquidity.formula} No modo automático, volume vem da B3; bid/ask e OI continuam indisponíveis.</small></section>
    <section className="strategy-builder"><div className="strategy-controls"><label>Estratégia<select value={form.strategy} onChange={(event) => set("strategy", event.target.value)}>{Object.entries(STRATEGIES).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>{field("quantity", "Quantidade", { min: "1" })}{["bull-call", "bear-put", "collar"].includes(form.strategy) && <>{field("width", "Distância entre strikes")}{field("secondPremium", "Prêmio da 2ª perna")}</>}</div>
      {analysis.payoff.available ? <><div className="payoff-summary"><Metric label="Capital requerido" value={formatMoney(analysis.payoff.capitalRequired)}/><Metric label="Lucro máximo" value={analysis.payoff.profitUnlimited ? "Ilimitado" : formatMoney(analysis.payoff.maxProfit)}/><Metric label="Prejuízo máximo" value={formatMoney(analysis.payoff.maxLoss)}/><Metric label="Break-even" value={formatMoney(analysis.payoff.breakEven)}/><Metric label="Risco/retorno" value={formatNumber(analysis.payoff.riskReward, 2)}/></div><PayoffChart result={analysis.payoff} strike={contract.strike}/><div className="scenario-simulator"><div><h3>Simulador no vencimento</h3><p>Altere o cenário do ativo-objeto. O cálculo usa o payoff matemático da estratégia selecionada.</p></div>{field("scenarioPct", "Variação do ativo (%)", { min: "-100" })}<Metric label="Preço no cenário" value={formatMoney(scenarioPrice)}/><Metric label="P&L da posição" value={formatMoney(scenarioPayoff)} tone={scenarioPayoff >= 0 ? "positive" : "negative"}/><Metric label="Retorno sobre capital" value={pct(scenarioReturn)} tone={scenarioReturn >= 0 ? "positive" : "negative"}/></div><p className="quant-note">{analysis.payoff.formula} {analysis.payoff.limitation}</p></> : <p className="quant-empty">{analysis.payoff.reason}</p>}
    </section>

    <section className="option-workspace"><div className="workspace-head"><div><span>CARTEIRA DE ESTUDO LOCAL</span><h3>Filtrar e comparar contratos salvos</h3></div><b>{savedRows.length} de {contracts.length}</b></div><div className="option-filters"><label>Objetivo<select value={filters.objective} onChange={(e) => setFilters({ ...filters, objective: e.target.value })}><option value="all">Todos</option><option value="up">Alta</option><option value="down">Queda</option><option value="income">Renda</option><option value="protection">Proteção</option></select></label><label>Tipo<select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}><option value="all">CALL e PUT</option><option value="call">CALL</option><option value="put">PUT</option></select></label><label>Moneyness<select value={filters.moneyness} onChange={(e) => setFilters({ ...filters, moneyness: e.target.value })}><option value="all">Todos</option><option>ITM</option><option>ATM</option><option>OTM</option></select></label>{[["dteMin", "DTE mínimo"], ["dteMax", "DTE máximo"], ["volumeMin", "Volume mínimo"], ["openInterestMin", "OI mínimo"], ["spreadMax", "Spread máximo %"], ["deltaMin", "Delta mínimo"], ["deltaMax", "Delta máximo"], ["ivMin", "IV mínima %"], ["ivMax", "IV máxima %"], ["scoreMin", "Score mínimo"]].map(([key, label]) => <label key={key}>{label}<input type="number" step="any" value={filters[key]} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}/></label>)}<label>Ordenar<select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}><option value="score">Maior Option Score</option><option value="dte">Menor DTE</option><option value="spread">Menor spread</option></select></label><button type="button" onClick={() => setFilters(initialFilters)}>Limpar filtros</button></div>
      <div className="option-contract-list">{savedRows.length ? savedRows.map(({ saved, result }) => <details className="option-contract-card" key={saved.id}><summary><span><b>{saved.contractTicker}</b><small>{saved.underlyingTicker} • {saved.type.toUpperCase()} • {STRATEGIES[saved.strategy]}</small></span><span><b>{formatMoney(saved.premium)}</b><small>strike {formatMoney(saved.strike)}</small></span><span><b>{result.decomposition.moneyness ?? "N/D"}</b><small>DTE {result.contract.dte ?? "N/D"}</small></span><span className={`liquidity-badge ${result.liquidity.tone}`}><b>{result.liquidity.label}</b><small>spread {pct(result.liquidity.metrics.spreadPct)}</small></span><span className="contract-score"><b>{result.optionScore.score ?? "—"}</b><small>Option Score</small></span><i>⌄</i></summary><div><p>{result.optionScore.reason}</p><div className="contract-detail-grid"><Metric label="Bid / Ask" value={`${formatMoney(saved.bid)} / ${formatMoney(saved.ask)}`}/><Metric label="Volume / OI" value={`${formatNumber(saved.volume, 0)} / ${formatNumber(saved.openInterest, 0)}`}/><Metric label="IV / HV" value={`${result.implied.available ? pct(result.implied.volatility * 100) : "N/D"} / ${pct(anomalies?.assets?.[saved.underlyingTicker]?.annualizedVolatilityPct)}`}/><Metric label="Delta / Theta" value={`${formatNumber(result.model.delta, 4)} / ${formatNumber(result.model.theta, 4)}`}/></div><button type="button" className="remove-contract" onClick={() => persist(contracts.filter((item) => item.id !== saved.id))}>Remover contrato salvo</button></div></details>) : <p className="quant-empty">Nenhum contrato salvo corresponde aos filtros. Cadastre um contrato real acima; o app não cria exemplos fictícios.</p>}</div>
    </section>
  </section>;
}
