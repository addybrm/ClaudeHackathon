/**
 * Sample import files for the demo restaurant. They contain the records deliberately held
 * back from the seed (31 October exports, the late QuickPlate settlement, the menu export
 * that adds the seasonal special's recipe, and a late supplier invoice as a PDF).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { toCsv } from "@/lib/imports/csv";
import type { ExtractedInvoice } from "@/lib/imports/invoice-extract";
import { CHANNELS, HELD_BACK_DAY, INGREDIENTS, MENU, QP_UNSETTLED_FROM, SAMPLE_PDF_INVOICE, SPECIAL_RECIPE_CSV, generateDemo } from "./generate";

export interface SampleFile { name: string; sourceType: string; title: string; description: string; mime: string }

export const SAMPLE_FILES: SampleFile[] = [
  { name: "pos-export-2026-10-31.csv", sourceType: "pos_sales", title: "POS export · 31 Oct", description: "Saturday 31 October till export (all channels).", mime: "text/csv" },
  { name: "platform-settlements-2026-10-26_31.csv", sourceType: "delivery_settlement", title: "Platform settlements · 26–31 Oct", description: "Late QuickPlate statement (26–31 Oct) and FeastFleet 31 Oct. Replaces estimated commission with actuals. Import after the 31 Oct POS export.", mime: "text/csv" },
  { name: "ouseburn-invoice-OCS-20794.pdf", sourceType: "supplier_invoice", title: "Supplier invoice (PDF)", description: "Ouseburn Catering Supplies, 29 Oct. Oil is charged above the agreed order price, and there is a line that wasn't ordered.", mime: "application/pdf" },
  { name: "tyne-valley-receipt-TVM-4851.png", sourceType: "supplier_invoice", title: "Delivery receipt (photo)", description: "Tyne Valley Meats, 30 Oct. Abbreviated lines, printed use-by dates, and a short delivery against the order.", mime: "image/png" },
  { name: "menu-recipes-export.csv", sourceType: "menu_recipes", title: "Menu & recipes export", description: "Full menu export, including a recipe for the Chef's Seasonal Special.", mime: "text/csv" },
  { name: "waste-log-2026-10-31.csv", sourceType: "waste", title: "Waste log · 31 Oct", description: "Kitchen waste sheet for 31 October.", mime: "text/csv" },
  { name: "rota-hours-2026-10-31.csv", sourceType: "labour", title: "Rota hours · 31 Oct", description: "Worked hours by shift for 31 October.", mime: "text/csv" },
];

const chName = (key: string) => CHANNELS.find((c) => c.key === key)!.name;
const ingName = (key: string) => INGREDIENTS.find((i) => i.key === key)!.name;

export function sampleContent(name: string): Buffer | null {
  const d = generateDemo();
  switch (name) {
    case "pos-export-2026-10-31.csv": {
      const rows: (string | number)[][] = [];
      for (const o of d.orders.filter((o) => o.at.startsWith(HELD_BACK_DAY))) {
        for (const l of o.lines) rows.push([o.ref, "31/10/2026", o.at.slice(11, 16), chName(o.channel), l.item, l.qty, l.unitPrice.toFixed(2), l.discount.toFixed(2), l.refund.toFixed(2)]);
      }
      return Buffer.from(toCsv(["order_id", "date", "time", "channel", "item", "quantity", "unit_price", "line_discount", "line_refund"], rows));
    }
    case "platform-settlements-2026-10-26_31.csv": {
      const rows = d.orders
        .filter((o) => o.commission !== null && ((o.channel === "qp" && o.at.slice(0, 10) >= QP_UNSETTLED_FROM) || o.at.startsWith(HELD_BACK_DAY)))
        .map((o) => [CHANNELS.find((c) => c.key === o.channel)!.platform!, o.ref, o.at.slice(0, 10), o.gross.toFixed(2), (o.commission ?? 0).toFixed(2), o.otherFees.toFixed(2), o.discount.toFixed(2), (o.gross - o.discount - o.refund - (o.commission ?? 0) - o.otherFees).toFixed(2), o.settlementRef ?? ""]);
      return Buffer.from(toCsv(["platform", "order_id", "order_date", "order_value", "commission", "other_fees", "restaurant_funded_discount", "payout", "settlement_ref"], rows));
    }
    case "menu-recipes-export.csv": {
      const rows: (string | number)[][] = [];
      for (const m of MENU) {
        const recipe = m.recipe ?? SPECIAL_RECIPE_CSV;
        for (const [ing, q, u] of recipe) rows.push([m.name, m.category, m.price.toFixed(2), m.deliveryPrice?.toFixed(2) ?? "", m.packaging.toFixed(2), ingName(ing), q, u]);
      }
      return Buffer.from(toCsv(["menu_item", "category", "price", "delivery_price", "packaging_cost", "ingredient", "quantity", "unit"], rows));
    }
    case "waste-log-2026-10-31.csv": {
      const rows = d.waste.filter((w) => w.date === HELD_BACK_DAY).map((w) => [w.date, w.ingredient ? ingName(w.ingredient) : w.menuItem!, w.ingredient ? "ingredient" : "menu_item", w.quantity, w.unit, w.reason, w.description]);
      return Buffer.from(toCsv(["date", "item", "item_type", "quantity", "unit", "reason", "notes"], rows));
    }
    case "rota-hours-2026-10-31.csv": {
      const rows = d.labour.filter((l) => l.date === HELD_BACK_DAY).map((l) => [l.date, l.role, l.staffRef, l.hours, l.rate.toFixed(2)]);
      return Buffer.from(toCsv(["date", "role", "staff_ref", "hours", "hourly_rate"], rows));
    }
    case "ouseburn-invoice-OCS-20794.pdf":
      return invoicePdf();
    case "tyne-valley-receipt-TVM-4851.png": {
      const f = path.join(process.cwd(), "src", "lib", "demo", "assets", "tyne-valley-receipt-TVM-4851.png");
      return fs.existsSync(f) ? fs.readFileSync(f) : null;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Minimal single-page PDF writer (Helvetica, WinAnsi) — enough for a realistic text invoice.
// ---------------------------------------------------------------------------

function invoicePdf(): Buffer {
  const inv = SAMPLE_PDF_INVOICE;
  const ops: string[] = [];
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const text = (x: number, y: number, s: string, size = 10, bold = false) => ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET`);
  const right = (xr: number, y: number, s: string, size = 10, bold = false) => text(xr - s.length * size * 0.5, y, s, size, bold);
  const line = (x1: number, y1: number, x2: number, y2: number) => ops.push(`0.6 w ${x1} ${y1} m ${x2} ${y2} l S`);
  const money = (n: number) => `£${n.toFixed(2)}`;

  text(50, 790, inv.supplier, 18, true);
  inv.address.forEach((a, i) => text(50, 772 - i * 13, a, 9));
  text(50, 733, `VAT reg: ${inv.vatNo}`, 9);
  text(400, 790, "INVOICE", 18, true);
  text(400, 770, `Invoice no: ${inv.number}`, 10);
  text(400, 756, `Date: 29/10/2026`, 10);
  text(400, 742, `Your order: ${inv.orderRef}`, 10);
  text(400, 728, `Terms: 30 days`, 10);
  text(50, 700, "Bill to:", 10, true);
  inv.billTo.forEach((a, i) => text(50, 686 - i * 13, a, 10));
  text(50, 646, "DEMO DOCUMENT - fictional supplier and customer, generated by MarginOS", 8);

  const y0 = 610;
  text(50, y0, "Description", 10, true); text(300, y0, "Qty", 10, true); text(340, y0, "Unit", 10, true);
  right(450, y0, "Unit price", 10, true); right(500, y0, "VAT", 10, true); right(560, y0, "Net", 10, true);
  line(50, y0 - 6, 560, y0 - 6);
  let y = y0 - 24;
  let net = 0, vat = 0;
  for (const l of inv.lines) {
    const n = l.qty * l.unitPrice;
    net += n; vat += (n * l.vat) / 100;
    text(50, y, l.description); text(300, y, String(l.qty)); text(340, y, l.unit);
    right(450, y, money(l.unitPrice)); right(500, y, `${l.vat}%`); right(560, y, money(n));
    y -= 20;
  }
  line(350, y + 6, 560, y + 6);
  y -= 12;
  right(470, y, "Subtotal (net)"); right(560, y, money(net)); y -= 16;
  right(470, y, "VAT"); right(560, y, money(vat)); y -= 16;
  right(470, y, "Total due", 11, true); right(560, y, money(net + vat), 11, true);
  text(50, 120, "Food items zero-rated for VAT. Packaging standard-rated at 20%.", 8);
  text(50, 108, "Payment: BACS to Ouseburn Catering Supplies, sort code 00-00-00 (fictional).", 8);

  const content = ops.join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// ---------------------------------------------------------------------------
// Pre-read samples (idea from LarderCheck): the result Claude should give for each bundled sample
// document, used only when no API key is configured (or MARGINOS_PREREAD=1). Always labelled.
// ---------------------------------------------------------------------------

const PREREAD: Record<string, ExtractedInvoice> = {
  "ouseburn-invoice-OCS-20794.pdf": {
    is_invoice: true, supplier_name: "Ouseburn Catering Supplies", invoice_number: "OCS-20794", order_ref: "PO-CT-2041", invoice_date: "2026-10-29",
    subtotal: 155.92, vat: 7.6, total: 163.52, extraction_confidence: "high", notes: null,
    lines: [
      { description: "Rapeseed frying oil 20L drum", quantity: 3, invoice_unit: "drum", pack_size_quantity: 20, pack_size_unit: "l", unit_price: 31.2, line_total: 93.6, vat_rate_pct: 0, matched_ingredient: "Rapeseed frying oil", expiry_date: null, confidence: "high" },
      { description: "Panko breadcrumbs 2kg bag", quantity: 2, invoice_unit: "bag", pack_size_quantity: 2, pack_size_unit: "kg", unit_price: 6.4, line_total: 12.8, vat_rate_pct: 0, matched_ingredient: "Panko breadcrumbs", expiry_date: null, confidence: "high" },
      { description: "Plain flour 16kg sack", quantity: 1, invoice_unit: "sack", pack_size_quantity: 16, pack_size_unit: "kg", unit_price: 11.52, line_total: 11.52, vat_rate_pct: 0, matched_ingredient: "Plain flour", expiry_date: null, confidence: "high" },
      { description: "Kraft takeaway boxes (x200)", quantity: 1, invoice_unit: "case", pack_size_quantity: 200, pack_size_unit: "each", unit_price: 38, line_total: 38, vat_rate_pct: 20, matched_ingredient: null, expiry_date: null, confidence: "high" },
    ],
  },
  "tyne-valley-receipt-TVM-4851.png": {
    is_invoice: true, supplier_name: "Tyne Valley Meats", invoice_number: "TVM-4851", order_ref: "PO-CT-2042", invoice_date: "2026-10-30",
    subtotal: 182.75, vat: 0, total: 182.75, extraction_confidence: "high", notes: "Photo of a thermal receipt; all lines legible.",
    lines: [
      { description: "CHKN BRST FILLET 5KG", quantity: 3, invoice_unit: "case", pack_size_quantity: 5, pack_size_unit: "kg", unit_price: 30.5, line_total: 91.5, vat_rate_pct: 0, matched_ingredient: "Chicken breast fillet", expiry_date: "2026-11-05", confidence: "high" },
      { description: "CHKN THIGH BNLS 5KG", quantity: 2, invoice_unit: "case", pack_size_quantity: 5, pack_size_unit: "kg", unit_price: 23.75, line_total: 47.5, vat_rate_pct: 0, matched_ingredient: "Chicken thigh, boneless", expiry_date: "2026-11-05", confidence: "high" },
      { description: "BEEF MINCE 15% 5KG", quantity: 1, invoice_unit: "case", pack_size_quantity: 5, pack_size_unit: "kg", unit_price: 43.75, line_total: 43.75, vat_rate_pct: 0, matched_ingredient: "Beef mince 15%", expiry_date: "2026-11-04", confidence: "high" },
    ],
  },
};

let prereadByHash: Map<string, ExtractedInvoice> | null = null;
export function prereadFor(hash: string): ExtractedInvoice | null {
  if (!prereadByHash) {
    prereadByHash = new Map();
    for (const [name, ex] of Object.entries(PREREAD)) {
      const bytes = sampleContent(name);
      if (bytes) prereadByHash.set(createHash("sha256").update(bytes).digest("hex"), ex);
    }
  }
  return prereadByHash.get(hash) ?? null;
}
