import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.MARGINOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "marginos-imports-"));

const { loadDemo } = await import("@/lib/demo/seed");
const { getActiveBusiness } = await import("@/lib/business");
const { sampleContent } = await import("@/lib/demo/samples");
const pipeline = await import("@/lib/imports/pipeline");
const { query } = await import("@/lib/db");
const { parseCsv, parseNumber, parseDate } = await import("@/lib/imports/csv");
const engine = await import("@/lib/finance/engine");
const { period } = await import("@/lib/finance/period");

let b: NonNullable<Awaited<ReturnType<typeof getActiveBusiness>>>;
const stagedOf = async (id: string) => (await query<{ status: string; staged: { issues: { severity: string; message: string }[]; summary: Record<string, unknown> } }>(`select status, staged from uploaded_files where id = $1`, [id]))[0];

beforeAll(async () => {
  await loadDemo();
  b = (await getActiveBusiness())!;
});

describe("csv helpers", () => {
  it("parses quoted fields, money and UK dates", () => {
    const { header, rows } = parseCsv('a,b\r\n"x, y","say ""hi"""\n');
    expect(header).toEqual(["a", "b"]);
    expect(rows[0]).toEqual({ a: "x, y", b: 'say "hi"' });
    expect(parseNumber("£1,234.50")).toBe(1234.5);
    expect(parseNumber("(3.00)")).toBe(-3);
    expect(parseNumber("abc")).toBeNull();
    expect(parseDate("31/10/2026")).toBe("2026-10-31");
    expect(parseDate("31/02/2026")).toBeNull();
  });
});

describe("import pipeline", () => {
  it("stages the held-back POS export, imports it, and rejects the duplicate", async () => {
    const before = await engine.periodSummary(b, period("2026-10"));
    const bytes = sampleContent("pos-export-2026-10-31.csv")!;
    const r = await pipeline.stageUpload(b, { sourceType: "pos_sales", fileName: "pos.csv", mime: "text/csv", bytes });
    expect(r.duplicate).toBe(false);
    const id = (r as { id: string }).id;
    const s = await stagedOf(id);
    expect(s.status).toBe("awaiting_review");
    expect(s.staged.issues.filter((i) => i.severity === "error")).toHaveLength(0);
    // Nothing imported before confirmation
    expect((await engine.periodSummary(b, period("2026-10"))).orders).toBe(before.orders);
    const res = await pipeline.confirmUpload(b, id);
    expect(res.imported).toBeGreaterThan(50);
    const after = await engine.periodSummary(b, period("2026-10"));
    expect(after.orders).toBeGreaterThan(before.orders);
    // Same file again → duplicate by hash
    const again = await pipeline.stageUpload(b, { sourceType: "pos_sales", fileName: "pos-copy.csv", mime: "text/csv", bytes });
    expect(again.duplicate).toBe(true);
    // Same orders in a different file → row-level duplicate errors
    const altered = Buffer.from(bytes.toString("utf8").replace(/\n$/, "\n") + "\n");
    const r2 = await pipeline.stageUpload(b, { sourceType: "pos_sales", fileName: "pos-2.csv", mime: "text/csv", bytes: altered });
    const s2 = await stagedOf((r2 as { id: string }).id);
    expect(s2.staged.issues.some((i) => i.message.includes("duplicate"))).toBe(true);
  });

  it("imports the late settlement, replacing estimated commission", async () => {
    const before = await engine.periodSummary(b, period("2026-10"));
    expect(before.commissionEstimatedShare).toBeGreaterThan(0);
    const r = await pipeline.stageUpload(b, { sourceType: "delivery_settlement", fileName: "qp.csv", mime: "text/csv", bytes: sampleContent("platform-settlements-2026-10-26_31.csv")! });
    const id = (r as { id: string }).id;
    expect((await stagedOf(id)).staged.issues.filter((i) => i.severity === "error")).toHaveLength(0);
    await pipeline.confirmUpload(b, id);
    const after = await engine.periodSummary(b, period("2026-10"));
    expect(after.commissionEstimatedShare).toBe(0);
  });

  it("imports the menu export and costs the seasonal special", async () => {
    const r = await pipeline.stageUpload(b, { sourceType: "menu_recipes", fileName: "menu.csv", mime: "text/csv", bytes: sampleContent("menu-recipes-export.csv")! });
    await pipeline.confirmUpload(b, (r as { id: string }).id);
    const m = await engine.menuProfitability(b, period("2026-10"), { withPrevious: false });
    expect(m.items.find((i) => i.name.includes("Seasonal"))!.recipeComplete).toBe(true);
  });

  it("validates waste and labour files and flags bad rows", async () => {
    const w = await pipeline.stageUpload(b, { sourceType: "waste", fileName: "waste.csv", mime: "text/csv", bytes: sampleContent("waste-log-2026-10-31.csv")! });
    await pipeline.confirmUpload(b, (w as { id: string }).id);
    const bad = Buffer.from("date,item,quantity,unit,reason\n2026-10-31,Unicorn steak,1,kg,spoilage\n2026-10-31,Chicken breast fillet,2,l,spoilage\n31/10/2026,Chicken breast fillet,500,g,dropped\n");
    const r = await pipeline.stageUpload(b, { sourceType: "waste", fileName: "bad.csv", mime: "text/csv", bytes: bad });
    const s = await stagedOf((r as { id: string }).id);
    const msgs = s.staged.issues.map((i) => i.message).join(" | ");
    expect(msgs).toMatch(/not a known ingredient/);
    expect(msgs).toMatch(/incompatible/);
    const res = await pipeline.confirmUpload(b, (r as { id: string }).id);
    expect(res.imported).toBe(1); // only the valid row
    const l = await pipeline.stageUpload(b, { sourceType: "labour", fileName: "rota.csv", mime: "text/csv", bytes: sampleContent("rota-hours-2026-10-31.csv")! });
    expect((await pipeline.confirmUpload(b, (l as { id: string }).id)).imported).toBeGreaterThan(5);
  });

  it("rejects a CSV with missing columns", async () => {
    const r = await pipeline.stageUpload(b, { sourceType: "labour", fileName: "x.csv", mime: "text/csv", bytes: Buffer.from("day,hours\n2026-10-01,8\n") });
    const s = await stagedOf((r as { id: string }).id);
    expect(s.status).toBe("failed");
    expect(s.staged.issues[0].message).toMatch(/Missing required column/);
  });

  it("imports the sample PDF invoice and photo receipt via pre-read, checking them against supplier orders", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const pdf = await pipeline.stageUpload(b, { sourceType: "supplier_invoice", fileName: "ocs.pdf", mime: "application/pdf", bytes: sampleContent("ouseburn-invoice-OCS-20794.pdf")! });
    const sp = await stagedOf((pdf as { id: string }).id);
    expect(sp.status).toBe("awaiting_review");
    const msgs = sp.staged.issues.map((i) => i.message).join(" | ");
    expect(msgs).toMatch(/Pre-read demo sample/);
    expect(msgs).toMatch(/Differs from order PO-CT-2041/);
    expect(msgs).toMatch(/Charged £31\.20|£1\.56\/l, agreed £1\.52/);
    expect(msgs).toMatch(/Not on order/);
    const method = (await query<{ extraction_method: string }>(`select extraction_method from uploaded_files where id = $1`, [(pdf as { id: string }).id]))[0].extraction_method;
    expect(method).toBe("preread_sample");
    await pipeline.confirmUpload(b, (pdf as { id: string }).id);

    const png = await pipeline.stageUpload(b, { sourceType: "supplier_invoice", fileName: "tvm.png", mime: "image/png", bytes: sampleContent("tyne-valley-receipt-TVM-4851.png")! });
    const sr = await stagedOf((png as { id: string }).id);
    expect(sr.staged.issues.map((i) => i.message).join(" | ")).toMatch(/Short by 5 kg/);
    await pipeline.confirmUpload(b, (png as { id: string }).id);
    const exp = await query<{ expiry_date: string }>(`select l.expiry_date::text from supplier_invoice_lines l join supplier_invoices i on i.id = l.invoice_id where i.invoice_number = 'TVM-4851' order by l.expiry_date`);
    expect(exp[0].expiry_date).toBe("2026-11-04");
    // Re-uploading is a duplicate
    expect((await pipeline.stageUpload(b, { sourceType: "supplier_invoice", fileName: "tvm2.png", mime: "image/png", bytes: sampleContent("tyne-valley-receipt-TVM-4851.png")! })).duplicate).toBe(true);
  });

  it("refuses unknown documents without an API key rather than guessing", async () => {
    const r = await pipeline.stageUpload(b, { sourceType: "supplier_invoice", fileName: "x.png", mime: "image/png", bytes: Buffer.from("not really a png") });
    const row = (await query<{ status: string; error_message: string }>(`select status, error_message from uploaded_files where id = $1`, [(r as { id: string }).id]))[0];
    expect(row.status).toBe("failed");
    expect(row.error_message).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("imports supplier order confirmations from CSV and rejects duplicates", async () => {
    const csv = Buffer.from("order_ref,supplier,ordered_on,delivery_date,status,item,quantity,unit,unit_price\nPO-CT-3001,North Shields Fish Co,2026-11-01,2026-11-03,confirmed,Haddock fillet,8000,g,0.0172\nPO-CT-3001,North Shields Fish Co,2026-11-01,2026-11-03,confirmed,Lemons,40,each,0.22\nPO-CT-1900,Tyne Valley Meats,2026-08-30,2026-09-01,delivered,Beef mince 15%,5,kg,8.6\n");
    const r = await pipeline.stageUpload(b, { sourceType: "supplier_orders", fileName: "orders.csv", mime: "text/csv", bytes: csv });
    const s = await stagedOf((r as { id: string }).id);
    expect(s.staged.issues.some((i) => i.message.includes("duplicate"))).toBe(true);
    expect((await pipeline.confirmUpload(b, (r as { id: string }).id)).imported).toBe(2);
    const line = (await query<{ quantity: string; unit_price: string }>(`select l.quantity, l.unit_price from supplier_order_lines l join supplier_orders o on o.id = l.order_id where o.order_ref = 'PO-CT-3001' and l.unit = 'kg'`))[0];
    expect(Number(line.quantity)).toBe(8);
    expect(Number(line.unit_price)).toBeCloseTo(17.2);
  });
});
