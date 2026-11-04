import { randomUUID, createHash } from "node:crypto";
import { bulkInsert, query, tx } from "@/lib/db";
import { CHANNELS, HELD_BACK_DAY, INGREDIENTS, MENU, QP_UNSETTLED_FROM, SHELF, SUPPLIERS, generateDemo } from "./generate";

export const DEMO_NAME = "The Copper Table";

/** Remove every demo business (cascades to all its rows). Imported real businesses are untouched. */
export async function removeDemo() {
  await query(`delete from businesses where is_demo = true`);
}

/** Load the sample restaurant. With an owner, it replaces only that user's own sample and is added to their workspaces. */
export async function loadDemo(ownerUserId?: string): Promise<{ businessId: string; counts: Record<string, number> }> {
  const data = generateDemo();
  const held = (d: string) => d.slice(0, 10) >= HELD_BACK_DAY;
  const orders = data.orders.filter((o) => !held(o.at));
  const waste = data.waste.filter((w) => !held(w.date));
  const labour = data.labour.filter((l) => !held(l.date));

  return tx(async (t) => {
    if (ownerUserId) await t.query(`delete from businesses where is_demo = true and id in (select business_id from memberships where user_id = $1)`, [ownerUserId]);
    else await t.query(`delete from businesses where is_demo = true`);
    const bid = randomUUID();
    await t.query(
      `insert into businesses (id, name, location, vat_registered, vat_rate, prices_include_vat, is_demo) values ($1,$2,$3,true,20,true,true)`,
      [bid, DEMO_NAME, "Newcastle upon Tyne, UK"],
    );
    if (ownerUserId) await t.query(`insert into memberships (user_id, business_id, role) values ($1,$2,'owner')`, [ownerUserId, bid]);

    const srcIds: Record<string, string> = {};
    const sources: [string, string][] = [
      ["pos_sales", "POS sales export"], ["supplier_invoice", "Supplier invoices"], ["menu_recipes", "Menu & recipes"],
      ["delivery_settlement", "Delivery platform settlements"], ["waste", "Waste log"], ["labour", "Rota & labour"],
    ];
    sources.push(["supplier_orders", "Supplier order confirmations"]);
    for (const [kind, label] of sources) {
      srcIds[kind] = randomUUID();
      await t.query(`insert into data_sources (id, business_id, kind, label) values ($1,$2,$3,$4)`, [srcIds[kind], bid, kind, label]);
    }
    const fileIds: Record<string, string> = {};
    const seedFile = async (kind: string, name: string, count: number) => {
      const id = randomUUID();
      fileIds[kind] = id;
      await t.query(
        `insert into uploaded_files (id, business_id, data_source_id, source_type, file_name, mime_type, sha256, extraction_method, status, records_extracted, records_valid, records_imported, uploaded_at, confirmed_at)
         values ($1,$2,$3,$4,$5,'text/csv',$6,'demo_seed','imported',$7,$7,$7,'2026-10-31T08:00:00Z','2026-10-31T08:00:00Z')`,
        [id, bid, srcIds[kind], kind, name, createHash("sha256").update(`demo:${name}`).digest("hex"), count],
      );
    };

    // Suppliers & ingredients
    const supId = new Map<string, string>();
    for (const s of SUPPLIERS) {
      const id = randomUUID();
      supId.set(s.key, id);
      await t.query(`insert into suppliers (id, business_id, name, category) values ($1,$2,$3,$4)`, [id, bid, s.name, s.category]);
    }
    const ingId = new Map<string, string>();
    await bulkInsert(t, "ingredients", ["id", "business_id", "name", "category", "base_unit", "standard_cost", "shelf_life_days", "storage_area"], INGREDIENTS.map((i) => {
      const id = randomUUID();
      ingId.set(i.key, id);
      return [id, bid, i.name, i.category, i.baseUnit, i.standardCost, SHELF[i.key]?.[0] ?? null, SHELF[i.key]?.[1] ?? null];
    }));

    // Menu & recipes
    const menuId = new Map<string, string>();
    const menuByName = new Map<string, string>();
    await bulkInsert(t, "menu_items", ["id", "business_id", "name", "category", "price_gross", "delivery_price_gross", "packaging_cost", "packaging_is_estimate"], MENU.map((m) => {
      const id = randomUUID();
      menuId.set(m.key, id);
      menuByName.set(m.name, id);
      return [id, bid, m.name, m.category, m.price, m.deliveryPrice, m.packaging, true];
    }));
    const recipeRows: unknown[][] = [];
    const riRows: unknown[][] = [];
    for (const m of MENU) {
      if (!m.recipe) continue;
      const rid = randomUUID();
      recipeRows.push([rid, bid, menuId.get(m.key), 1]);
      for (const [ing, q, u] of m.recipe) riRows.push([randomUUID(), bid, rid, ingId.get(ing), q, u]);
    }
    await bulkInsert(t, "recipes", ["id", "business_id", "menu_item_id", "portions"], recipeRows);
    await bulkInsert(t, "recipe_ingredients", ["id", "business_id", "recipe_id", "ingredient_id", "quantity", "unit"], riRows);
    await seedFile("menu_recipes", "copper-table-menu-recipes.csv", riRows.length);

    // Channels
    const chId = new Map<string, string>();
    for (const c of CHANNELS) {
      const id = randomUUID();
      chId.set(c.key, id);
      await t.query(`insert into sales_channels (id, business_id, kind, name, platform, commission_rate) values ($1,$2,$3,$4,$5,$6)`, [id, bid, c.kind, c.name, c.platform, c.commissionRate]);
    }

    // Sales
    await seedFile("pos_sales", "pos-export-2026-09-01_2026-10-30.csv", orders.reduce((s, o) => s + o.lines.length, 0));
    const settled = orders.filter((o) => o.commission !== null && !(o.channel === "qp" && o.at.slice(0, 10) >= QP_UNSETTLED_FROM));
    await seedFile("delivery_settlement", "platform-settlements-sep-oct.csv", settled.length);
    const saleRows: unknown[][] = [];
    const itemRows: unknown[][] = [];
    const feeRows: unknown[][] = [];
    for (const o of orders) {
      const sid = randomUUID();
      saleRows.push([sid, bid, chId.get(o.channel), o.ref, o.at, o.gross, o.discount, o.refund, fileIds.pos_sales, "demo"]);
      for (const l of o.lines) itemRows.push([randomUUID(), bid, sid, menuByName.get(l.item), l.qty, l.unitPrice, l.gross, l.discount, l.refund]);
      if (o.commission !== null && !(o.channel === "qp" && o.at.slice(0, 10) >= QP_UNSETTLED_FROM)) {
        feeRows.push([randomUUID(), bid, sid, CHANNELS.find((c) => c.key === o.channel)!.platform, o.commission, o.otherFees, o.settlementRef, fileIds.delivery_settlement]);
      }
    }
    await bulkInsert(t, "sales", ["id", "business_id", "channel_id", "order_ref", "ordered_at", "gross_amount", "discount_amount", "refund_amount", "uploaded_file_id", "source"], saleRows);
    await bulkInsert(t, "sale_items", ["id", "business_id", "sale_id", "menu_item_id", "quantity", "unit_price_gross", "line_gross", "line_discount", "line_refund"], itemRows, 800);
    await bulkInsert(t, "delivery_fees", ["id", "business_id", "sale_id", "platform", "commission_amount", "other_fees", "settlement_ref", "uploaded_file_id"], feeRows);

    // Invoices
    await seedFile("supplier_invoice", "supplier-invoices-sep-oct (demo)", data.invoices.length);
    const lineRows: unknown[][] = [];
    for (const inv of data.invoices) {
      const iid = randomUUID();
      await t.query(
        `insert into supplier_invoices (id, business_id, supplier_id, invoice_number, invoice_date, subtotal, vat_amount, total, uploaded_file_id, source, order_ref) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'demo',$10)`,
        [iid, bid, supId.get(inv.supplier), inv.number, inv.date, inv.subtotal, inv.vat, inv.total, fileIds.supplier_invoice, inv.orderRef ?? null],
      );
      for (const l of inv.lines) lineRows.push([randomUUID(), bid, iid, ingId.get(l.ingredient), l.description, `${l.packs} × ${l.packLabel}`, l.quantity, l.unit, l.unitPrice, l.total]);
    }
    await bulkInsert(t, "supplier_invoice_lines", ["id", "business_id", "invoice_id", "ingredient_id", "description", "pack_description", "quantity", "unit", "unit_price", "line_total"], lineRows);

    // Supplier order confirmations
    await seedFile("supplier_orders", "supplier-order-emails-sep-oct (demo)", data.supplierOrders.length);
    const olRows: unknown[][] = [];
    for (const o of data.supplierOrders) {
      const oid = randomUUID();
      await t.query(
        `insert into supplier_orders (id, business_id, supplier_id, order_ref, status, ordered_on, delivery_date, note, uploaded_file_id, source) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'demo')`,
        [oid, bid, supId.get(o.supplier), o.ref, o.status, o.orderedOn, o.deliveryDate, o.note, fileIds.supplier_orders],
      );
      for (const l of o.lines) olRows.push([randomUUID(), bid, oid, ingId.get(l.ingredient), l.description, l.quantity, l.unit, l.unitPrice]);
    }
    await bulkInsert(t, "supplier_order_lines", ["id", "business_id", "order_id", "ingredient_id", "description", "quantity", "unit", "unit_price"], olRows);

    // Waste & labour
    await seedFile("waste", "waste-log-2026-09-01_2026-10-30.csv", waste.length);
    await bulkInsert(t, "waste_records", ["id", "business_id", "recorded_on", "ingredient_id", "menu_item_id", "description", "quantity", "unit", "reason", "uploaded_file_id"], waste.map((w) => [
      randomUUID(), bid, w.date, w.ingredient ? ingId.get(w.ingredient) : null, w.menuItem ? menuByName.get(w.menuItem) : null, w.description, w.quantity, w.unit, w.reason, fileIds.waste,
    ]));
    await seedFile("labour", "rota-hours-2026-09-01_2026-10-30.csv", labour.length);
    await bulkInsert(t, "labour_records", ["id", "business_id", "work_date", "role", "staff_ref", "hours", "hourly_rate", "cost", "uploaded_file_id"], labour.map((l) => [
      randomUUID(), bid, l.date, l.role, l.staffRef, l.hours, l.rate, Math.round(l.hours * l.rate * 10000) / 10000, fileIds.labour,
    ]));

    return { businessId: bid, counts: { orders: orders.length, saleItems: itemRows.length, invoices: data.invoices.length, invoiceLines: lineRows.length, supplierOrders: data.supplierOrders.length, waste: waste.length, labour: labour.length, settlements: feeRows.length } };
  });
}
