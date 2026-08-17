import { useMemo, useState } from "react";
import { buildQuantAnalysis } from "./quant/quant-engine.js";
import { buildSwingCandidate } from "./quant/swing-engine.js";
import { backtestSwingTiming } from "./quant/swing-backtest.js";
import "./SwingPage.css";

const pct = (value) => value == null ? "N/D" : `${value > 0 ? "+" : ""}${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export default function SwingPage({ assets, anomalies, onBack, onOpen }) {
  const [minimum, setMinimum] = useState(70);
  const [onlyPositive, setOnlyPositive] = useState(true);
  const [validationTicker, setValidationTicker] = useState("");
  const [horizon, setHorizon] = useState(126);
  const rows = useMemo(() => assets.filter((asset) => asset.kind !== "fii").map((asset) => {
    const quant = buildQuantAnalysis(asset, assets, anomalies?.assets?.[asset.ticker], "swing_3_6m");
    return { asset, candidate: buildSwingCandidate(asset, quant, anomalies?.assets?.[asset.ticker]) };
  }).filter(({ candidate }) => candidate.score !== null && candidate.score >= minimum && (!onlyPositive || candidate.timing.trend.tone === "positive")).sort((a, b) => b.candidate.score - a.candidate.score), [assets, anomalies, minimum, onlyPositive]);
  const validationAsset = assets.find((asset) => asset.ticker === validationTicker) ?? rows[0]?.asset ?? null;
  const validation = useMemo(() => backtestSwingTiming(validationAsset ? anomalies?.assets?.[validationAsset.ticker]?.series ?? [] : [], { horizon }), [anomalies, horizon, validationAsset]);
  return <div className="swing-page">
    <div className="daily-radar-top"><button className="back-btn" onClick={onBack}>← Visão geral</button><span>CANDIDATAS 3–6M • hipótese pendente de validação histórica</span></div>
    <section className="swing-hero"><div><span>SELEÇÃO ≠ TIMING</span><h1>Candidatas para<br /><em>investigar em 3–6 meses.</em></h1><p>Esta é a aba pedida para ações de médio prazo: seleciona o que vale estudar; não sugere compra, preço futuro ou garantia de retorno.</p></div><aside><b>60–126</b><small>pregões esperados</small><p>Pesos iniciais configuráveis e pendentes de backtest.</p></aside></section>
    <section className="swing-controls"><label>Score mínimo<input type="number" min="0" max="100" value={minimum} onChange={(event) => setMinimum(Number(event.target.value))} /></label><label><input type="checkbox" checked={onlyPositive} onChange={(event) => setOnlyPositive(event.target.checked)} /> Somente tendência positiva</label><span>{rows.length} ativos com dados suficientes</span></section>
    <section className="swing-table"><div className="swing-head"><span># / Ativo</span><span>Swing</span><span>B3 Score</span><span>Timing</span><span>Tendência</span><span>60d / 126d</span><span>RSI</span><span>Risco</span></div>{rows.map(({ asset, candidate }, index) => <button key={asset.ticker} onClick={() => onOpen(asset.ticker)}><span><b>{index + 1}</b><strong>{asset.ticker}</strong><small>{asset.name}</small></span><b>{candidate.score}/100</b><b>{candidate.quality}/100</b><span><b>{candidate.timing.score}/100</b><small>{candidate.timing.state}</small></span><span><b>{candidate.timing.trend.label}</b><small>{candidate.state}</small></span><span>{pct(candidate.timing.snapshot.return60)}<small>{pct(candidate.timing.snapshot.return126)}</small></span><span>{candidate.timing.snapshot.rsi14?.toFixed(1) ?? "N/D"}</span><span>{candidate.risk ?? "N/D"}</span></button>)}</section>
    {!rows.length && <p className="quant-empty">Dados insuficientes para os filtros atuais. Ausências não são convertidas em zero.</p>}
    <section className="swing-validation"><div><span>VALIDAÇÃO HISTÓRICA</span><h2>Timing em dados passados</h2><p>O sinal é formado sem preços futuros; o retorno é medido depois do horizonte. O Score fundamental histórico ainda não é reconstruído, portanto não é fingido neste teste.</p></div><label>Ativo<select value={validationAsset?.ticker ?? ""} onChange={(event) => setValidationTicker(event.target.value)}>{assets.filter((asset) => asset.kind !== "fii").map((asset) => <option key={asset.ticker} value={asset.ticker}>{asset.ticker} — {asset.name}</option>)}</select></label><label>Horizonte<select value={horizon} onChange={(event) => setHorizon(Number(event.target.value))}><option value={60}>60 pregões</option><option value={90}>90 pregões</option><option value={126}>126 pregões</option></select></label>{validation?.available ? <div className="swing-validation-table">{validation.strategies.map((strategy) => <article key={strategy.id}><b>{strategy.id}</b><span>{strategy.label}</span><strong>{strategy.samples} sinais</strong><em>média {pct(strategy.averagePct)} • mediana {pct(strategy.medianPct)} • positivos {pct(strategy.positivePct)}</em></article>)}</div> : <p className="quant-empty">{validation?.reason ?? "Dados insuficientes para calcular."}</p>}<small>{validation?.methodology ?? "A atualização de histórico fornecerá a base necessária."}</small></section>
    <section className="swing-note"><b>Como funciona</b><p>O ranking combina qualidade, timing, confiança, liquidez e risco. Tendência, retornos, médias, RSI e volume formam o timing. Os pesos permanecem como regra pendente de validação por backtest.</p></section>
  </div>;
}
