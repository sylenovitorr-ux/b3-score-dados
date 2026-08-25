const DAY = 86400000;

const iso = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = (h + l - 7 * m + 114) % 31 + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const shift = (date, days) => new Date(date.getTime() + days * DAY);

export function b3Holidays(year) {
  const easter = easterSunday(year);
  return new Set([
    `${year}-01-01`, iso(shift(easter, -48)), iso(shift(easter, -47)), iso(shift(easter, -2)),
    `${year}-04-21`, `${year}-05-01`, iso(shift(easter, 60)), `${year}-09-07`, `${year}-10-12`,
    `${year}-11-02`, `${year}-11-15`, `${year}-11-20`, `${year}-12-24`, `${year}-12-25`, `${year}-12-31`,
  ]);
}

export function isB3TradingDate(value) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || [0, 6].includes(date.getUTCDay())) return false;
  return !b3Holidays(date.getUTCFullYear()).has(value);
}

export function nextB3TradingDate(base) {
  let date = new Date(`${base}T12:00:00Z`);
  do date = shift(date, 1); while (!isB3TradingDate(iso(date)));
  return iso(date);
}

export function previousB3TradingDate(base) {
  let date = new Date(`${base}T12:00:00Z`);
  do date = shift(date, -1); while (!isB3TradingDate(iso(date)));
  return iso(date);
}

export function tradingSessionsBetween(older, newer) {
  if (!older || !newer || older >= newer) return 0;
  let cursor = older;
  let count = 0;
  while (cursor < newer && count < 4000) {
    cursor = nextB3TradingDate(cursor);
    if (cursor <= newer) count += 1;
  }
  return count;
}

export function saoPauloNowParts(now = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, hour: Number(values.hour) };
}

export function expectedOfficialQuoteDate(now = new Date()) {
  const current = saoPauloNowParts(now);
  if (isB3TradingDate(current.date) && current.hour >= 21) return current.date;
  return previousB3TradingDate(current.date);
}
