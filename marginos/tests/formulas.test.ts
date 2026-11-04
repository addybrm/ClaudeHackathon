import { describe, expect, it } from "vitest";
import {
  classifyMenuItems,
  contribution,
  contributionOf,
  decomposeContributionChange,
  estimatedCommission,
  exVat,
  ingredientPriceEffect,
  marginPct,
  pctChange,
  priceScenario,
  recipeCost,
  resolveUnitCost,
  toBaseQuantity,
  wasteCost,
  weightedAveragePrice,
  type PeriodTotals,
} from "@/lib/finance/formulas";

describe("units & VAT", () => {
  it("converts to base units and rejects incompatible units", () => {
    expect(toBaseQuantity(250, "g", "kg")).toBe(0.25);
    expect(toBaseQuantity(1.5, "kg", "kg")).toBe(1.5);
    expect(toBaseQuantity(330, "ml", "l")).toBeCloseTo(0.33);
    expect(toBaseQuantity(3, "each", "each")).toBe(3);
    expect(toBaseQuantity(100, "g", "l")).toBeNull();
    expect(toBaseQuantity(1, "kg", "each")).toBeNull();
  });
  it("removes VAT only when prices include it", () => {
    expect(exVat(12, 20)).toBeCloseTo(10);
    expect(exVat(12, 20, false)).toBe(12);
    expect(exVat(12, 0)).toBe(12);
  });
  it("handles zero denominators", () => {
    expect(marginPct(10, 0)).toBeNull();
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(110, 100)).toBeCloseTo(10);
    expect(pctChange(-50, -100)).toBeCloseTo(50);
  });
});

describe("ingredient costing", () => {
  it("weights average price by quantity", () => {
    expect(weightedAveragePrice([{ quantity: 10, unitPrice: 5 }, { quantity: 30, unitPrice: 6 }])).toBeCloseTo(5.75);
    expect(weightedAveragePrice([])).toBeNull();
  });
  it("prefers period invoices, then prior invoice, then standard (estimated)", () => {
    expect(resolveUnitCost([{ quantity: 5, unitPrice: 6.1 }], 5.2, 4)).toEqual({ unitCost: 6.1, source: "invoice_period" });
    expect(resolveUnitCost([], 5.2, 4)).toEqual({ unitCost: 5.2, source: "invoice_prior" });
    expect(resolveUnitCost([], null, 4)).toEqual({ unitCost: 4, source: "standard_estimate" });
    expect(resolveUnitCost([], null, null)).toEqual({ unitCost: null, source: "missing" });
  });
  it("costs a recipe and flags missing / estimated lines", () => {
    const r = recipeCost([
      { ingredientName: "Chicken", quantity: 200, unit: "g", baseUnit: "kg", unitCost: 6.1, costSource: "invoice_period" },
      { ingredientName: "Oil", quantity: 140, unit: "ml", baseUnit: "l", unitCost: 1.74, costSource: "invoice_period" },
      { ingredientName: "Bun", quantity: 1, unit: "each", baseUnit: "each", unitCost: 0.34, costSource: "invoice_period" },
    ]);
    expect(r.cost).toBeCloseTo(1.22 + 0.2436 + 0.34, 4);
    expect(r.complete).toBe(true);
    const partial = recipeCost([
      { ingredientName: "Truffle oil", quantity: 5, unit: "ml", baseUnit: "l", unitCost: 38, costSource: "standard_estimate" },
      { ingredientName: "Saffron", quantity: 1, unit: "g", baseUnit: "kg", unitCost: null, costSource: "missing" },
    ]);
    expect(partial.complete).toBe(false);
    expect(partial.estimated).toBe(true);
    expect(partial.missing).toEqual(["Saffron"]);
    expect(recipeCost([]).complete).toBe(false);
  });
  it("divides batch recipes by portions", () => {
    const r = recipeCost([{ ingredientName: "Rice", quantity: 1, unit: "kg", baseUnit: "kg", unitCost: 2.4, costSource: "invoice_period" }], 8);
    expect(r.cost).toBeCloseTo(0.3);
  });
});

describe("contribution", () => {
  it("computes delivery contribution net of VAT, discount, refund, commission and packaging", () => {
    // 10 burgers at £16.50 on a platform, 20% restaurant-funded discount, one refunded, 30% commission.
    const gross = 165;
    const discount = 33;
    const refund = 13.2; // one burger after discount
    const commission = estimatedCommission(gross, discount, 0.3); // 39.6
    const c = contribution({ units: 10, grossInclVat: gross, discountInclVat: discount, refundInclVat: refund, commissionExVat: commission, foodCostPerUnit: 2.5, packagingPerUnit: 0.62, vatRatePct: 20 });
    expect(c.grossSales).toBeCloseTo(137.5);
    expect(c.discounts).toBeCloseTo(27.5);
    expect(c.refunds).toBeCloseTo(11);
    expect(c.netRevenue).toBeCloseTo(99);
    expect(c.contribution).toBeCloseTo(99 - 25 - 6.2 - 39.6);
    expect(c.marginPct).toBeCloseTo(((99 - 25 - 6.2 - 39.6) / 99) * 100);
  });
  it("returns null contribution when food cost is unknown (never assumes zero)", () => {
    const c = contribution({ units: 2, grossInclVat: 36, discountInclVat: 0, refundInclVat: 0, commissionExVat: 0, foodCostPerUnit: null, packagingPerUnit: 0, vatRatePct: 20 });
    expect(c.netRevenue).toBeCloseTo(30);
    expect(c.contribution).toBeNull();
    expect(c.marginPct).toBeNull();
  });
});

describe("waste", () => {
  it("costs ingredient and prepared-dish waste", () => {
    expect(wasteCost({ quantity: 1500, unit: "g" }, { kind: "ingredient", baseUnit: "kg", unitCost: 6.1 })).toBeCloseTo(9.15);
    expect(wasteCost({ quantity: 3, unit: "portion" }, { kind: "menu_item", recipeCost: 2.2 })).toBeCloseTo(6.6);
    expect(wasteCost({ quantity: 1, unit: "l" }, { kind: "ingredient", baseUnit: "kg", unitCost: 1 })).toBeNull();
    expect(wasteCost({ quantity: 1, unit: "portion" }, { kind: "menu_item", recipeCost: null })).toBeNull();
  });
});

describe("contribution change decomposition", () => {
  const prev: PeriodTotals = { grossSales: 80000, discounts: 600, refunds: 150, foodCost: 20000, packaging: 900, commission: 4200, deliveryGrossSales: 15000, waste: 500, labour: 25000 };
  const cur: PeriodTotals = { grossSales: 87000, discounts: 2900, refunds: 400, foodCost: 23400, packaging: 1300, commission: 7000, deliveryGrossSales: 25000, waste: 850, labour: 26500 };

  it("effects sum exactly to the change in contribution (no double counting)", () => {
    const d = decomposeContributionChange(prev, cur, -1800);
    expect(d.change).toBeCloseTo(contributionOf(cur) - contributionOf(prev), 6);
    expect(d.residual).toBeCloseTo(0, 6);
    const total = d.effects.reduce((s, e) => s + e.impact, 0);
    expect(total).toBeCloseTo(d.change, 6);
  });
  it("attributes the measured ingredient price effect and leaves the rest to menu mix", () => {
    const d = decomposeContributionChange(prev, cur, -1800);
    const ip = d.effects.find((e) => e.key === "ingredient_prices")!;
    const mix = d.effects.find((e) => e.key === "menu_mix")!;
    const foodRate = -(cur.foodCost / cur.grossSales - prev.foodCost / prev.grossSales) * cur.grossSales;
    expect(ip.impact).toBe(-1800);
    expect(ip.impact + mix.impact).toBeCloseTo(foodRate, 6);
  });
  it("splits commission into delivery mix and rate effects", () => {
    const d = decomposeContributionChange(prev, cur, 0);
    const mixShift = d.effects.find((e) => e.key === "delivery_mix")!.impact;
    const rate = d.effects.find((e) => e.key === "commission_rate")!.impact;
    const commissionRate = -(cur.commission / cur.grossSales - prev.commission / prev.grossSales) * cur.grossSales;
    expect(mixShift + rate).toBeCloseTo(commissionRate, 6);
    expect(mixShift).toBeLessThan(0); // more delivery → more commission
  });
  it("is zero when nothing changes", () => {
    const d = decomposeContributionChange(prev, prev, 0);
    for (const e of d.effects) expect(Math.abs(e.impact)).toBeLessThan(1e-9);
  });
  it("computes ingredient price effect from usage × price change, skipping unknown prices", () => {
    expect(ingredientPriceEffect([
      { usageCurrent: 500, pricePrevious: 5.2, priceCurrent: 6.1 },
      { usageCurrent: 100, pricePrevious: null, priceCurrent: 3 },
      { usageCurrent: 200, pricePrevious: 9.8, priceCurrent: 9.2 },
    ])).toBeCloseTo(-(500 * 0.9) + 200 * 0.6);
  });
});

describe("price scenario", () => {
  it("calculates contribution per unit, totals and break-even volume", () => {
    const r = priceScenario({ currentPriceGross: 14.5, newPriceGross: 15.5, unitsPerPeriod: 1000, foodCostPerUnit: 3, packagingPerUnit: 0, commissionRate: 0, discountRate: 0, vatRatePct: 20, demandChangePct: 0 });
    expect(r.contributionPerUnitBefore).toBeCloseTo(14.5 / 1.2 - 3);
    expect(r.contributionPerUnitAfter).toBeCloseTo(15.5 / 1.2 - 3);
    expect(r.change).toBeCloseTo((1 / 1.2) * 1000);
    expect(r.breakEvenDemandChangePct!).toBeLessThan(0);
    // Selling the break-even number of units at the new price gives the same total contribution.
    expect(r.breakEvenUnits! * r.contributionPerUnitAfter).toBeCloseTo(r.totalContributionBefore);
  });
  it("includes platform commission and discount for delivery", () => {
    const r = priceScenario({ currentPriceGross: 16.5, newPriceGross: 16.5, unitsPerPeriod: 10, foodCostPerUnit: 2.5, packagingPerUnit: 0.62, commissionRate: 0.24, discountRate: 0.2, vatRatePct: 20, demandChangePct: -10 });
    expect(r.contributionPerUnitBefore).toBeCloseTo((16.5 * 0.8) / 1.2 - 2.5 - 0.62 - 16.5 * 0.24);
    expect(r.unitsAfter).toBeCloseTo(9);
  });
});

describe("menu engineering", () => {
  it("classifies items into four quadrants and ignores uncosted items", () => {
    const res = classifyMenuItems([
      { id: "a", units: 500, contributionPerUnit: 9 },
      { id: "b", units: 480, contributionPerUnit: 4 },
      { id: "c", units: 60, contributionPerUnit: 12 },
      { id: "d", units: 50, contributionPerUnit: 3 },
      { id: "e", units: 90, contributionPerUnit: null },
    ]);
    const q = Object.fromEntries(res.items.map((i) => [i.id, i.quadrant]));
    expect(q).toEqual({ a: "high_volume_high_contribution", b: "high_volume_low_contribution", c: "low_volume_high_contribution", d: "low_volume_low_contribution", e: null });
  });
});
