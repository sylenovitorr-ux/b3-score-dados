import { useMemo, useState } from "react";
import { formatMoney, formatNumber, formatPercent } from "./formatters";

const numeric = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

function ActionSimulator({ assets }) {
  const stocks = assets.filter((asset) => asset.kind !== "fii");
  const [form, setForm] = useState({ ticker: "BBSE3", capital: "10000", entry: "", target: "", stop: "", costs: "0" });
  const asset = stocks.find((item) => item.ticker === form.ticker) ?? stocks[0];
  const result = useMemo(() => {
    const capital=numeric(form.capital),entry=numeric(form.entry)||asset?.price,target=numeric(form.target),stop=numeric(form.stop),costs=numeric(form.costs)??0;
    if (!(capital>0&&entry>0&&target>0&&stop>0)) return null;
    const quantity=Math.floor(capital/entry),used=quantity*entry+costs,risk=Math.max(0,(entry-stop)*quantity+costs),gain=(target-entry)*quantity-costs;
    return {quantity,used,risk,gain,riskPct:used?risk/used*100:null,returnPct:used?gain/used*100:null,riskReward:risk>0?gain/risk:null,entry,target,stop};
  }, [form,asset]);
  const set=(key,value)=>setForm({...form,[key]:value});
  return <section className="v2-simulator"><div className="v2-form-grid"><label>Ativo<select value={asset?.ticker??""} onChange={(e)=>{const next=stocks.find((a)=>a.ticker===e.target.value);setForm({...form,ticker:e.target.value,entry:next?.price?String(next.price):""})}}>{stocks.map((item)=><option key={item.ticker} value={item.ticker}>{item.ticker}</option>)}</select></label><label>Capital<input type="number" value={form.capital} onChange={(e)=>set("capital",e.target.value)}/></label><label>Entrada<input type="number" value={form.entry} placeholder={asset?.price?String(asset.price):"N/D"} onChange={(e)=>set("entry",e.target.value)}/></label><label>Alvo<input type="number" value={form.target} onChange={(e)=>set("target",e.target.value)}/></label><label>Stop<input type="number" value={form.stop} onChange={(e)=>set("stop",e.target.value)}/></label><label>Custos<input type="number" value={form.costs} onChange={(e)=>set("costs",e.target.value)}/></label></div>{result?<><div className="v2-sim-results">{[["Quantidade",result.quantity],["Capital usado",formatMoney(result.used)],["Risco financeiro",formatMoney(result.risk)],["Ganho potencial",formatMoney(result.gain)],["Risco",formatPercent(result.riskPct,false)],["Retorno potencial",formatPercent(result.returnPct)],["Relação R:R",formatNumber(result.riskReward)]].map(([label,value])=><article key={label}><span>{label}</span><b>{value}</b></article>)}</div><div className="v2-risk-line"><i style={{left:`${Math.max(0,Math.min(100,(result.stop/Math.max(result.target,.01))*100))}%`}}>STOP<br/>{formatMoney(result.stop)}</i><b style={{left:`${Math.max(0,Math.min(100,(result.entry/Math.max(result.target,.01))*100))}%`}}>ENTRADA<br/>{formatMoney(result.entry)}</b><em>ALVO<br/>{formatMoney(result.target)}</em></div></>:<p className="v2-empty">Informe alvo e stop para calcular. Nenhum valor ausente é substituído por zero.</p>}</section>;
}

function FiiSimulator({ assets }) {
  const fiis=assets.filter((asset)=>asset.kind==="fii"&&asset.fund);
  const [ticker,setTicker]=useState(""),[capital,setCapital]=useState("10000"),[months,setMonths]=useState("12");
  const asset=fiis.find((item)=>item.ticker===ticker)??fiis[0]; const amount=numeric(capital),period=numeric(months),dy=numeric(asset?.fund?.dy12);
  const quantity=amount&&asset?.price?Math.floor(amount/asset.price):null; const income=quantity!==null&&dy!==null&&period!==null?quantity*asset.price*(dy/100)*(period/12):null;
  return <section className="v2-simulator"><div className="v2-form-grid three"><label>FII<select value={asset?.ticker??""} onChange={(e)=>setTicker(e.target.value)}>{fiis.map((item)=><option key={item.ticker} value={item.ticker}>{item.ticker}</option>)}</select></label><label>Capital<input type="number" value={capital} onChange={(e)=>setCapital(e.target.value)}/></label><label>Prazo em meses<input type="number" value={months} onChange={(e)=>setMonths(e.target.value)}/></label></div><div className="v2-sim-results">{[["Cotas inteiras",quantity??"Dados insuficientes"],["Preço atual",formatMoney(asset?.price)],["DY 12m observado",dy===null?"Dado indisponível":formatPercent(dy,false)],["Renda bruta estimada",income===null?"Dados insuficientes":formatMoney(income)]].map(([label,value])=><article key={label}><span>{label}</span><b>{value}</b></article>)}</div><p className="v2-method-note">A projeção usa o DY observado nos últimos 12 meses como premissa explícita. Rendimentos futuros podem mudar.</p></section>;
}

export default function SimulatorPage({ assets, onBack, onOptions, portfolio }) {
  const [mode,setMode]=useState("hub");
  if(mode==="portfolio") return <div className="v2-page"><header className="v2-page-head"><button onClick={()=>setMode("hub")}>← Simuladores</button><div><span>APORTES E CENÁRIOS</span><h1>Simulador de carteira</h1></div></header>{portfolio}</div>;
  return <div className="v2-page"><header className="v2-page-head"><button onClick={mode==="hub"?onBack:()=>setMode("hub")}>← {mode==="hub"?"Início":"Simuladores"}</button><div><span>FERRAMENTAS ISOLADAS</span><h1>{mode==="hub"?"O que deseja simular?":mode==="stock"?"Posição em ação":"Renda de FII"}</h1><p>Cada cálculo mostra premissas e mantém dados ausentes como indisponíveis.</p></div></header>{mode==="hub"?<div className="v2-simulator-hub"><button onClick={()=>setMode("stock")}><i>↗</i><b>Ação</b><span>Entrada, alvo, stop e risco/retorno</span></button><button onClick={()=>setMode("fii")}><i>▥</i><b>FII</b><span>Cotas, DY observado e renda estimada</span></button><button onClick={()=>setMode("portfolio")}><i>▦</i><b>Carteira</b><span>Aportes mensais e cenários patrimoniais</span></button><button onClick={onOptions}><i>◉</i><b>Opções</b><span>Payoff, gregas, IV e estratégias</span></button></div>:mode==="stock"?<ActionSimulator assets={assets}/>:<FiiSimulator assets={assets}/>}</div>;
}
