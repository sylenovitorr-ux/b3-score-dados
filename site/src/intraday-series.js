const finite = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);

function timestamp(value) {
  if (value == null || value === "") return null;
  if (Number.isFinite(Number(value))) {
    const numeric = Number(value);
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function marketDate(value) {
  const instant = timestamp(value);
  if (instant == null) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function marketTime(value) {
  const instant = timestamp(value);
  if (instant == null) return "N/D";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(instant));
}

export function normalizeIntradaySeries(payload, ticker = "") {
  const symbol = String(ticker).toUpperCase();
  const v2 = (payload?.results ?? []).find((row) => String(row?.symbol ?? row?.requestedSymbol ?? "").toUpperCase() === symbol) ?? payload?.results?.[0];
  const v1 = (payload?.results ?? []).find((row) => String(row?.symbol ?? "").toUpperCase() === symbol) ?? payload?.results?.[0];
  const source = v2?.data?.historicalDataPrice ?? v1?.historicalDataPrice ?? payload?.historicalDataPrice ?? [];
  const byTime = new Map();
  for (const row of Array.isArray(source) ? source : []) {
    const time = timestamp(row?.date ?? row?.timestamp ?? row?.asOf);
    const close = finite(row?.close ?? row?.price);
    if (time == null || !(close > 0)) continue;
    byTime.set(time, {
      timestamp: time,
      date: marketDate(time),
      open: finite(row?.open) ?? close,
      high: finite(row?.high) ?? close,
      low: finite(row?.low) ?? close,
      close,
      volume: finite(row?.volume),
    });
  }
  const rows = [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp);
  const latestDate = rows.at(-1)?.date;
  return latestDate ? rows.filter((row) => row.date === latestDate) : [];
}

export function snapshotIntradaySeries(series = []) {
  return normalizeIntradaySeries({ historicalDataPrice: series.map((row) => ({ date: row?.asOf ?? row?.date, price: row?.price ?? row?.close, volume: row?.volume })) });
}

export function intradaySummary(rows = []) {
  if (!rows.length) return { open: null, close: null, high: null, low: null, changePct: null };
  const open = finite(rows[0].open) ?? finite(rows[0].close);
  const close = finite(rows.at(-1).close);
  const high = Math.max(...rows.map((row) => finite(row.high) ?? finite(row.close)).filter((value) => value != null));
  const low = Math.min(...rows.map((row) => finite(row.low) ?? finite(row.close)).filter((value) => value != null));
  return { open, close, high, low, changePct: open > 0 && close != null ? (close / open - 1) * 100 : null };
}
