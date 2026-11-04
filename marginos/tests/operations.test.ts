import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addDays, diffDays, forecast, type Batch } from "@/lib/finance/stock";
import { checkStatus, compareLines, findOrder, sameSupplier, type Order } from "@/lib/finance/reconcile";

// Unit tests below are ported from LarderCheck's test/logic.test.js.
const batch = (o: Partial<Batch>): Batch => ({ id: "a", ingredient: "Basil", quantity: 8, unitPrice: 1, arrivalDate: "2026-11-04", expiryDate: "2026-11-08", ...o });

describe("dates", () => {
  it("adds and diffs days in UTC", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30"); // across a UK clock change
    expect(diffDays("2026-11-07", "2026-11-04")).toBe(3);
  });
});

describe("stock forecast", () => {
  it("partial use before expiry gives waste", () => {
    const f = forecast([batch({})], () => 1, "2026-11-04").get("a")!;
    expect(f.consumed).toBe(5);
    expect(f.pctUsedBeforeExpiry).toBe(63);
    expect(f.wasteQty).toBe(3);
    expect(f.wasteValue).toBe(3);
    expect(f.leftNow).toBe(8);
  });
  it("past consumption reduces what's left now", () => {
    expect(forecast([batch({ arrivalDate: "2026-11-02" })], () => 1, "2026-11-04").get("a")!.leftNow).toBe(6);
  });
  it("uses the soonest expiry first; a fresh delivery can push an older batch to waste", () => {
    const f = forecast([batch({ id: "old", quantity: 6, arrivalDate: "2026-11-01", expiryDate: "2026-11-08" }), batch({ id: "new", quantity: 4, arrivalDate: "2026-11-03", expiryDate: "2026-11-06" })], () => 1, "2026-11-04");
    expect(f.get("new")!.wasteQty).toBe(0);
    expect(f.get("old")!.wasteQty).toBeGreaterThan(0);
  });
  it("a batch not yet arrived is not in stock", () => {
    expect(forecast([batch({ arrivalDate: "2026-11-06", expiryDate: "2026-11-10" })], () => 1, "2026-11-04").get("a")!.leftNow).toBe(0);
  });
});

describe("invoice ↔ order checks", () => {
  const order: Order = { id: "o1", orderRef: "PO-1", supplier: "Tyne Valley Meats", deliveryDate: "2026-10-20", status: "delivered", lines: [
    { key: "beef", description: "Beef mince", quantity: 10, unit: "kg", unitPrice: 8.75 },
    { key: "chk", description: "Chicken breast", quantity: 20, unit: "kg", unitPrice: 6.1 },
    { key: "lamb", description: "Lamb mince", quantity: 5, unit: "kg", unitPrice: 10.4 },
  ] };
  it("matches by reference, then by supplier and date", () => {
    expect(findOrder({ orderRef: "po-1", supplier: "x", date: null }, [order])?.method).toBe("order reference");
    expect(findOrder({ orderRef: null, supplier: "Tyne Valley Meats Ltd", date: "2026-10-21" }, [order])?.method).toBe("supplier and date");
    expect(findOrder({ orderRef: null, supplier: "Tyne Valley Meats", date: "2026-10-25" }, [order])).toBeNull();
    expect(sameSupplier("North Shields Fish Co", "Tyne Valley Meats")).toBe(false);
  });
  it("prices overcharges and over-billing, flags shorts, extras and missing lines", () => {
    const r = compareLines([
      { key: "beef", description: "Beef mince", quantity: 10, unit: "kg", unitPrice: 9.4, lineTotal: 94 },
      { key: "chk", description: "Chicken breast", quantity: 25, unit: "kg", unitPrice: 6.1, lineTotal: 152.5 },
      { key: null, description: "Kraft boxes", quantity: 1, unit: "each", unitPrice: 38, lineTotal: 38 },
    ], order);
    const codes = r.lines.map((l) => l.issues.map((i) => i.code));
    expect(codes).toEqual([["price_mismatch"], ["billed_over_order"], ["not_on_order"]]);
    expect(r.lines[0].issues[0].atStake).toBeCloseTo(6.5);
    expect(r.lines[1].issues[0].atStake).toBeCloseTo(30.5);
    expect(r.missingFromInvoice.map((m) => m.description)).toEqual(["Lamb mince"]);
    expect(r.atStake).toBeCloseTo(6.5 + 30.5 + 38);
    expect(checkStatus(order, r.lines, r.missingFromInvoice)).toBe("discrepancies");
    const short = compareLines([{ key: "beef", description: "Beef mince", quantity: 8, unit: "kg", unitPrice: 8.75, lineTotal: 70 }], { ...order, lines: [order.lines[0]] });
    expect(short.lines[0].issues[0].code).toBe("short_delivery");
    expect(short.atStake).toBe(0);
  });
});

describe("operations on the demo data", () => {
  process.env.MARGINOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "marginos-ops-"));
  let ops: typeof import("@/lib/finance/operations");
  let b: Awaited<ReturnType<typeof import("@/lib/business").getActiveBusiness>>;
  beforeAll(async () => {
    await (await import("@/lib/demo/seed")).loadDemo();
    b = await (await import("@/lib/business")).getActiveBusiness();
    ops = await import("@/lib/finance/operations");
  });

  it("finds the planted billing discrepancies in October", async () => {
    const r = await ops.invoiceChecks(b!, "2026-10-01", "2026-11-01");
    if (process.env.MARGINOS_PRINT) fs.writeFileSync(process.env.MARGINOS_PRINT, JSON.stringify(r.summary, null, 1));
    expect(r.summary.byCode.price_mismatch?.count).toBe(1);
    expect(r.summary.byCode.billed_over_order?.count).toBe(1);
    expect(r.summary.byCode.short_delivery?.count).toBe(1);
    expect(r.summary.noOrder).toBe(1);
    expect(r.summary.atStake).toBeGreaterThan(30);
  });

  it("forecasts stock and flags chicken deliveries that outlast their shelf life", async () => {
    const s = (await ops.stockForecast(b!))!;
    if (process.env.MARGINOS_PRINT2) fs.writeFileSync(process.env.MARGINOS_PRINT2, JSON.stringify({ asOf: s.asOf, totals: s.totals, top: s.rows.slice(0, 8).map((r) => [r.ingredient, r.dailyUse.toFixed(2), r.typicalDeliveryDays?.toFixed(1), r.shelfLifeDays, r.atRiskValue.toFixed(0), r.expiredLast30Value.toFixed(0)]), over: s.overOrdered.map((r) => r.ingredient) }, null, 1));
    expect(s.asOf).toBe("2026-10-30");
    expect(s.totals.stockValue).toBeGreaterThan(0);
    expect(s.overOrdered.some((r) => r.ingredient.startsWith("Chicken breast"))).toBe(true);
  });
});
