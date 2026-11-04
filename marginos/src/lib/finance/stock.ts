/**
 * Stock & expiry forecast — adapted from the LarderCheck prototype (lib/forecast.js, by addybrm).
 *
 * For each ingredient, simulate day by day: the kitchen uses `dailyUse` base units per day,
 * taken first-expiry-first-out from batches that have arrived and not yet expired. Whatever
 * is left on a batch's expiry day is modelled waste. The simulation starts at the earliest
 * arrival, so "left now" also accounts for use since delivery.
 *
 * MarginOS difference: dailyUse comes from recipes × actual sales (theoretical usage), not a
 * hand-entered average. The forecast is a MODEL, not a stock count.
 */

const DAY_MS = 86_400_000;
const EPS = 1e-9;
const MAX_DAYS = 800;

export const isIsoDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z"));
export const toDayNumber = (iso: string) => Math.round(Date.parse(iso + "T00:00:00Z") / DAY_MS);
export const fromDayNumber = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
export const addDays = (iso: string, days: number) => fromDayNumber(toDayNumber(iso) + days);
export const diffDays = (a: string, b: string) => toDayNumber(a) - toDayNumber(b);

export interface Batch {
  id: string;
  ingredient: string;
  quantity: number; // base units
  arrivalDate: string;
  expiryDate: string;
  unitPrice: number; // per base unit
}

export interface BatchForecast {
  consumed: number;
  pctUsedBeforeExpiry: number;
  wasteQty: number;
  wasteValue: number;
  leftNow: number;
  expired: boolean;
  daysToExpiry: number;
  dailyUse: number;
}

export function forecast(batches: Batch[], dailyUseFor: (ingredient: string) => number, today: string): Map<string, BatchForecast> {
  const todayN = toDayNumber(today);
  const result = new Map<string, BatchForecast>();
  const byIngredient = new Map<string, Batch[]>();
  for (const b of batches) {
    const key = b.ingredient.toLowerCase();
    byIngredient.set(key, [...(byIngredient.get(key) ?? []), b]);
  }
  for (const group of byIngredient.values()) {
    const rate = Math.max(0, Number(dailyUseFor(group[0].ingredient)) || 0);
    const sim = group.map((b) => ({ b, arrive: toDayNumber(b.arrivalDate), expire: toDayNumber(b.expiryDate), left: b.quantity, leftNow: b.quantity }));
    // First expiry first out; ties go to the earlier delivery.
    sim.sort((x, y) => x.expire - y.expire || x.arrive - y.arrive);
    const start = Math.min(...sim.map((s) => s.arrive));
    const end = Math.min(Math.max(...sim.map((s) => s.expire)), start + MAX_DAYS);
    for (let day = start; day <= end; day++) {
      if (day === todayN) for (const s of sim) s.leftNow = s.left;
      let need = rate;
      for (const s of sim) {
        if (need <= EPS) break;
        if (s.arrive > day || s.expire < day || s.left <= EPS) continue;
        const take = Math.min(need, s.left);
        s.left -= take;
        need -= take;
      }
    }
    if (todayN > end) for (const s of sim) s.leftNow = s.left;
    for (const s of sim) {
      const q = s.b.quantity;
      const consumed = q - s.left;
      const wasteQty = s.left > EPS ? s.left : 0;
      result.set(s.b.id, {
        consumed: round(consumed),
        pctUsedBeforeExpiry: q > 0 ? Math.round((consumed / q) * 100) : 0,
        wasteQty: round(wasteQty),
        wasteValue: round(wasteQty * (s.b.unitPrice || 0), 2),
        leftNow: s.arrive > todayN ? 0 : round(s.leftNow),
        expired: s.expire < todayN,
        daysToExpiry: s.expire - todayN,
        dailyUse: rate,
      });
    }
  }
  return result;
}

function round(x: number, dp = 3) {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
