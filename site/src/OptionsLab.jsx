import { useEffect, useMemo, useState } from "react";
import { blackScholes, impliedVolatility, optionDecomposition, optionLiquidityScore, strategyAnalysis } from "./quant/options-engine";

const number = (value, digits = 4) => value === null || value === undefined || !Number.isFinite(value) ? "Dado indisponível" : value.toLocaleString("pt-BR", { maximumFractionDigits: digits });
const money = (value) => value === null || value === undefined || !Number.isFinite(value) ? "Dado indisponível" : value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const STRATEGIES = { "long-call": "Call comprada", "long-put": "Put comprada", "covered-call": "Call coberta", "protective-put": "Put protetiva", "bull-call": "Bull Call Spread", "bear-put": "Bear Put Spread", collar: "Collar" };

function PayoffChart({ result }) {
  if (!result?.available) return null;
  const width = 720, height = 250, pad = 36;
  const xMin = result.points[0].underlying, xMax = result.points.at(-1).underlying;
  const values = result.points.map((point) => point.payoff);
  const yMin = Math.min(...values, 0), yMax = Math.max(...values, 0);
  const yRange = yMax - yMin || 1;
  const x = (value) => pad + (value - xMin) / (xMax - xMin) * (width - pad * 2);
  const y = (value) => height - pad - (value - yMin) / yRange * (height - pad * 2);
  const points = result.points.map((point) => `${x(point.underlying)},${y(point.payoff)}`).join(" ");
  return <figure className="payoff-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Gráfico de payoff no vencimento"><line x1={pad} x2={width - pad} y1={y(0)} y2={y(0)} /><polyline points={points} /></svg><figcaption>Eixo horizontal: preço do ativo no vencimento. Linha horizontal: resultado zero. Não inclui custos ou impostos.</figcaption></figure>;
}

export default function OptionsLab({ assets, anomalies }) {
  const stockAssets = assets.filter((asset) => asset.kind !== "fii" && asset.price > 0);
  const [ticker, setTicker] = useState(stockAssets.find((asset) => asset.ticker === "BBSE3")?.ticker ?? stockAssets[0]?.ticker ?? "");
  const [form, setForm] = useState({ type: "call", strike: "", premium: "", dte: "", rate: "", volatility: "", dividendYield: "", bid: "", ask: "", volume: "", openInterest: "", strategy: "long-call", quantity: "100", width: "", secondPremium: "" });
  const asset = stockAssets.find((item) => item.ticker === ticker);
  const historicalVolatility = anomalies?.assets?.[ticker]?.annualizedVolatilityPct ?? null;
  useEffect(() => { setForm((current) => ({ ...current, strike: "", premium: "", dte: "", rate: "", volatility: "", bid: "", ask: "", volume: "", openInterest: "", width: "", secondPremium: "" })); }, [ticker]);
  const parsed = useMemo(() => ({
    type: form.type, spot: asset?.price ?? null, strike: form.strike === "" ? null : Number(form.strike), marketPrice: form.premium === "" ? null : Number(form.premium), premium: form.premium === "" ? null : Number(form.premium), timeYears: form.dte === "" ? null : Number(form.dte) / 365, rate: form.rate === "" ? null : Number(form.rate) / 100, volatility: form.volatility === "" ? null : Number(form.volatility) / 100, dividendYield: form.dividendYield === "" ? 0 : Number(form.dividendYield) / 100,
  }), [form, asset]);
  const bs = useMemo(() => blackScholes(parsed), [parsed]);
  const iv = useMemo(() => impliedVolatility(parsed), [parsed]);
  const decomposition = useMemo(() => optionDecomposition({ type: form.type, spot: parsed.spot, strike: parsed.strike, premium: parsed.premium }), [form.type, parsed]);
  const liquidity = useMemo(() => optionLiquidityScore({ volume: form.volume === "" ? null : Number(form.volume), openInterest: form.openInterest === "" ? null : Number(form.openInterest), bid: form.bid === "" ? null : Number(form.bid), ask: form.ask === "" ? null : Number(form.ask) }), [form]);
  const payoff = useMemo(() => strategyAnalysis({ strategy: form.strategy, spot: parsed.spot, strike: parsed.strike, premium: parsed.premium, quantity: Number(form.quantity), width: form.width === "" ? null : Number(form.width), secondPremium: form.secondPremium === "" ? null : Number(form.secondPremium) }), [form, parsed]);
  const field = (key, label, props = {}) => <label>{label}<input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} type="number" step="any" min="0" {...props} /></label>;
  return <section className="options-lab"><div className="options-lab-head"><div><span>LABORATÓRIO DE CONTRATOS</span><h2>Black-Scholes, Greeks, IV e payoff</h2><p>O spot vem da B3. Os campos do contrato são informados pelo usuário e permanecem vazios até serem preenchidos.</p></div><strong>ESTRATÉGIA PARA ESTUDO</strong></div>
    <div className="option-source-warning"><b>Sem cadeia oficial integrada</b><span>Strike, prêmio, vencimento, bid, ask, volume e open interest abaixo não são obtidos automaticamente. Confira a fonte e a data antes de usar.</span></div>
    <div className="options-lab-grid"><aside><label>Ativo-objeto<select value={ticker} onChange={(e) => setTicker(e.target.value)}>{stockAssets.map((item) => <option value={item.ticker} key={item.ticker}>{item.ticker} • {money(item.price)}</option>)}</select></label><label>Tipo<select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="call">CALL</option><option value="put">PUT</option></select></label>{field("strike", "Strike (R$)")}{field("premium", "Prêmio de mercado (R$)")}{field("dte", "DTE (dias)")}{field("rate", "Taxa livre de risco a.a. (%)")}{field("volatility", "Volatilidade usada a.a. (%)")}{historicalVolatility !== null && <button type="button" onClick={() => setForm({ ...form, volatility: String(historicalVolatility) })}>Usar HV observada de {number(historicalVolatility, 2)}%</button>}{field("dividendYield", "Dividend yield a.a. (%)")}</aside>
      <div className="option-results"><div className="greeks-grid"><article><span>Spot B3</span><b>{money(asset?.price)}</b><small>{asset?.date ?? "data indisponível"}</small></article><article><span>Preço teórico</span><b>{bs.available ? money(bs.price) : "Dados insuficientes"}</b></article><article><span>IV estimada</span><b>{iv.available ? `${number(iv.volatility * 100, 2)}%` : "Não calculada"}</b><small>{iv.available ? `${iv.method} • erro ${number(iv.error, 8)}` : iv.reason}</small></article><article><span>Moneyness</span><b>{decomposition.available ? decomposition.moneyness : "N/D"}</b></article><article><span>Intrínseco</span><b>{decomposition.available ? money(decomposition.intrinsic) : "N/D"}</b></article><article><span>Extrínseco</span><b>{decomposition.available ? money(decomposition.extrinsic) : "N/D"}</b></article><article><span>Break-even</span><b>{decomposition.available ? money(decomposition.breakEven) : "N/D"}</b></article></div>
        <div className="greeks-grid compact">{[["Delta", bs.delta], ["Gamma", bs.gamma], ["Theta/dia", bs.theta], ["Vega/1 p.p.", bs.vega], ["Rho/1 p.p.", bs.rho], ["d1", bs.d1], ["d2", bs.d2]].map(([label, value]) => <article key={label}><span>{label}</span><b>{bs.available ? number(value, 6) : "N/D"}</b></article>)}</div>
        <details className="quant-trace"><summary><span>Auditar Black-Scholes</span><b>fórmula, entradas e limitações</b><i>⌄</i></summary><div><p><b>Modelo:</b> {bs.model ?? "Dados insuficientes para calcular."}</p><p><b>Fórmula:</b> {bs.formula ?? "Dados insuficientes para calcular."}</p><p><b>Entradas:</b> {bs.available ? `S=${number(bs.inputs.S)}, K=${number(bs.inputs.K)}, T=${number(bs.inputs.T, 6)}, r=${number(bs.inputs.r, 6)}, σ=${number(bs.inputs.sigma, 6)}, q=${number(bs.inputs.q, 6)}` : "Dado indisponível."}</p><p><b>Limitações:</b> {bs.limitation ?? "Preencha todas as entradas necessárias."}</p></div></details>
      </div></div>
    <section className="option-liquidity"><h3>Liquidez do contrato informado</h3><div>{field("bid", "Bid")}{field("ask", "Ask")}{field("volume", "Volume")}{field("openInterest", "Open interest")}</div><p>Score: <b>{liquidity.score ?? "N/D"}/100</b> • cobertura {liquidity.coverage}% • spread {liquidity.spreadPct === null ? "N/D" : `${number(liquidity.spreadPct, 2)}%`}</p>{liquidity.alert && <strong>{liquidity.alert}</strong>}<small>{liquidity.formula}</small></section>
    <section className="strategy-builder"><div className="strategy-controls"><label>Estratégia<select value={form.strategy} onChange={(e) => setForm({ ...form, strategy: e.target.value })}>{Object.entries(STRATEGIES).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>{field("quantity", "Quantidade", { min: "1" })}{["bull-call", "bear-put", "collar"].includes(form.strategy) && <>{field("width", "Distância entre strikes")}{field("secondPremium", "Prêmio da 2ª perna")}</>}</div>
      {payoff.available ? <><div className="payoff-summary"><article><span>Capital requerido</span><b>{money(payoff.capitalRequired)}</b></article><article><span>Lucro máximo na grade</span><b>{money(payoff.maxProfit)}</b></article><article><span>Prejuízo máximo na grade</span><b>{money(payoff.maxLoss)}</b></article><article><span>Break-even aproximado</span><b>{money(payoff.breakEven)}</b></article><article><span>Risco/retorno</span><b>{number(payoff.riskReward)}</b></article></div><PayoffChart result={payoff} /><p className="quant-note">{payoff.formula} {payoff.limitation}</p></> : <p className="quant-empty">{payoff.reason}</p>}
    </section>
  </section>;
}
