/**
 * MarginOS financial formulas — pure, deterministic, unit-tested (tests/formulas.test.ts).
 *
 * Every number shown in the product or returned to Claude is produced here or in
 * engine.ts. Claude never performs financial arithmetic itself.
 *
 * DEFINITIONS (GBP, all reported figures ex VAT)
 *   Gross sales (ex VAT)        G = Σ line price × qty ÷ (1 + VAT)            before discounts/refunds
 *   Discounts (ex VAT)          D = restaurant-funded discounts ÷ (1 + VAT)   platform-funded promos are excluded
 *   Refunds (ex VAT)            R = refunds ÷ (1 + VAT)
 *   Net revenue                 N = G − D − R
 *   Food cost (theoretical)     F = Σ units sold × recipe cost per unit
 *   Recipe cost per unit          = Σ ingredient qty (converted to base unit) × unit cost ÷ portions
 *   Packaging                   P = Σ collection + delivery units × packaging cost per unit
 *   Platform commission         C = settlement commission (ex VAT), or contractual rate × (gross − discount) when no settlement exists (ESTIMATED)
 *   Gross margin (food)           = N − F
 *   Contribution                  = N − F − P − C        (directly attributable variable costs only)
 *   Contribution margin %         = Contribution ÷ N × 100
 *   Recorded waste cost         W = Σ waste qty (base unit) × unit cost  (menu items: portions × recipe cost)
 *   Wage cost                   L = Σ hours × hourly rate  (excludes employer NI and pension)
 *   Contribution after waste & labour = Contribution − W − L
 * Contribution is NOT net profit: rent, utilities, marketing and other overheads are not included.
 */

export type BaseUnit = "kg" | "l" | "each";
export type QtyUnit = "g" | "kg" | "ml" | "l" | "each";

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/** Convert a quantity to an ingredient's base unit. Returns null when the units are incompatible (e.g. g → l). */
export function toBaseQuantity(qty: number, unit: string, baseUnit: BaseUnit): number | null {
  const u = unit.toLowerCase().trim();
  if (baseUnit === "kg") {
    if (u === "kg") return qty;
    if (u === "g") return qty / 1000;
    return null;
  }
  if (baseUnit === "l") {
    if (u === "l") return qty;
    if (u === "ml") return qty / 1000;
    return null;
  }
  if (u === "each" || u === "ea" || u === "unit" || u === "pcs") return qty;
  return null;
}

/** Remove VAT from a VAT-inclusive amount. */
export function exVat(amount: number, vatRatePct: number, pricesIncludeVat = true): number {
  if (!pricesIncludeVat || vatRatePct <= 0) return amount;
  return amount / (1 + vatRatePct / 100);
}

export function marginPct(value: number, revenue: number): number | null {
  if (!revenue) return null;
  return (value / revenue) * 100;
}

export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// ---------------------------------------------------------------------------
// Ingredient costing
// ---------------------------------------------------------------------------

export type CostSource = "invoice_period" | "invoice_prior" | "standard_estimate" | "missing";

export interface PricePoint {
  quantity: number; // base units
  unitPrice: number; // per base unit, ex VAT
}

/** Quantity-weighted average purchase price. */
export function weightedAveragePrice(points: PricePoint[]): number | null {
  const qty = points.reduce((s, p) => s + p.quantity, 0);
  if (qty <= 0) return null;
  return points.reduce((s, p) => s + p.quantity * p.unitPrice, 0) / qty;
}

/**
 * Unit cost for a period, in order of preference:
 *  1. weighted average of invoice prices dated inside the period
 *  2. the most recent invoice price before the period
 *  3. the ingredient's standard cost (flagged as an estimate)
 *  4. missing
 */
export function resolveUnitCost(
  periodPoints: PricePoint[],
  latestPriorPrice: number | null,
  standardCost: number | null,
): { unitCost: number | null; source: CostSource } {
  const wap = weightedAveragePrice(periodPoints);
  if (wap !== null) return { unitCost: wap, source: "invoice_period" };
  if (latestPriorPrice !== null) return { unitCost: latestPriorPrice, source: "invoice_prior" };
  if (standardCost !== null) return { unitCost: standardCost, source: "standard_estimate" };
  return { unitCost: null, source: "missing" };
}

export interface RecipeLineInput {
  ingredientName: string;
  quantity: number;
  unit: string;
  baseUnit: BaseUnit;
  unitCost: number | null;
  costSource: CostSource;
}

export interface RecipeCostResult {
  cost: number; // sum of costable lines
  complete: boolean; // false if any line is missing a cost or has incompatible units
  estimated: boolean; // true if any line uses a standard (non-invoice) cost
  missing: string[];
  lines: { ingredientName: string; baseQty: number | null; unitCost: number | null; cost: number | null; costSource: CostSource }[];
}

export function recipeCost(lines: RecipeLineInput[], portions = 1): RecipeCostResult {
  const out: RecipeCostResult = { cost: 0, complete: lines.length > 0, estimated: false, missing: [], lines: [] };
  for (const l of lines) {
    const baseQty = toBaseQuantity(l.quantity, l.unit, l.baseUnit);
    if (baseQty === null || l.unitCost === null) {
      out.complete = false;
      out.missing.push(l.ingredientName);
      out.lines.push({ ingredientName: l.ingredientName, baseQty, unitCost: l.unitCost, cost: null, costSource: baseQty === null ? "missing" : l.costSource });
      continue;
    }
    const c = (baseQty * l.unitCost) / portions;
    if (l.costSource === "standard_estimate") out.estimated = true;
    out.cost += c;
    out.lines.push({ ingredientName: l.ingredientName, baseQty: baseQty / portions, unitCost: l.unitCost, cost: c, costSource: l.costSource });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contribution
// ---------------------------------------------------------------------------

export interface SalesFactInput {
  units: number;
  grossInclVat: number; // before discounts
  discountInclVat: number; // restaurant-funded
  refundInclVat: number;
  commissionExVat: number;
  foodCostPerUnit: number | null;
  packagingPerUnit: number; // 0 for dine-in
  vatRatePct: number;
  pricesIncludeVat?: boolean;
}

export interface ContributionResult {
  grossSales: number;
  discounts: number;
  refunds: number;
  netRevenue: number;
  foodCost: number | null;
  packaging: number;
  commission: number;
  contribution: number | null;
  contributionPerUnit: number | null;
  marginPct: number | null;
}

export function contribution(f: SalesFactInput): ContributionResult {
  const inc = f.pricesIncludeVat ?? true;
  const grossSales = exVat(f.grossInclVat, f.vatRatePct, inc);
  const discounts = exVat(f.discountInclVat, f.vatRatePct, inc);
  const refunds = exVat(f.refundInclVat, f.vatRatePct, inc);
  const netRevenue = grossSales - discounts - refunds;
  const foodCost = f.foodCostPerUnit === null ? null : f.foodCostPerUnit * f.units;
  const packaging = f.packagingPerUnit * f.units;
  const commission = f.commissionExVat;
  const contrib = foodCost === null ? null : netRevenue - foodCost - packaging - commission;
  return {
    grossSales,
    discounts,
    refunds,
    netRevenue,
    foodCost,
    packaging,
    commission,
    contribution: contrib,
    contributionPerUnit: contrib === null || !f.units ? null : contrib / f.units,
    marginPct: contrib === null ? null : marginPct(contrib, netRevenue),
  };
}

/** Commission when no settlement record exists: contractual rate × VAT-inclusive order value after restaurant-funded discounts. */
export function estimatedCommission(orderGrossInclVat: number, discountInclVat: number, rate: number): number {
  return (orderGrossInclVat - discountInclVat) * rate;
}

/** Cost of a waste record. Ingredient waste uses the ingredient unit cost; prepared-dish waste uses portions × recipe cost. */
export function wasteCost(
  w: { quantity: number; unit: string },
  target: { kind: "ingredient"; baseUnit: BaseUnit; unitCost: number | null } | { kind: "menu_item"; recipeCost: number | null },
): number | null {
  if (target.kind === "menu_item") {
    if (target.recipeCost === null) return null;
    if (w.unit !== "portion" && w.unit !== "each") return null;
    return w.quantity * target.recipeCost;
  }
  const base = toBaseQuantity(w.quantity, w.unit, target.baseUnit);
  if (base === null || target.unitCost === null) return null;
  return base * target.unitCost;
}

// ---------------------------------------------------------------------------
// Period change decomposition (the core of the Profit Leak Investigation)
// ---------------------------------------------------------------------------

export interface PeriodTotals {
  grossSales: number; // G, ex VAT
  discounts: number;
  refunds: number;
  foodCost: number;
  packaging: number;
  commission: number;
  deliveryGrossSales: number; // G restricted to delivery channels
  waste: number;
  labour: number;
}

export const contributionOf = (t: PeriodTotals) =>
  t.grossSales - t.discounts - t.refunds - t.foodCost - t.packaging - t.commission;

export interface DecompositionEffect {
  key: string;
  label: string;
  previousRatioPct: number | null; // cost as % of gross sales
  currentRatioPct: number | null;
  impact: number; // £ effect on contribution (negative = reduces contribution)
  basis: string;
}

export interface Decomposition {
  contributionPrevious: number;
  contributionCurrent: number;
  change: number;
  effects: DecompositionEffect[];
  /** Sum of effects minus change; ~0 by construction. Exposed so callers can prove additivity. */
  residual: number;
}

/**
 * Decompose the change in contribution into NON-OVERLAPPING, ADDITIVE effects.
 *
 * Writing contribution as C = m × G, where m = 1 − d − r − f − p − c (each cost as a
 * share of gross sales G):
 *   ΔC = m_prev × (G_cur − G_prev)                (sales volume effect, at last period's margin)
 *      − Σ_k (k_cur − k_prev) × G_cur            (rate effect of each cost line)
 * This identity is exact, so effects can be added without double counting.
 *
 * The food-cost rate effect is split further into:
 *   ingredient price effect = −Σ_i usage_cur_i × (price_cur_i − price_prev_i)   (measured from invoices)
 *   menu mix & pricing      = food rate effect − ingredient price effect          (remainder, includes price changes and dish mix)
 * The commission rate effect is split into:
 *   delivery mix shift      = −(s_cur − s_prev) × c_d_prev × G_cur   (s = delivery share of G, c_d = commission ÷ delivery G)
 *   commission rate change  = −s_cur × (c_d_cur − c_d_prev) × G_cur
 */
export function decomposeContributionChange(
  prev: PeriodTotals,
  cur: PeriodTotals,
  ingredientPriceEffect: number,
): Decomposition {
  const Cp = contributionOf(prev);
  const Cc = contributionOf(cur);
  const Gp = prev.grossSales;
  const Gc = cur.grossSales;
  const ratio = (v: number, g: number) => (g ? v / g : 0);
  const pct = (v: number, g: number) => (g ? (v / g) * 100 : null);
  const mPrev = ratio(Cp, Gp);

  const rateEffect = (k: keyof PeriodTotals) => -(ratio(cur[k], Gc) - ratio(prev[k], Gp)) * Gc;

  const foodRate = rateEffect("foodCost");
  const sp = ratio(prev.deliveryGrossSales, Gp);
  const sc = ratio(cur.deliveryGrossSales, Gc);
  const cdp = ratio(prev.commission, prev.deliveryGrossSales);
  const cdc = ratio(cur.commission, cur.deliveryGrossSales);
  const mixShift = -(sc - sp) * cdp * Gc;
  const commissionRate = -sc * (cdc - cdp) * Gc;

  const effects: DecompositionEffect[] = [
    { key: "volume", label: "Sales volume", previousRatioPct: null, currentRatioPct: null, impact: mPrev * (Gc - Gp), basis: "Change in gross sales × previous contribution margin" },
    { key: "ingredient_prices", label: "Ingredient price changes", previousRatioPct: null, currentRatioPct: null, impact: ingredientPriceEffect, basis: "Current-period ingredient usage × change in invoice unit price" },
    { key: "menu_mix", label: "Menu mix & pricing", previousRatioPct: null, currentRatioPct: null, impact: foodRate - ingredientPriceEffect, basis: `Remaining change in food cost as a share of gross sales (${pct(prev.foodCost, Gp)?.toFixed(1) ?? "n/a"}% → ${pct(cur.foodCost, Gc)?.toFixed(1) ?? "n/a"}%): dish mix and menu prices` },
    { key: "discounts", label: "Restaurant-funded discounts", previousRatioPct: pct(prev.discounts, Gp), currentRatioPct: pct(cur.discounts, Gc), impact: rateEffect("discounts"), basis: "Change in discounts as a share of gross sales" },
    { key: "refunds", label: "Refunds", previousRatioPct: pct(prev.refunds, Gp), currentRatioPct: pct(cur.refunds, Gc), impact: rateEffect("refunds"), basis: "Change in refunds as a share of gross sales" },
    { key: "delivery_mix", label: "Shift towards delivery", previousRatioPct: pct(prev.deliveryGrossSales, Gp), currentRatioPct: pct(cur.deliveryGrossSales, Gc), impact: mixShift, basis: "Change in delivery share × previous commission rate" },
    { key: "commission_rate", label: "Effective commission rate", previousRatioPct: cdp ? cdp * 100 : null, currentRatioPct: cdc ? cdc * 100 : null, impact: commissionRate, basis: "Change in commission per £ of delivery sales" },
    { key: "packaging", label: "Packaging", previousRatioPct: pct(prev.packaging, Gp), currentRatioPct: pct(cur.packaging, Gc), impact: rateEffect("packaging"), basis: "Change in packaging as a share of gross sales" },
  ];
  const sum = effects.reduce((s, e) => s + e.impact, 0);
  return { contributionPrevious: Cp, contributionCurrent: Cc, change: Cc - Cp, effects, residual: sum - (Cc - Cp) };
}

/** Ingredient price effect at current usage: −Σ usage × (price_cur − price_prev). Ingredients without both prices are excluded. */
export function ingredientPriceEffect(rows: { usageCurrent: number; pricePrevious: number | null; priceCurrent: number | null }[]): number {
  return -rows.reduce((s, r) => (r.pricePrevious === null || r.priceCurrent === null ? s : s + r.usageCurrent * (r.priceCurrent - r.pricePrevious)), 0);
}

// ---------------------------------------------------------------------------
// Price scenario
// ---------------------------------------------------------------------------

export interface PriceScenarioInput {
  currentPriceGross: number;
  newPriceGross: number;
  unitsPerPeriod: number;
  foodCostPerUnit: number;
  packagingPerUnit: number;
  commissionRate: number; // share of gross charged by platform (0 for in-house)
  discountRate: number; // restaurant-funded discount as share of gross
  vatRatePct: number;
  demandChangePct: number; // assumed change in units, e.g. -5
}

export function contributionPerUnitAtPrice(priceGross: number, i: Omit<PriceScenarioInput, "currentPriceGross" | "newPriceGross" | "unitsPerPeriod" | "demandChangePct">) {
  const net = exVat(priceGross * (1 - i.discountRate), i.vatRatePct);
  return net - i.foodCostPerUnit - i.packagingPerUnit - priceGross * i.commissionRate;
}

export function priceScenario(i: PriceScenarioInput) {
  const before = contributionPerUnitAtPrice(i.currentPriceGross, i);
  const after = contributionPerUnitAtPrice(i.newPriceGross, i);
  const unitsAfter = i.unitsPerPeriod * (1 + i.demandChangePct / 100);
  const totalBefore = before * i.unitsPerPeriod;
  const totalAfter = after * unitsAfter;
  // Units at the new price needed to keep total contribution unchanged.
  const breakEvenUnits = after > 0 ? totalBefore / after : null;
  return {
    contributionPerUnitBefore: before,
    contributionPerUnitAfter: after,
    unitsBefore: i.unitsPerPeriod,
    unitsAfter,
    totalContributionBefore: totalBefore,
    totalContributionAfter: totalAfter,
    change: totalAfter - totalBefore,
    breakEvenUnits,
    breakEvenDemandChangePct: breakEvenUnits === null || !i.unitsPerPeriod ? null : (breakEvenUnits / i.unitsPerPeriod - 1) * 100,
  };
}

// ---------------------------------------------------------------------------
// Menu engineering quadrants
// ---------------------------------------------------------------------------

export type Quadrant = "high_volume_high_contribution" | "high_volume_low_contribution" | "low_volume_high_contribution" | "low_volume_low_contribution";

/**
 * Classic menu-engineering split: volume threshold = 70% of an equal share of units
 * (Kasavana & Smith); contribution threshold = unit-weighted average contribution per unit.
 */
export function classifyMenuItems<T extends { units: number; contributionPerUnit: number | null }>(items: T[]) {
  const costed = items.filter((i) => i.contributionPerUnit !== null && i.units > 0);
  const totalUnits = costed.reduce((s, i) => s + i.units, 0);
  const volumeThreshold = costed.length ? (totalUnits / costed.length) * 0.7 : 0;
  const contributionThreshold = totalUnits ? costed.reduce((s, i) => s + i.units * (i.contributionPerUnit as number), 0) / totalUnits : 0;
  return {
    volumeThreshold,
    contributionThreshold,
    items: items.map((i) => {
      if (i.contributionPerUnit === null || i.units <= 0) return { ...i, quadrant: null as Quadrant | null };
      const hv = i.units >= volumeThreshold;
      const hc = i.contributionPerUnit >= contributionThreshold;
      const quadrant: Quadrant = hv ? (hc ? "high_volume_high_contribution" : "high_volume_low_contribution") : hc ? "low_volume_high_contribution" : "low_volume_low_contribution";
      return { ...i, quadrant };
    }),
  };
}
