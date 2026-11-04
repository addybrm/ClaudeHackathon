/** Reporting periods are calendar months, written "YYYY-MM". Boundaries are [start, end) in UTC. */
export interface Period {
  key: string; // 2026-10
  label: string; // October 2026
  short: string; // Oct 2026
  start: string; // 2026-10-01
  end: string; // 2026-11-01 (exclusive)
  days: number;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function isPeriodKey(k: unknown): k is string {
  return typeof k === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(k);
}

export function period(key: string): Period {
  if (!isPeriodKey(key)) throw new Error(`Invalid period "${key}" — expected YYYY-MM`);
  const [y, m] = key.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    key,
    label: `${MONTHS[m - 1]} ${y}`,
    short: `${MONTHS[m - 1].slice(0, 3)} ${y}`,
    start: iso(start),
    end: iso(end),
    days: Math.round((end.getTime() - start.getTime()) / 86400000),
  };
}

export function previousPeriod(key: string): Period {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return period(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
}

export function periodKeyOf(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
