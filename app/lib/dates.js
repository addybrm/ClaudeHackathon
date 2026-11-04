// Date helpers that work on plain "YYYY-MM-DD" strings in UTC, so time zones and
// daylight saving can't shift a day.

const DAY_MS = 86_400_000;

export function isIsoDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
}

export function toDayNumber(iso) {
  return Math.round(Date.parse(iso + "T00:00:00Z") / DAY_MS);
}

export function fromDayNumber(n) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  return fromDayNumber(toDayNumber(iso) + days);
}

export function diffDays(a, b) {
  return toDayNumber(a) - toDayNumber(b);
}
