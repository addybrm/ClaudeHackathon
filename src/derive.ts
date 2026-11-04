import type { Core, Rec } from './api';

export const COLORS = { brand: '#1b4d3a', sage: '#5c9a78', amber: '#b7852d', red: '#a3362b', grid: '#ece8df', tick: '#7b8178', ink: '#18221c' };

/** Rule-based recommendations computed only from figures already in `core`. Used when the report API is unavailable. */
export function deriveRecs(c: Core): Rec[] {
  const out: Rec[] = [];
  const cur = c.restaurant.currency === 'GBP' ? '£' : '';
  [...c.priceChanges].sort((a, b) => b.weeklyImpact - a.weeklyImpact).slice(0, 2).forEach(p => {
    out.push({ area: 'Suppliers', action: `Ask ${p.supplier} to review ${p.name.toLowerCase()} (up ${p.changePct.toFixed(1)}%), or get a second quote.`, estimated_impact: p.weeklyImpact, basis: 'weekly cost impact of the increase' });
  });
  c.dishes.filter(d => d.status !== 'healthy').sort((a, b) => b.foodCostPct - a.foodCostPct).slice(0, 2).forEach(d => {
    out.push({
      area: 'Menu', action: `Reprice or re-portion ${d.name}: food cost is ${d.foodCostPct.toFixed(1)}% against a ${c.kpis.target_food_cost_pct}% target. ${cur}${d.suggestedPrice.toFixed(2)} would restore it.`,
      estimated_impact: Math.max(0, (d.suggestedPrice - d.price) * d.units), basis: 'price gap × units sold, assuming unchanged demand',
    });
  });
  return out;
}
