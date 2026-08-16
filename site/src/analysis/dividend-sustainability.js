const finite=(v)=>Number.isFinite(v)?v:null;
const median=(rows)=>{const a=rows.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2};

export function dividendSustainability(asset){
  const f=asset?.kind==="fii"?asset.fund:asset.fundamentals;if(!f)return{status:"insufficient_data",missing:["dados do ativo"]};
  const dy=finite(asset.kind==="fii"?f.dy12:f.dividendYield),regularity=finite(f.dividendRegularity),payout=finite(f.payout),events=Array.isArray(f.dividendEvents)?f.dividendEvents:[];
  const values=events.map(x=>finite(x.valuePerShare)).filter(v=>v!=null&&v>0),base=median(values),outliers=base?values.filter(v=>v>base*2).length:null;
  const recurring=regularity==null?null:regularity>=45?"mais recorrente no histórico disponível":regularity>=20?"recorrência parcial no histórico disponível":"baixa recorrência no histórico disponível";
  const payoutState=asset.kind==="fii"?null:payout==null?null:payout<=100?"compatível com lucro informado":"acima do lucro informado; exige investigação";
  const extraordinary=outliers==null?"não classificável":outliers?`${outliers} evento(s) acima de 2× a mediana por ação; podem ser extraordinários e exigem verificação.`:"nenhum evento acima de 2× a mediana por ação foi identificado.";
  const available=[dy,regularity,asset.kind==="fii"?0:payout].filter(v=>v!=null).length;
  return{status:available>=2?"available":"insufficient_data",dy12:dy,regularity,payout,events:events.length,recurring,payoutState,extraordinary,confidence:Math.round(available/(asset.kind==="fii"?2:3)*100),formula:"Regularidade = meses com proventos nos últimos 24 meses ÷ 24. Evento potencialmente extraordinário = valor por ação acima de 2× a mediana dos eventos disponíveis.",limitations:"A classificação de evento potencialmente extraordinário é um alerta estatístico, não uma confirmação contábil. DY histórico não é promessa de renda futura.",missing:[dy==null&&"DY 12m",regularity==null&&"regularidade de pagamentos",asset.kind!=="fii"&&payout==null&&"payout"].filter(Boolean)};
}
