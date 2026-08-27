const REQUIRED_BENCHMARKS = Object.freeze([
  { id: "IBOV", name: "Ibovespa", kind: "ibov" },
  { id: "CDI", name: "CDI", kind: "cdi" },
]);

const finite = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);

function level(row) {
  return finite(row?.base100) ?? finite(row?.value);
}

function normalizedRows(source) {
  return (Array.isArray(source?.series) ? source.series : [])
    .map((row) => ({ date: row?.date, level: level(row) }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date ?? "") && row.level > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function baselineFor(rows, startDate) {
  const prior = rows.filter((row) => row.date < startDate).at(-1);
  return prior ?? rows.find((row) => row.date >= startDate) ?? null;
}

/** Align IBOV and CDI to the exact dates used by the battle curve. */
export function buildBattleBenchmarkSeries(payload, startDate, dates = []) {
  const requestedDates = [...new Set(dates.filter(Boolean))].sort();
  const series = REQUIRED_BENCHMARKS.map((definition) => {
    const source = payload?.series?.[definition.id] ?? null;
    const rows = normalizedRows(source);
    const baseline = baselineFor(rows, startDate);
    let cursor = 0;
    let current = null;
    const returns = {};
    for (const date of requestedDates) {
      while (cursor < rows.length && rows[cursor].date <= date) {
        current = rows[cursor];
        cursor += 1;
      }
      returns[date] = baseline && current?.date === date && current.date >= baseline.date
        ? (current.level / baseline.level - 1) * 100
        : null;
    }
    const lastDate = [...requestedDates].reverse().find((date) => returns[date] != null) ?? null;
    return {
      ...definition,
      status: source?.status ?? "INDISPONÍVEL",
      source: source?.source ?? null,
      referenceDate: source?.referenceDate ?? rows.at(-1)?.date ?? null,
      baselineDate: baseline?.date ?? null,
      latestReturnDate: lastDate,
      latestReturnPct: lastDate ? returns[lastDate] : null,
      returns,
      available: Boolean(baseline && requestedDates.some((date) => returns[date] != null)),
      current: Boolean(lastDate && lastDate === requestedDates.at(-1)),
    };
  });
  return {
    series,
    ready: series.every((item) => item.current),
    missing: series.filter((item) => !item.current).map((item) => item.id),
  };
}

export function mergeBenchmarksIntoBattleRows(rows, benchmarks) {
  return rows.map((row) => ({
    ...row,
    returns: {
      ...row.returns,
      ...Object.fromEntries(benchmarks.series.map((item) => [`benchmark-${item.id}`, item.returns[row.date]])),
    },
  }));
}

export function excessReturn(returnPct, benchmarkPct) {
  const left = finite(returnPct);
  const right = finite(benchmarkPct);
  return left == null || right == null ? null : left - right;
}
