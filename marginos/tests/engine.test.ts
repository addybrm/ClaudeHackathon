import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolated database for the test run.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marginos-test-"));
process.env.MARGINOS_DATA_DIR = dir;

const { loadDemo } = await import("@/lib/demo/seed");
const { getActiveBusiness } = await import("@/lib/business");
const engine = await import("@/lib/finance/engine");
const { period } = await import("@/lib/finance/period");

let b: NonNullable<Awaited<ReturnType<typeof getActiveBusiness>>>;

beforeAll(async () => {
  await loadDemo();
  b = (await getActiveBusiness())!;
});

describe("demo dataset + engine", () => {
  it("loads the demo business flagged as demo data", () => {
    expect(b.name).toBe("The Copper Table");
    expect(b.isDemo).toBe(true);
  });

  it("produces the intended storyline: revenue up, contribution down", async () => {
    const inv = await engine.investigateProfitChange(b, "2026-10", "2026-09");
    const h = inv.headline;
    if (process.env.MARGINOS_PRINT) fs.writeFileSync(process.env.MARGINOS_PRINT, JSON.stringify({ h, effects: inv.contributionBridge.effects.map((e) => [e.key, Math.round(e.impact)]), below: inv.belowContribution, top: inv.topIngredientIncreases.map((t) => [t.ingredient, t.changePct, Math.round(t.impact)]) }, null, 1));
    expect(h.netRevenue.changePct!).toBeGreaterThan(0);
    expect(h.contribution.changePct!).toBeLessThan(0);
    // Bridge is additive
    const sum = inv.contributionBridge.effects.reduce((s, e) => s + e.impact, 0);
    expect(sum).toBeCloseTo(inv.contributionBridge.totalChange, 4);
    // Chicken breast is the largest identified price increase
    expect(inv.topIngredientIncreases[0].ingredient).toMatch(/Chicken breast/);
    expect(inv.topIngredientIncreases[0].previousUnitCost).toBeCloseTo(5.2);
    expect(inv.topIngredientIncreases[0].currentUnitCost).toBeCloseTo(6.1);
  });

  it("menu profitability flags the uncosted special and computes quadrants", async () => {
    const m = await engine.menuProfitability(b, period("2026-10"));
    const special = m.items.find((i) => i.name.includes("Seasonal"))!;
    expect(special.recipeComplete).toBe(false);
    expect(special.total.contribution).toBeNull();
    const burger = m.items.find((i) => i.name.includes("Chicken Burger"))!;
    expect(burger.total.units).toBeGreaterThan(0);
    expect(burger.byChannel.delivery.marginPct!).toBeLessThan(burger.byChannel.dine_in.marginPct!);
    expect(m.items.filter((i) => i.quadrant).length).toBeGreaterThan(10);
  });

  it("period summary totals agree with channel totals", async () => {
    const p = period("2026-10");
    const s = await engine.periodSummary(b, p);
    const ch = await engine.channelAnalysis(b, p);
    expect(ch.reduce((x, c) => x + c.contribution, 0)).toBeCloseTo(s.contribution, 4);
    expect(ch.reduce((x, c) => x + c.netRevenue + c.uncostedRevenue, 0)).toBeCloseTo(s.netRevenue, 4);
    expect(s.commissionEstimatedShare).toBeGreaterThan(0); // QuickPlate 26–30 Oct not yet settled
  });

  it("price scenario uses the real recipe cost", async () => {
    const m = await engine.menuProfitability(b, period("2026-10"), { withPrevious: false });
    const burger = m.items.find((i) => i.name.includes("Chicken Burger"))!;
    const r = await engine.priceScenarioForItem(b, period("2026-10"), { menuItemId: burger.id, newPriceGross: 15.5, channel: "dine_in", demandChangePct: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.change).toBeGreaterThan(0);
  });
});
