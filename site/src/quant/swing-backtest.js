import { finite, mean, stdev } from "./statistics.js";
import { swingSnapshot } from "./swing-engine.js";

const clean = (series = []) => series.filter((row) => finite(row?.close) !== null && row.close > 0).sort((a, b) => String(a.date).localeCompare(String(b.date)));
const median = (values) => { const ordered = values.filter((value) => finite(value) !== null).sort((a, b) => a - b); if (!ordered.length) return null; const middle = Math.floor(ordered.length / 2); return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2; };

// This reads only observations at or before `index`. Future rows are used
// later exclusively to measure the realised return.
export function swingSignalAt(series, index) {
  const rows = clean(series);
  if (index < 200 || index >= rows.length) return null;
  const snapshot = swingSnapshot(rows.slice(0, index + 1));
  if (snapshot.return60 === null || snapshot.return126 === null || snapshot.ma50 === null || snapshot.ma200 === null) return null;
  return {
    date: rows[index].date, price: rows[index].close, snapshot,
    filters: {
      momentum60: snapshot.return60 > 0,
      momentum60And126: snapshot.return60 > 0 && snapshot.return126 > 0,
      aboveMa50: snapshot.price > snapshot.ma50,
      ma50AboveMa200: snapshot.ma50 > snapshot.ma200,
    },
  };
}

const STRATEGIES = [
  { id: "A", label: "Momentum 60d", passes: (f) => f.momentum60 },
  { id: "B", label: "Momentum 60d + 126d", passes: (f) => f.momentum60And126 },
  { id: "C", label: "Momentum + preço > MM50", passes: (f) => f.momentum60And126 && f.aboveMa50 },
  { id: "D", label: "Momentum + preço > MM50 + MM50 > MM200", passes: (f) => f.momentum60And126 && f.aboveMa50 && f.ma50AboveMa200 },
];

function summarize(records) {
  const returns = records.map((row) => row.returnPct);
  if (!returns.length) return { samples: 0, positivePct: null, averagePct: null, medianPct: null, averageWinPct: null, averageLossPct: null, expectancyPct: null, profitFactor: null, volatilityPct: null };
  const wins = returns.filter((value) => value > 0), losses = returns.filter((value) => value <= 0);
  const avgWin = mean(wins), avgLoss = mean(losses.map(Math.abs));
  const winRate = wins.length / returns.length;
  const grossProfit = wins.reduce((sum, value) => sum + value, 0), grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  return { samples: returns.length, positivePct: winRate * 100, averagePct: mean(returns), medianPct: median(returns), averageWinPct: avgWin, averageLossPct: avgLoss, expectancyPct: (winRate * (avgWin ?? 0) - (1 - winRate) * (avgLoss ?? 0)), profitFactor: grossLoss ? grossProfit / grossLoss : null, volatilityPct: stdev(returns) };
}

export function backtestSwingTiming(series = [], { horizon = 126 } = {}) {
  const rows = clean(series);
  if (!Number.isInteger(horizon) || horizon < 20) return { available: false, reason: "Horizonte inválido. Use ao menos 20 pregões." };
  if (rows.length < 200 + horizon + 1) return { available: false, reason: `Dados insuficientes: são necessários ao menos ${200 + horizon + 1} pregões para validar este horizonte sem usar dados futuros.`, requiredSessions: 200 + horizon + 1, sessions: rows.length };
  const evaluations = STRATEGIES.map((strategy) => ({ ...strategy, records: [] }));
  for (let index = 200; index + horizon < rows.length; index += 1) {
    const signal = swingSignalAt(rows, index);
    if (!signal) continue;
    const future = rows[index + horizon];
    const returnPct = (future.close / signal.price - 1) * 100;
    for (const strategy of evaluations) if (strategy.passes(signal.filters)) strategy.records.push({ signalDate: signal.date, exitDate: future.date, entry: signal.price, exit: future.close, returnPct });
  }
  return {
    available: true, horizon, period: { start: rows[200].date, end: rows.at(-1)?.date ?? null },
    strategies: evaluations.map(({ records, passes, ...strategy }) => ({ ...strategy, ...summarize(records), records })),
    methodology: "Em cada data, os filtros usam somente preços até aquela data. O retorno é observado após o horizonte escolhido. O teste mede distribuição de retornos de sinais sobrepostos; não representa carteira, não inclui custos e não valida Score fundamental histórico.",
    limitations: ["Score fundamental histórico não é reconstruído porque os demonstrativos arquivados por data de divulgação ainda não estão integrados.", "Sinais podem se sobrepor; métricas não devem ser interpretadas como retorno acumulado de uma carteira.", "Custos, impostos, proventos, splits e sobrevivência do universo exigem camadas adicionais antes de concluir sobre uma estratégia."],
  };
}
