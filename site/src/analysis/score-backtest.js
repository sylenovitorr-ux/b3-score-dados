const finite=(v)=>Number.isFinite(v)?v:null;
const bands=[[90,100],[80,89],[70,79],[60,69],[0,59]];
const bandFor=(score)=>bands.find(([min,max])=>score>=min&&score<=max)?.join("–")??null;

// Snapshots must be timestamped facts known on that date. Future prices are
// used exclusively after the snapshot date to measure realised performance.
export function backtestScoreSnapshots(snapshots=[],prices=[],{horizonSessions=126}={}){
 const orderedPrices=prices.filter(r=>finite(r?.close)!=null&&r.close>0&&r.date).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 const valid=snapshots.filter(s=>finite(s?.score)!=null&&finite(s?.confidence)!=null&&s.date).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 if(!valid.length)return{available:false,reason:"Não existem snapshots históricos do Score com data de cálculo. O app não reconstrói nota passada usando fundamentos futuros.",records:[]};
 const records=[];for(const s of valid){const i=orderedPrices.findIndex(p=>p.date===s.date);if(i<0||i+horizonSessions>=orderedPrices.length)continue;const entry=orderedPrices[i].close,exit=orderedPrices[i+horizonSessions].close;records.push({date:s.date,score:s.score,confidence:s.confidence,band:bandFor(s.score),entry,exit,returnPct:(exit/entry-1)*100});}
 if(!records.length)return{available:false,reason:"Há snapshots, mas não existe janela futura completa de preços para o horizonte selecionado.",records:[]};
 const groups=Object.values(records.reduce((a,r)=>{(a[r.band]??=[]).push(r);return a},{})).map(rows=>({band:rows[0].band,samples:rows.length,averageReturnPct:rows.reduce((s,r)=>s+r.returnPct,0)/rows.length,positivePct:rows.filter(r=>r.returnPct>0).length/rows.length*100,averageConfidence:rows.reduce((s,r)=>s+r.confidence,0)/rows.length}));
 return{available:true,horizonSessions,records,groups,methodology:"Cada registro usa apenas o Score e a confiança armazenados na data do snapshot. O preço futuro é lido somente após o horizonte. Resultados não incluem proventos, custos, impostos, ajustes corporativos ou controle de sobrevivência do universo.",limitations:["Não use para recalibrar pesos antes de possuir amostra suficiente e separação entre treino e validação.","Retorno de preço não equivale a retorno total sem eventos de proventos sincronizados."]};
}
