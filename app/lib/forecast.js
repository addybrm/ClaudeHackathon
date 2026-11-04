// Predicts how much of each stock batch gets used before it expires.
//
// For each ingredient we simulate day by day: every day the kitchen uses `dailyUse`
// units, taken first-expiry-first-out from the batches that have arrived and haven't
// expired. A batch's prediction is the share of it used up by the end of its expiry day.
// The simulation starts at the earliest arrival, so "left now" also estimates what has
// already been used since delivery.

import { toDayNumber } from "./dates.js";

const MAX_DAYS = 800;
const EPS = 1e-9;

/**
 * @param {Array<{id:string, ingredient:string, quantity:number, arrivalDate:string, expiryDate:string, unitPrice:number}>} batches
 * @param {(ingredient:string)=>number} dailyUseFor  units used per day
 * @param {string} today  YYYY-MM-DD
 * @returns {Map<string, {consumed:number, pctUsedBeforeExpiry:number, wasteQty:number, wasteValue:number, leftNow:number, expired:boolean, daysToExpiry:number}>}
 */
export function forecast(batches, dailyUseFor, today) {
  const todayN = toDayNumber(today);
  const result = new Map();
  const byIngredient = new Map();
  for (const b of batches) {
    const key = b.ingredient.toLowerCase();
    if (!byIngredient.has(key)) byIngredient.set(key, []);
    byIngredient.get(key).push(b);
  }

  for (const group of byIngredient.values()) {
    const rate = Math.max(0, Number(dailyUseFor(group[0].ingredient)) || 0);
    const sim = group.map((b) => ({
      b,
      arrive: toDayNumber(b.arrivalDate),
      expire: toDayNumber(b.expiryDate),
      left: b.quantity,
      leftNow: b.quantity,
    }));
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
    // If today is after the simulated window, nothing changes after `end`.
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
        // Before arrival a batch isn't in stock yet; after expiry, what's left is waste.
        leftNow: s.arrive > todayN ? 0 : round(s.leftNow),
        expired: s.expire < todayN,
        daysToExpiry: s.expire - todayN,
        dailyUse: rate,
      });
    }
  }
  return result;
}

function round(x, dp = 3) {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
