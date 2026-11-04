/**
 * Import pipeline: upload → parse/extract → STAGE (preview + validation) → owner confirms → commit.
 * Nothing touches the financial tables until confirmUpload(). Uncertain rows are never imported silently:
 * rows with errors are excluded, warnings are shown in the preview.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Transaction } from "@electric-sql/pglite";
import { bulkInsert, num, query, tx, uploadsDir } from "@/lib/db";
import type { BusinessCtx } from "@/lib/finance/engine";
import { toBaseQuantity, type BaseUnit } from "@/lib/finance/formulas";
import { parseCsv, parseDate, parseNumber, parseTime } from "./csv";
import { ExtractionUnavailableError, extractInvoice, type ExtractedInvoice } from "./invoice-extract";
import { liveAiAvailable } from "@/lib/ai/config";
import { prereadFor } from "@/lib/demo/samples";
import { loadOrders } from "@/lib/finance/operations";
import { checkStatus, compareLines, findOrder } from "@/lib/finance/reconcile";

export type SourceType = "pos_sales" | "supplier_invoice" | "menu_recipes" | "delivery_settlement" | "waste" | "labour" | "supplier_orders";
export const SOURCE_TYPES: SourceType[] = ["pos_sales", "supplier_invoice", "menu_recipes", "delivery_settlement", "waste", "labour", "supplier_orders"];

export interface Issue { row: number | null; severity: "error" | "warning"; message: string }
export interface Staged {
  kind: SourceType;
  columns: string[];
  preview: { row: number; cells: (string | number | null)[]; status: "ok" | "warning" | "error"; message?: string }[];
  issues: Issue[];
  summary: Record<string, string | number>;
  payload: unknown;
}

export const CSV_SPECS: Record<Exclude<SourceType, "supplier_invoice">, { required: string[]; optional: string[]; example: string }> = {
  pos_sales: { required: ["order_id", "date", "channel", "item", "quantity", "unit_price"], optional: ["time", "line_discount", "line_refund"], example: "order_id,date,time,channel,item,quantity,unit_price,line_discount,line_refund" },
  delivery_settlement: { required: ["platform", "order_id", "commission"], optional: ["order_date", "order_value", "other_fees", "restaurant_funded_discount", "payout", "settlement_ref"], example: "platform,order_id,order_date,order_value,commission,other_fees,restaurant_funded_discount,payout,settlement_ref" },
  menu_recipes: { required: ["menu_item", "price", "ingredient", "quantity", "unit"], optional: ["category", "delivery_price", "packaging_cost"], example: "menu_item,category,price,delivery_price,packaging_cost,ingredient,quantity,unit" },
  waste: { required: ["date", "item", "quantity", "unit", "reason"], optional: ["item_type", "notes"], example: "date,item,item_type,quantity,unit,reason,notes" },
  labour: { required: ["date", "role", "hours", "hourly_rate"], optional: ["staff_ref"], example: "date,role,staff_ref,hours,hourly_rate" },
  supplier_orders: { required: ["order_ref", "supplier", "delivery_date", "item", "quantity", "unit", "unit_price"], optional: ["status", "ordered_on", "note"], example: "order_ref,supplier,ordered_on,delivery_date,status,item,quantity,unit,unit_price,note" },
};

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const lc = (s: string) => s.trim().toLowerCase();

// ---------------------------------------------------------------------------
// Upload & stage
// ---------------------------------------------------------------------------

export async function stageUpload(b: BusinessCtx, input: { sourceType: SourceType; fileName: string; mime: string; bytes: Buffer }) {
  const hash = sha256(input.bytes);
  const dup = await query<{ id: string; status: string; file_name: string }>(
    `select id, status, file_name from uploaded_files where business_id = $1 and sha256 = $2 and status in ('awaiting_review','imported') limit 1`,
    [b.id, hash],
  );
  if (dup[0]) {
    return { duplicate: true as const, existingId: dup[0].id, message: `This exact file was already uploaded as "${dup[0].file_name}" (${dup[0].status.replace("_", " ")}).` };
  }
  const id = randomUUID();
  const ext = path.extname(input.fileName).slice(0, 10) || ".bin";
  const storagePath = path.join(uploadsDir(), `${id}${ext}`);
  fs.writeFileSync(storagePath, input.bytes);
  const src = await query<{ id: string }>(`select id from data_sources where business_id = $1 and kind = $2`, [b.id, input.sourceType]);
  // Pre-read demo samples: when no API key is configured (or MARGINOS_PREREAD=1), a bundled sample document
  // uses its stored extraction, clearly labelled. Any other document needs live Claude.
  const preread = input.sourceType === "supplier_invoice" && (!liveAiAvailable() || process.env.MARGINOS_PREREAD === "1") ? prereadFor(hash) : null;
  const method = input.sourceType === "supplier_invoice" && input.mime !== "text/csv" ? (preread ? "preread_sample" : "claude") : "csv_parser";
  await query(
    `insert into uploaded_files (id, business_id, data_source_id, source_type, file_name, mime_type, size_bytes, sha256, storage_path, extraction_method, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'processing')`,
    [id, b.id, src[0]?.id ?? null, input.sourceType, input.fileName, input.mime, input.bytes.length, hash, storagePath, method],
  );
  try {
    const staged = await stage(b, input.sourceType, input.bytes, input.mime, preread);
    const errorRows = new Set(staged.issues.filter((i) => i.severity === "error" && i.row !== null).map((i) => i.row));
    const fileError = staged.issues.some((i) => i.severity === "error" && i.row === null);
    const extracted = Number(staged.summary.rows ?? staged.preview.length);
    const valid = fileError ? 0 : extracted - errorRows.size;
    await query(
      `update uploaded_files set status = $2, staged = $3, validation_errors = $4, records_extracted = $5, records_valid = $6 where id = $1`,
      [id, fileError && valid === 0 ? "failed" : "awaiting_review", JSON.stringify(staged), JSON.stringify(staged.issues.slice(0, 500)), extracted, Math.max(0, valid)],
    );
    return { duplicate: false as const, id };
  } catch (err) {
    const message = err instanceof ExtractionUnavailableError ? err.message : `Processing failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error("[import]", err);
    await query(`update uploaded_files set status = 'failed', error_message = $2 where id = $1`, [id, message]);
    return { duplicate: false as const, id };
  }
}

async function stage(b: BusinessCtx, kind: SourceType, bytes: Buffer, mime: string, preread: ExtractedInvoice | null): Promise<Staged> {
  if (kind === "supplier_invoice") return stageInvoice(b, bytes, mime, preread);
  const { header, rows } = parseCsv(bytes.toString("utf8"));
  const spec = CSV_SPECS[kind];
  const missing = spec.required.filter((c) => !header.includes(c));
  if (missing.length) {
    return { kind, columns: header, preview: [], issues: [{ row: null, severity: "error", message: `Missing required column(s): ${missing.join(", ")}. Expected: ${spec.example}` }], summary: { rows: rows.length }, payload: null };
  }
  if (!rows.length) return { kind, columns: header, preview: [], issues: [{ row: null, severity: "error", message: "The file has no data rows." }], summary: { rows: 0 }, payload: null };
  switch (kind) {
    case "pos_sales": return stagePos(b, rows);
    case "delivery_settlement": return stageSettlement(b, rows);
    case "menu_recipes": return stageMenu(b, rows);
    case "waste": return stageWaste(b, rows);
    case "labour": return stageLabour(b, rows);
    case "supplier_orders": return stageOrders(b, rows);
  }
}

function finalize(kind: SourceType, columns: string[], cells: (string | number | null)[][], issues: Issue[], summary: Staged["summary"], payload: unknown): Staged {
  const byRow = new Map<number, Issue[]>();
  for (const i of issues) if (i.row !== null) byRow.set(i.row, [...(byRow.get(i.row) ?? []), i]);
  const preview = cells.map((c, idx) => {
    const row = idx + 2; // header is row 1
    const is = byRow.get(row) ?? [];
    const status = is.some((i) => i.severity === "error") ? "error" : is.length ? "warning" : "ok";
    return { row, cells: c, status: status as "ok" | "warning" | "error", message: is.map((i) => i.message).join("; ") || undefined };
  });
  // Keep the preview bounded: all problem rows plus the first 150.
  const trimmed = preview.filter((p, i) => i < 150 || p.status !== "ok").slice(0, 400);
  return { kind, columns, preview: trimmed, issues, summary: { rows: cells.length, ...summary }, payload };
}

// ---- POS ------------------------------------------------------------------

async function stagePos(b: BusinessCtx, rows: Record<string, string>[]): Promise<Staged> {
  const [items, channels] = await Promise.all([
    query<{ id: string; name: string }>(`select id, name from menu_items where business_id = $1`, [b.id]),
    query<{ id: string; name: string; kind: string }>(`select id, name, kind from sales_channels where business_id = $1`, [b.id]),
  ]);
  const itemBy = new Map(items.map((i) => [lc(i.name), i.id]));
  const chBy = new Map<string, string>();
  for (const c of channels) { chBy.set(lc(c.name), c.id); chBy.set(c.kind, chBy.get(c.kind) ?? c.id); }
  chBy.set("dine in", chBy.get("dine_in") ?? ""); chBy.set("eat in", chBy.get("dine_in") ?? ""); chBy.set("takeaway", chBy.get("collection") ?? "");

  const issues: Issue[] = [];
  const cells: (string | number | null)[][] = [];
  const orders = new Map<string, { ref: string; channelId: string; at: string; lines: { row: number; menuItemId: string; qty: number; unitPrice: number; gross: number; discount: number; refund: number }[] }>();
  rows.forEach((r, i) => {
    const row = i + 2;
    cells.push([r.order_id, r.date, r.time ?? "", r.channel, r.item, r.quantity, r.unit_price, r.line_discount ?? "", r.line_refund ?? ""]);
    const err = (m: string) => issues.push({ row, severity: "error", message: m });
    const date = parseDate(r.date);
    const time = parseTime(r.time);
    const qty = parseNumber(r.quantity);
    const price = parseNumber(r.unit_price);
    const disc = parseNumber(r.line_discount) ?? 0;
    const refund = parseNumber(r.line_refund) ?? 0;
    const itemId = itemBy.get(lc(r.item));
    const chId = chBy.get(lc(r.channel)) || chBy.get(lc(r.channel).replace(/[\s-]/g, "_"));
    if (!r.order_id) err("Missing order_id");
    if (!date) err(`Invalid date "${r.date}" (use YYYY-MM-DD or DD/MM/YYYY)`);
    if (!time) err(`Invalid time "${r.time}"`);
    if (qty === null || qty <= 0) err("Quantity must be a positive number");
    if (price === null || price < 0) err("unit_price must be a number ≥ 0");
    if (!itemId) err(`Unknown menu item "${r.item}" — add it via a menu & recipes import first`);
    if (!chId) err(`Unknown channel "${r.channel}" (expected one of: ${channels.map((c) => c.name).join(", ")})`);
    if (disc < 0 || refund < 0) err("Discounts and refunds must be ≥ 0");
    if (qty !== null && price !== null && disc + refund > qty * price + 0.005) err("Discount + refund exceed the line value");
    if (issues.some((x) => x.row === row && x.severity === "error")) return;
    const o = orders.get(r.order_id) ?? { ref: r.order_id, channelId: chId!, at: `${date}T${time}:00Z`, lines: [] };
    if (o.channelId !== chId) issues.push({ row, severity: "error", message: `Order ${r.order_id} appears with two different channels` });
    o.lines.push({ row, menuItemId: itemId!, qty: qty!, unitPrice: price!, gross: Math.round(qty! * price! * 100) / 100, discount: disc, refund });
    orders.set(r.order_id, o);
  });
  if (orders.size) {
    const existing = await query<{ order_ref: string }>(`select order_ref from sales where business_id = $1 and order_ref = any($2::text[])`, [b.id, [...orders.keys()]]);
    for (const e of existing) {
      for (const l of orders.get(e.order_ref)!.lines) issues.push({ row: l.row, severity: "error", message: `Order ${e.order_ref} is already in your records (duplicate)` });
      orders.delete(e.order_ref);
    }
  }
  // Drop orders where any line failed validation (never import half an order).
  const badRows = new Set(issues.filter((i) => i.severity === "error").map((i) => i.row));
  for (const [ref, o] of orders) if (o.lines.some((l) => badRows.has(l.row))) orders.delete(ref);
  const good = [...orders.values()];
  const dates = good.map((o) => o.at.slice(0, 10)).sort();
  return finalize("pos_sales", ["order_id", "date", "time", "channel", "item", "quantity", "unit_price", "line_discount", "line_refund"], cells, issues, {
    orders: good.length, "gross value (inc VAT)": `£${good.reduce((s, o) => s + o.lines.reduce((x, l) => x + l.gross, 0), 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, "date range": dates.length ? `${dates[0]} → ${dates[dates.length - 1]}` : "—",
  }, good);
}

// ---- Delivery settlement ------------------------------------------------

async function stageSettlement(b: BusinessCtx, rows: Record<string, string>[]): Promise<Staged> {
  const refs = rows.map((r) => r.order_id).filter(Boolean);
  const sales = await query<{ id: string; order_ref: string; kind: string; platform: string | null; gross_amount: string; discount_amount: string; has_fee: boolean }>(
    `select s.id, s.order_ref, c.kind, c.platform, s.gross_amount, s.discount_amount, (df.id is not null) as has_fee
     from sales s join sales_channels c on c.id = s.channel_id left join delivery_fees df on df.sale_id = s.id
     where s.business_id = $1 and s.order_ref = any($2::text[])`,
    [b.id, refs],
  );
  const byRef = new Map(sales.map((s) => [s.order_ref, s]));
  const issues: Issue[] = [];
  const cells: (string | number | null)[][] = [];
  const payload: { saleId: string; platform: string; commission: number; otherFees: number; settlementRef: string | null }[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const row = i + 2;
    cells.push([r.platform, r.order_id, r.order_date ?? "", r.order_value ?? "", r.commission, r.other_fees ?? "", r.restaurant_funded_discount ?? "", r.payout ?? "", r.settlement_ref ?? ""]);
    const err = (m: string) => issues.push({ row, severity: "error", message: m });
    const warn = (m: string) => issues.push({ row, severity: "warning", message: m });
    const s = byRef.get(r.order_id);
    const commission = parseNumber(r.commission);
    const fees = parseNumber(r.other_fees) ?? 0;
    if (commission === null || commission < 0) err("commission must be a number ≥ 0");
    if (!s) { err(`Order ${r.order_id} not found in POS sales — import the POS export for that date first`); return; }
    if (s.kind !== "delivery") err(`Order ${r.order_id} is a ${s.kind.replace("_", "-")} order, not delivery`);
    if (s.platform && lc(s.platform) !== lc(r.platform)) err(`Platform mismatch: POS says ${s.platform}`);
    if (s.has_fee) err(`Settlement for ${r.order_id} already imported (duplicate)`);
    if (seen.has(r.order_id)) err(`Order ${r.order_id} appears twice in this file`);
    seen.add(r.order_id);
    const ov = parseNumber(r.order_value);
    if (ov !== null && Math.abs(ov - num(s.gross_amount)) > 0.05) warn(`Order value £${ov.toFixed(2)} differs from POS £${num(s.gross_amount).toFixed(2)}`);
    const disc = parseNumber(r.restaurant_funded_discount);
    if (disc !== null && Math.abs(disc - num(s.discount_amount)) > 0.05) warn(`Restaurant-funded discount £${disc.toFixed(2)} differs from POS £${num(s.discount_amount).toFixed(2)}`);
    if (issues.some((x) => x.row === row && x.severity === "error")) return;
    payload.push({ saleId: s.id, platform: s.platform ?? r.platform, commission: commission!, otherFees: fees, settlementRef: r.settlement_ref || null });
  });
  return finalize("delivery_settlement", ["platform", "order_id", "order_date", "order_value", "commission", "other_fees", "restaurant_funded_discount", "payout", "settlement_ref"], cells, issues, {
    "orders matched": payload.length, "commission + fees": `£${payload.reduce((s, p) => s + p.commission + p.otherFees, 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  }, payload);
}

// ---- Menu & recipes -------------------------------------------------------

const unitToBase = (u: string): BaseUnit | null => (u === "g" || u === "kg" ? "kg" : u === "ml" || u === "l" ? "l" : u === "each" ? "each" : null);

async function stageMenu(b: BusinessCtx, rows: Record<string, string>[]): Promise<Staged> {
  const [items, ings] = await Promise.all([
    query<{ id: string; name: string; price_gross: string }>(`select id, name, price_gross from menu_items where business_id = $1`, [b.id]),
    query<{ id: string; name: string; base_unit: BaseUnit }>(`select id, name, base_unit from ingredients where business_id = $1`, [b.id]),
  ]);
  const itemBy = new Map(items.map((i) => [lc(i.name), i]));
  const ingBy = new Map(ings.map((i) => [lc(i.name), i]));
  const issues: Issue[] = [];
  const cells: (string | number | null)[][] = [];
  const dishes = new Map<string, { name: string; category: string; price: number; deliveryPrice: number | null; packaging: number; existingId: string | null; lines: { row: number; ingredient: string; ingredientId: string | null; baseUnit: BaseUnit; quantity: number; unit: string }[] }>();
  rows.forEach((r, i) => {
    const row = i + 2;
    cells.push([r.menu_item, r.category ?? "", r.price, r.delivery_price ?? "", r.packaging_cost ?? "", r.ingredient, r.quantity, r.unit]);
    const err = (m: string) => issues.push({ row, severity: "error", message: m });
    const warn = (m: string) => issues.push({ row, severity: "warning", message: m });
    const price = parseNumber(r.price);
    const qty = parseNumber(r.quantity);
    const unit = lc(r.unit ?? "");
    const base = unitToBase(unit);
    if (!r.menu_item) err("Missing menu_item");
    if (price === null || price < 0) err("price must be a number ≥ 0 (VAT inclusive)");
    if (!r.ingredient) err("Missing ingredient");
    if (qty === null || qty <= 0) err("quantity must be > 0");
    if (!base) err(`Unit "${r.unit}" not supported (g, kg, ml, l, each)`);
    const ing = ingBy.get(lc(r.ingredient));
    if (ing && base && toBaseQuantity(1, unit, ing.base_unit) === null) err(`${ing.name} is measured in ${ing.base_unit}; "${unit}" is incompatible`);
    if (!ing && r.ingredient) warn(`New ingredient "${r.ingredient}" will be created without a cost — the dish will show as missing cost until an invoice or standard cost exists`);
    if (issues.some((x) => x.row === row && x.severity === "error")) return;
    const key = lc(r.menu_item);
    const d = dishes.get(key) ?? { name: r.menu_item, category: r.category || "Other", price: price!, deliveryPrice: parseNumber(r.delivery_price), packaging: parseNumber(r.packaging_cost) ?? 0, existingId: itemBy.get(key)?.id ?? null, lines: [] };
    if (d.lines.some((l) => lc(l.ingredient) === lc(r.ingredient))) { issues.push({ row, severity: "error", message: `${r.ingredient} listed twice for ${r.menu_item}` }); return; }
    d.lines.push({ row, ingredient: ing?.name ?? r.ingredient, ingredientId: ing?.id ?? null, baseUnit: ing?.base_unit ?? base!, quantity: qty!, unit });
    dishes.set(key, d);
  });
  const all = [...dishes.values()];
  const priceChanges = all.filter((d) => d.existingId && Math.abs(num(itemBy.get(lc(d.name))!.price_gross) - d.price) > 0.001).length;
  return finalize("menu_recipes", ["menu_item", "category", "price", "delivery_price", "packaging_cost", "ingredient", "quantity", "unit"], cells, issues, {
    dishes: all.length, "new dishes": all.filter((d) => !d.existingId).length, "recipes replaced": all.filter((d) => d.existingId).length, "price changes": priceChanges,
  }, all);
}

// ---- Waste --------------------------------------------------------------

const REASONS: Record<string, string> = { spoilage: "spoilage", spoiled: "spoilage", expired: "spoilage", "out of date": "spoilage", overproduction: "overproduction", "over production": "overproduction", unsold: "overproduction", prep: "prep_trim", prep_trim: "prep_trim", trim: "prep_trim", plate: "plate_waste", plate_waste: "plate_waste", returned: "plate_waste", remake: "plate_waste", damaged: "damaged", dropped: "damaged", other: "other" };

async function stageWaste(b: BusinessCtx, rows: Record<string, string>[]): Promise<Staged> {
  const [items, ings] = await Promise.all([
    query<{ id: string; name: string }>(`select id, name from menu_items where business_id = $1`, [b.id]),
    query<{ id: string; name: string; base_unit: BaseUnit }>(`select id, name, base_unit from ingredients where business_id = $1`, [b.id]),
  ]);
  const itemBy = new Map(items.map((i) => [lc(i.name), i.id]));
  const ingBy = new Map(ings.map((i) => [lc(i.name), i]));
  const issues: Issue[] = [];
  const cells: (string | number | null)[][] = [];
  const payload: { date: string; ingredientId: string | null; menuItemId: string | null; description: string; quantity: number; unit: string; reason: string }[] = [];
  rows.forEach((r, i) => {
    const row = i + 2;
    cells.push([r.date, r.item, r.item_type ?? "", r.quantity, r.unit, r.reason, r.notes ?? ""]);
    const err = (m: string) => issues.push({ row, severity: "error", message: m });
    const date = parseDate(r.date);
    const qty = parseNumber(r.quantity);
    const unit = lc(r.unit ?? "");
    const type = lc(r.item_type ?? "");
    if (!date) err(`Invalid date "${r.date}"`);
    if (qty === null || qty <= 0) err("quantity must be > 0");
    let reason = REASONS[lc(r.reason ?? "")];
    if (!reason) { reason = "other"; issues.push({ row, severity: "warning", message: `Reason "${r.reason}" recorded as "other"` }); }
    const ing = type !== "menu_item" ? ingBy.get(lc(r.item)) : undefined;
    const dish = type !== "ingredient" ? itemBy.get(lc(r.item)) : undefined;
    if (!ing && !dish) err(`"${r.item}" is not a known ingredient or menu item`);
    if (ing && toBaseQuantity(1, unit, ing.base_unit) === null) err(`${ing.name} is measured in ${ing.base_unit}; unit "${unit}" is incompatible`);
    if (!ing && dish && unit !== "portion" && unit !== "each") err("Menu item waste must be recorded in portions");
    if (issues.some((x) => x.row === row && x.severity === "error")) return;
    payload.push({ date: date!, ingredientId: ing?.id ?? null, menuItemId: ing ? null : dish!, description: r.notes || r.item, quantity: qty!, unit: ing ? unit : "portion", reason });
  });
  return finalize("waste", ["date", "item", "item_type", "quantity", "unit", "reason", "notes"], cells, issues, { "records to import": payload.length }, payload);
}

// ---- Supplier order confirmations ----------------------------------------

async function stageOrders(b: BusinessCtx, rows: Record<string, string>[]): Promise<Staged> {
  const [ings, sups, existing] = await Promise.all([
    query<{ id: string; name: string; base_unit: BaseUnit }>(`select id, name, base_unit from ingredients where business_id = $1`, [b.id]),
    query<{ id: string; name: string }>(`select id, name from suppliers where business_id = $1`, [b.id]),
    query<{ order_ref: string }>(`select order_ref from supplier_orders where business_id = $1`, [b.id]),
  ]);
  const ingBy = new Map(ings.map((i) => [lc(i.name), i]));
  const supBy = new Map(sups.map((s) => [lc(s.name), s.id]));
  const ex = new Set(existing.map((e) => e.order_ref));
  const issues: Issue[] = [];
  const cells: (string | number | null)[][] = [];
  const orders = new Map<string, { ref: string; supplier: string; supplierId: string | null; orderedOn: string | null; deliveryDate: string; status: string; note: string | null; lines: { ingredientId: string | null; description: string; quantity: number; unit: string; unitPrice: number }[] }>();
  rows.forEach((r, i) => {
    const row = i + 2;
    cells.push([r.order_ref, r.supplier, r.ordered_on ?? "", r.delivery_date, r.status ?? "", r.item, r.quantity, r.unit, r.unit_price, r.note ?? ""]);
    const err = (m: string) => issues.push({ row, severity: "error", message: m });
    const delivery = parseDate(r.delivery_date);
    const qty = parseNumber(r.quantity);
    const price = parseNumber(r.unit_price);
    const unit = lc(r.unit ?? "");
    const status = lc(r.status || "confirmed");
    if (!r.order_ref) err("Missing order_ref");
    if (!r.supplier) err("Missing supplier");
    if (!delivery) err(`Invalid delivery_date "${r.delivery_date}"`);
    if (qty === null || qty <= 0) err("quantity must be > 0");
    if (price === null || price < 0) err("unit_price must be ≥ 0");
    if (!["confirmed", "dispatched", "delivered"].includes(status)) err(`status must be confirmed, dispatched or delivered`);
    if (r.order_ref && ex.has(r.order_ref)) err(`Order ${r.order_ref} is already recorded (duplicate)`);
    const ing = ingBy.get(lc(r.item));
    let baseQty = qty;
    let basePrice = price;
    if (ing && qty !== null && price !== null) {
      const f = toBaseQuantity(1, unit, ing.base_unit);
      if (f === null) err(`${ing.name} is measured in ${ing.base_unit}; unit "${unit}" is incompatible`);
      else { baseQty = qty * f; basePrice = price / f; }
    } else if (r.item) issues.push({ row, severity: "warning", message: `"${r.item}" is not a known ingredient; it can only be matched to invoice lines by description` });
    if (!supBy.has(lc(r.supplier ?? ""))) issues.push({ row, severity: "warning", message: `New supplier "${r.supplier}" will be created` });
    if (issues.some((x) => x.row === row && x.severity === "error")) return;
    const o = orders.get(r.order_ref) ?? { ref: r.order_ref, supplier: r.supplier, supplierId: supBy.get(lc(r.supplier)) ?? null, orderedOn: parseDate(r.ordered_on), deliveryDate: delivery!, status, note: r.note || null, lines: [] };
    o.lines.push({ ingredientId: ing?.id ?? null, description: ing?.name ?? r.item, quantity: baseQty!, unit: ing?.base_unit ?? unit, unitPrice: basePrice! });
    orders.set(r.order_ref, o);
  });
  const payload = [...orders.values()];
  return finalize("supplier_orders", ["order_ref", "supplier", "ordered_on", "delivery_date", "status", "item", "quantity", "unit", "unit_price", "note"], cells, issues, { orders: payload.length }, payload);
}

// ---- Labour -------------------------------------------------------------

async function stageLabour(b: BusinessCtx, rows: Record<string, string>[]): Promise<Staged> {
  const issues: Issue[] = [];
  const cells: (string | number | null)[][] = [];
  const payload: { date: string; role: string; staffRef: string | null; hours: number; rate: number }[] = [];
  const dates = [...new Set(rows.map((r) => parseDate(r.date)).filter(Boolean))] as string[];
  const existing = await query<{ k: string }>(`select work_date::text || '|' || role || '|' || coalesce(staff_ref,'') as k from labour_records where business_id = $1 and work_date = any($2::date[])`, [b.id, dates]);
  const ex = new Set(existing.map((e) => e.k));
  rows.forEach((r, i) => {
    const row = i + 2;
    cells.push([r.date, r.role, r.staff_ref ?? "", r.hours, r.hourly_rate]);
    const err = (m: string) => issues.push({ row, severity: "error", message: m });
    const date = parseDate(r.date);
    const hours = parseNumber(r.hours);
    const rate = parseNumber(r.hourly_rate);
    if (!date) err(`Invalid date "${r.date}"`);
    if (!r.role) err("Missing role");
    if (hours === null || hours <= 0 || hours > 24) err("hours must be between 0 and 24");
    if (rate === null || rate < 0) err("hourly_rate must be ≥ 0");
    if (rate !== null && rate > 0 && rate < 12.21) issues.push({ row, severity: "warning", message: `£${rate.toFixed(2)}/h is below the National Living Wage — check the rate` });
    if (date && ex.has(`${date}|${r.role}|${r.staff_ref ?? ""}`)) err("A shift for this date, role and staff ref is already recorded (duplicate)");
    if (issues.some((x) => x.row === row && x.severity === "error")) return;
    payload.push({ date: date!, role: r.role, staffRef: r.staff_ref || null, hours: hours!, rate: rate! });
  });
  return finalize("labour", ["date", "role", "staff_ref", "hours", "hourly_rate"], cells, issues, { shifts: payload.length, "wage cost": `£${payload.reduce((s, p) => s + p.hours * p.rate, 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }, payload);
}

// ---- Supplier invoice (Claude extraction) ------------------------------

export interface StagedInvoiceLine {
  description: string;
  invoiceQty: number;
  invoiceUnit: string;
  packSize: number | null;
  packUnit: string | null;
  unitPriceInvoice: number;
  lineTotal: number;
  vatRatePct: number | null;
  ingredientId: string | null;
  ingredientName: string | null;
  baseUnit: BaseUnit | null;
  baseQuantity: number | null;
  baseUnitPrice: number | null;
  expiryDate: string | null;
  confidence: "high" | "medium" | "low";
  include: boolean;
  issues: string[];
  orderIssues: string[];
}

export interface StagedOrderCheck {
  orderRef: string | null;
  method: string | null;
  status: "verified" | "discrepancies" | "no_order";
  atStake: number;
  missingFromInvoice: string[];
}

async function stageInvoice(b: BusinessCtx, bytes: Buffer, mime: string, preread: ExtractedInvoice | null): Promise<Staged> {
  if (!["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime)) {
    return { kind: "supplier_invoice", columns: [], preview: [], issues: [{ row: null, severity: "error", message: `Unsupported file type ${mime}. Upload a PDF, PNG, JPEG or WebP.` }], summary: {}, payload: null };
  }
  const ings = await query<{ id: string; name: string; base_unit: BaseUnit }>(`select id, name, base_unit from ingredients where business_id = $1 order by name`, [b.id]);
  const ex: ExtractedInvoice = preread ?? (await extractInvoice(bytes, mime, ings.map((i) => i.name)));
  const staged = await buildStagedInvoice(b, ex, ings);
  if (preread) {
    staged.issues.unshift({ row: null, severity: "warning", message: "Pre-read demo sample: this result was stored in advance (no API key is configured, or MARGINOS_PREREAD=1). It was not produced live by Claude for this upload." });
    staged.summary = { ...staged.summary, method: "pre-read sample (not live AI)" };
  }
  return staged;
}

export async function buildStagedInvoice(b: BusinessCtx, ex: ExtractedInvoice, ings: { id: string; name: string; base_unit: BaseUnit }[]): Promise<Staged> {
  const ingBy = new Map(ings.map((i) => [lc(i.name), i]));
  const issues: Issue[] = [];
  if (ex.is_invoice === false) issues.push({ row: null, severity: "error", message: "This doesn't look like a supplier invoice, receipt or delivery note." });
  const sup = await query<{ id: string; name: string }>(`select id, name from suppliers where business_id = $1 and lower(name) = lower($2)`, [b.id, ex.supplier_name.trim()]);
  const date = parseDate(ex.invoice_date);
  if (!date) issues.push({ row: null, severity: "error", message: `Could not read a valid invoice date ("${ex.invoice_date}")` });
  if (!ex.invoice_number.trim()) issues.push({ row: null, severity: "error", message: "No invoice number found" });
  if (!sup[0]) issues.push({ row: null, severity: "warning", message: `New supplier "${ex.supplier_name}" will be created` });
  if (sup[0]) {
    const dup = await query(`select 1 from supplier_invoices where business_id = $1 and supplier_id = $2 and invoice_number = $3`, [b.id, sup[0].id, ex.invoice_number.trim()]);
    if (dup.length) issues.push({ row: null, severity: "error", message: `Invoice ${ex.invoice_number} from ${sup[0].name} is already recorded (duplicate)` });
  }
  if (ex.extraction_confidence !== "high") issues.push({ row: null, severity: "warning", message: `Claude rated this extraction "${ex.extraction_confidence}" confidence${ex.notes ? `: ${ex.notes}` : ""}` });
  else if (ex.notes) issues.push({ row: null, severity: "warning", message: `Extraction note: ${ex.notes}` });

  const lines: StagedInvoiceLine[] = ex.lines.map((l) => {
    const li: string[] = [];
    if (Math.abs(l.quantity * l.unit_price - l.line_total) > 0.02 + l.line_total * 0.005) li.push(`Quantity × price (£${(l.quantity * l.unit_price).toFixed(2)}) ≠ line total £${l.line_total.toFixed(2)}`);
    if (l.confidence === "low") li.push("Claude wasn't sure it read this line correctly");
    const ing = l.matched_ingredient ? ingBy.get(lc(l.matched_ingredient)) ?? null : null;
    let baseQuantity: number | null = null;
    if (ing) {
      if (l.pack_size_quantity && l.pack_size_unit) baseQuantity = toBaseQuantity(l.quantity * l.pack_size_quantity, l.pack_size_unit, ing.base_unit);
      else if (toBaseQuantity(1, l.invoice_unit, ing.base_unit) !== null) baseQuantity = toBaseQuantity(l.quantity, l.invoice_unit, ing.base_unit);
      if (baseQuantity === null) li.push(`Cannot convert "${l.invoice_unit}" to ${ing.base_unit} — pack size missing; line will not update ingredient costs`);
    } else li.push("Not matched to an ingredient — stored on the invoice but not used for costing");
    const expiry = l.expiry_date ? parseDate(l.expiry_date) : null;
    return {
      description: l.description, invoiceQty: l.quantity, invoiceUnit: l.invoice_unit, packSize: l.pack_size_quantity, packUnit: l.pack_size_unit, unitPriceInvoice: l.unit_price, lineTotal: l.line_total, vatRatePct: l.vat_rate_pct,
      ingredientId: ing?.id ?? null, ingredientName: ing?.name ?? null, baseUnit: ing?.base_unit ?? null, baseQuantity,
      baseUnitPrice: baseQuantity ? l.line_total / baseQuantity : null, expiryDate: expiry, confidence: l.confidence ?? "medium", include: true, issues: li, orderIssues: [],
    };
  });

  // Check against the supplier's order confirmation (adapted from LarderCheck's reconcile step).
  let orderCheck: StagedOrderCheck = { orderRef: null, method: null, status: "no_order", atStake: 0, missingFromInvoice: [] };
  if (date) {
    const orders = await loadOrders(b, date, date);
    const m = findOrder({ orderRef: ex.order_ref, supplier: ex.supplier_name, date }, orders);
    if (m) {
      const cmp = compareLines(lines.map((l) => ({ key: l.ingredientId, description: l.description, quantity: l.baseQuantity ?? l.invoiceQty, unit: l.baseUnit ?? l.invoiceUnit, unitPrice: l.baseUnitPrice ?? l.unitPriceInvoice, lineTotal: l.lineTotal })), m.order);
      cmp.lines.forEach((c, i) => { lines[i].orderIssues = c.issues.map((x) => x.text); });
      orderCheck = { orderRef: m.order.orderRef, method: m.method, status: checkStatus(m.order, cmp.lines, cmp.missingFromInvoice), atStake: cmp.atStake, missingFromInvoice: cmp.missingFromInvoice.map((x) => x.description) };
      if (orderCheck.status === "discrepancies") issues.push({ row: null, severity: "warning", message: `Differs from order ${m.order.orderRef} (matched by ${m.method})${cmp.atStake > 0 ? `: £${cmp.atStake.toFixed(2)} charged above the order — consider asking ${ex.supplier_name} for a credit` : ""}.` });
      if (cmp.missingFromInvoice.length) issues.push({ row: null, severity: "warning", message: `Ordered but not on the invoice: ${orderCheck.missingFromInvoice.join(", ")}` });
    } else {
      issues.push({ row: null, severity: "warning", message: `No matching order confirmation found${ex.order_ref ? ` for ${ex.order_ref}` : ""}; prices can't be checked against what was agreed.` });
    }
  }
  lines.forEach((l, idx) => { for (const m of [...l.issues, ...l.orderIssues]) issues.push({ row: idx + 1, severity: "warning", message: m }); });

  const sumLines = lines.reduce((s, l) => s + l.lineTotal, 0);
  if (ex.subtotal !== null && Math.abs(sumLines - ex.subtotal) > 0.05) issues.push({ row: null, severity: "warning", message: `Line totals (£${sumLines.toFixed(2)}) do not match the invoice subtotal (£${ex.subtotal.toFixed(2)})` });
  if (ex.subtotal !== null && ex.vat !== null && ex.total !== null && Math.abs(ex.subtotal + ex.vat - ex.total) > 0.05) issues.push({ row: null, severity: "warning", message: "Subtotal + VAT does not equal the invoice total" });
  return {
    kind: "supplier_invoice",
    columns: ["description", "qty", "unit", "unit price", "line total", "ingredient", "base qty", "£/base unit"],
    preview: lines.map((l, i) => ({ row: i + 1, cells: [l.description, l.invoiceQty, l.invoiceUnit, l.unitPriceInvoice, l.lineTotal, l.ingredientName, l.baseQuantity !== null ? `${l.baseQuantity} ${l.baseUnit}` : null, l.baseUnitPrice], status: l.issues.length || l.orderIssues.length ? "warning" : "ok", message: [...l.issues, ...l.orderIssues].join("; ") || undefined })),
    issues,
    summary: {
      rows: lines.length, supplier: ex.supplier_name, "invoice number": ex.invoice_number, "order ref": ex.order_ref ?? "—", date: date ?? ex.invoice_date,
      subtotal: ex.subtotal ?? "—", vat: ex.vat ?? "—", total: ex.total ?? "—", confidence: ex.extraction_confidence,
      "order check": orderCheck.status === "verified" ? `matches ${orderCheck.orderRef}` : orderCheck.status === "no_order" ? "no order on file" : `differs from ${orderCheck.orderRef}${orderCheck.atStake ? ` · £${orderCheck.atStake.toFixed(2)} at stake` : ""}`,
    },
    payload: { supplierName: ex.supplier_name.trim(), supplierId: sup[0]?.id ?? null, invoiceNumber: ex.invoice_number.trim(), orderRef: ex.order_ref?.trim() || orderCheck.orderRef, date, subtotal: ex.subtotal ?? sumLines, vat: ex.vat ?? 0, total: ex.total ?? sumLines + (ex.vat ?? 0), lines, orderCheck },
  };
}

// ---------------------------------------------------------------------------
// Confirm / discard
// ---------------------------------------------------------------------------

export interface InvoiceOverrides { lines: { index: number; ingredientId: string | null; include: boolean; baseQuantity: number | null }[] }

export async function confirmUpload(b: BusinessCtx, fileId: string, overrides?: InvoiceOverrides) {
  const rows = await query<{ status: string; staged: Staged | null; source_type: SourceType }>(`select status, staged, source_type from uploaded_files where id = $1 and business_id = $2`, [fileId, b.id]);
  const f = rows[0];
  if (!f) throw new Error("Upload not found");
  if (f.status !== "awaiting_review") throw new Error(`Upload is ${f.status.replace("_", " ")} and cannot be confirmed`);
  if (!f.staged?.payload) throw new Error("Nothing valid to import");
  if (f.staged.issues.some((i) => i.severity === "error" && i.row === null)) throw new Error("This file has blocking errors and cannot be imported");
  const staged = f.staged;
  const imported = await tx(async (t) => {
    const n = await commit(t, b, fileId, staged, overrides);
    await t.query(`update uploaded_files set status = 'imported', records_imported = $2, confirmed_at = now() where id = $1`, [fileId, n]);
    return n;
  });
  return { imported };
}

export async function discardUpload(b: BusinessCtx, fileId: string) {
  await query(`update uploaded_files set status = 'discarded', staged = null where id = $1 and business_id = $2 and status in ('awaiting_review','failed')`, [fileId, b.id]);
}

async function commit(t: Transaction, b: BusinessCtx, fileId: string, s: Staged, overrides?: InvoiceOverrides): Promise<number> {
  switch (s.kind) {
    case "pos_sales": {
      const orders = s.payload as { ref: string; channelId: string; at: string; lines: { menuItemId: string; qty: number; unitPrice: number; gross: number; discount: number; refund: number }[] }[];
      // Re-check duplicates inside the transaction (another import may have landed since staging).
      const existing = new Set((await t.query<{ order_ref: string }>(`select order_ref from sales where business_id = $1 and order_ref = any($2::text[])`, [b.id, orders.map((o) => o.ref)])).rows.map((r) => r.order_ref));
      const saleRows: unknown[][] = [];
      const itemRows: unknown[][] = [];
      for (const o of orders) {
        if (existing.has(o.ref)) continue;
        const id = randomUUID();
        const r2 = (n: number) => Math.round(n * 100) / 100;
        saleRows.push([id, b.id, o.channelId, o.ref, o.at, r2(o.lines.reduce((x, l) => x + l.gross, 0)), r2(o.lines.reduce((x, l) => x + l.discount, 0)), r2(o.lines.reduce((x, l) => x + l.refund, 0)), fileId, "import"]);
        for (const l of o.lines) itemRows.push([randomUUID(), b.id, id, l.menuItemId, l.qty, l.unitPrice, l.gross, l.discount, l.refund]);
      }
      await bulkInsert(t, "sales", ["id", "business_id", "channel_id", "order_ref", "ordered_at", "gross_amount", "discount_amount", "refund_amount", "uploaded_file_id", "source"], saleRows);
      await bulkInsert(t, "sale_items", ["id", "business_id", "sale_id", "menu_item_id", "quantity", "unit_price_gross", "line_gross", "line_discount", "line_refund"], itemRows);
      return itemRows.length;
    }
    case "delivery_settlement": {
      const p = s.payload as { saleId: string; platform: string; commission: number; otherFees: number; settlementRef: string | null }[];
      const existing = new Set((await t.query<{ sale_id: string }>(`select sale_id from delivery_fees where sale_id = any($1::uuid[])`, [p.map((x) => x.saleId)])).rows.map((r) => r.sale_id));
      const rows = p.filter((x) => !existing.has(x.saleId)).map((x) => [randomUUID(), b.id, x.saleId, x.platform, x.commission, x.otherFees, x.settlementRef, fileId]);
      await bulkInsert(t, "delivery_fees", ["id", "business_id", "sale_id", "platform", "commission_amount", "other_fees", "settlement_ref", "uploaded_file_id"], rows);
      return rows.length;
    }
    case "menu_recipes": {
      const dishes = s.payload as { name: string; category: string; price: number; deliveryPrice: number | null; packaging: number; existingId: string | null; lines: { ingredient: string; ingredientId: string | null; baseUnit: BaseUnit; quantity: number; unit: string }[] }[];
      let n = 0;
      for (const d of dishes) {
        let id = d.existingId;
        if (id) await t.query(`update menu_items set category=$2, price_gross=$3, delivery_price_gross=$4, packaging_cost=$5 where id=$1`, [id, d.category, d.price, d.deliveryPrice, d.packaging]);
        else {
          id = randomUUID();
          await t.query(`insert into menu_items (id, business_id, name, category, price_gross, delivery_price_gross, packaging_cost) values ($1,$2,$3,$4,$5,$6,$7)`, [id, b.id, d.name, d.category, d.price, d.deliveryPrice, d.packaging]);
        }
        await t.query(`delete from recipes where menu_item_id = $1`, [id]);
        const rid = randomUUID();
        await t.query(`insert into recipes (id, business_id, menu_item_id, portions) values ($1,$2,$3,1)`, [rid, b.id, id]);
        for (const l of d.lines) {
          let ingId = l.ingredientId;
          if (!ingId) {
            const found = await t.query<{ id: string }>(`select id from ingredients where business_id = $1 and lower(name) = lower($2)`, [b.id, l.ingredient]);
            ingId = found.rows[0]?.id ?? randomUUID();
            if (!found.rows[0]) await t.query(`insert into ingredients (id, business_id, name, base_unit) values ($1,$2,$3,$4)`, [ingId, b.id, l.ingredient, l.baseUnit]);
          }
          await t.query(`insert into recipe_ingredients (business_id, recipe_id, ingredient_id, quantity, unit) values ($1,$2,$3,$4,$5)`, [b.id, rid, ingId, l.quantity, l.unit]);
          n++;
        }
      }
      return n;
    }
    case "waste": {
      const p = s.payload as { date: string; ingredientId: string | null; menuItemId: string | null; description: string; quantity: number; unit: string; reason: string }[];
      await bulkInsert(t, "waste_records", ["id", "business_id", "recorded_on", "ingredient_id", "menu_item_id", "description", "quantity", "unit", "reason", "uploaded_file_id"], p.map((w) => [randomUUID(), b.id, w.date, w.ingredientId, w.menuItemId, w.description, w.quantity, w.unit, w.reason, fileId]));
      return p.length;
    }
    case "supplier_orders": {
      const orders = s.payload as { ref: string; supplier: string; supplierId: string | null; orderedOn: string | null; deliveryDate: string; status: string; note: string | null; lines: { ingredientId: string | null; description: string; quantity: number; unit: string; unitPrice: number }[] }[];
      let n = 0;
      for (const o of orders) {
        const exists = await t.query(`select 1 from supplier_orders where business_id = $1 and order_ref = $2`, [b.id, o.ref]);
        if (exists.rows.length) continue;
        let supplierId = o.supplierId;
        if (!supplierId) {
          await t.query(`insert into suppliers (business_id, name) values ($1,$2) on conflict (business_id, name) do nothing`, [b.id, o.supplier]);
          supplierId = (await t.query<{ id: string }>(`select id from suppliers where business_id = $1 and name = $2`, [b.id, o.supplier])).rows[0].id;
        }
        const oid = randomUUID();
        await t.query(`insert into supplier_orders (id, business_id, supplier_id, order_ref, status, ordered_on, delivery_date, note, uploaded_file_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [oid, b.id, supplierId, o.ref, o.status, o.orderedOn, o.deliveryDate, o.note, fileId]);
        await bulkInsert(t, "supplier_order_lines", ["id", "business_id", "order_id", "ingredient_id", "description", "quantity", "unit", "unit_price"], o.lines.map((l) => [randomUUID(), b.id, oid, l.ingredientId, l.description, l.quantity, l.unit, l.unitPrice]));
        n += o.lines.length;
      }
      return n;
    }
    case "labour": {
      const p = s.payload as { date: string; role: string; staffRef: string | null; hours: number; rate: number }[];
      await bulkInsert(t, "labour_records", ["id", "business_id", "work_date", "role", "staff_ref", "hours", "hourly_rate", "cost", "uploaded_file_id"], p.map((l) => [randomUUID(), b.id, l.date, l.role, l.staffRef, l.hours, l.rate, Math.round(l.hours * l.rate * 10000) / 10000, fileId]));
      return p.length;
    }
    case "supplier_invoice": {
      const p = s.payload as { supplierName: string; supplierId: string | null; invoiceNumber: string; orderRef?: string | null; date: string; subtotal: number; vat: number; total: number; lines: StagedInvoiceLine[] };
      const ings = new Map((await t.query<{ id: string; base_unit: BaseUnit; name: string }>(`select id, base_unit, name from ingredients where business_id = $1`, [b.id])).rows.map((r) => [r.id, r]));
      let supplierId = p.supplierId;
      if (!supplierId) {
        supplierId = randomUUID();
        await t.query(`insert into suppliers (id, business_id, name) values ($1,$2,$3) on conflict (business_id, name) do nothing`, [supplierId, b.id, p.supplierName]);
        supplierId = (await t.query<{ id: string }>(`select id from suppliers where business_id = $1 and name = $2`, [b.id, p.supplierName])).rows[0].id;
      }
      const dup = await t.query(`select 1 from supplier_invoices where business_id = $1 and supplier_id = $2 and invoice_number = $3`, [b.id, supplierId, p.invoiceNumber]);
      if (dup.rows.length) throw new Error(`Invoice ${p.invoiceNumber} is already recorded`);
      const iid = randomUUID();
      await t.query(`insert into supplier_invoices (id, business_id, supplier_id, invoice_number, invoice_date, subtotal, vat_amount, total, uploaded_file_id, source, order_ref) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'import',$10)`, [iid, b.id, supplierId, p.invoiceNumber, p.date, p.subtotal, p.vat, p.total, fileId, p.orderRef ?? null]);
      let n = 0;
      const lineRows: unknown[][] = [];
      p.lines.forEach((l, idx) => {
        const o = overrides?.lines.find((x) => x.index === idx);
        if (o && !o.include) return;
        const ingId = o ? o.ingredientId : l.ingredientId;
        const ing = ingId ? ings.get(ingId) : undefined;
        let baseQty = o?.baseQuantity ?? (ingId === l.ingredientId ? l.baseQuantity : null);
        if (ing && baseQty === null && l.packSize && l.packUnit) baseQty = toBaseQuantity(l.invoiceQty * l.packSize, l.packUnit, ing.base_unit);
        // Never trust a quantity whose pack unit is incompatible with the ingredient (e.g. litres for a kg ingredient).
        if (ing && l.packUnit && toBaseQuantity(1, l.packUnit, ing.base_unit) === null && !(o && o.ingredientId !== l.ingredientId && o.baseQuantity)) baseQty = null;
        const usable = ing && baseQty && baseQty > 0;
        n++;
        // Lines that cannot be converted to a base quantity are kept for the record but not linked to an ingredient.
        lineRows.push([randomUUID(), b.id, iid, usable ? ing!.id : null, l.description, `${l.invoiceQty} × ${l.invoiceUnit}${l.packSize ? ` (${l.packSize}${l.packUnit})` : ""}`, usable ? baseQty : l.invoiceQty, usable ? ing!.base_unit : "each", usable ? l.lineTotal / baseQty! : l.unitPriceInvoice, l.lineTotal, l.expiryDate ?? null, l.confidence ?? null]);
      });
      await bulkInsert(t, "supplier_invoice_lines", ["id", "business_id", "invoice_id", "ingredient_id", "description", "pack_description", "quantity", "unit", "unit_price", "line_total", "expiry_date", "confidence"], lineRows);
      return n;
    }
  }
}

