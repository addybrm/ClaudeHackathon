/**
 * Supplier order checks and the stock & expiry forecast, backed by the database.
 * The algorithms (reconcile.ts, stock.ts) were adapted from the LarderCheck prototype.
 */
import { num, query } from "@/lib/db";
import type { BusinessCtx } from "./engine";
import { ingredientUsage, loadPeriod } from "./engine";
import type { Period } from "./period";
import { checkStatus, compareLines, findOrder, type CheckStatus, type CheckedLine, type Order, type OrderLine } from "./reconcile";
import { addDays, diffDays, forecast, type Batch } from "./stock";

// ---------------------------------------------------------------------------
// Supplier order checks
// ---------------------------------------------------------------------------

export async function loadOrders(b: BusinessCtx, from: string, to: string): Promise<Order[]> {
  const rows = await query<Record<string, unknown>>(
    `select o.id, o.order_ref, o.status, o.delivery_date::text as delivery_date, s.name as supplier,
       l.ingredient_id, l.description, l.quantity, l.unit, l.unit_price
     from supplier_orders o join suppliers s on s.id = o.supplier_id left join supplier_order_lines l on l.order_id = o.id
     where o.business_id = $1 and o.delivery_date >= ($2::date - 3) and o.delivery_date < ($3::date + 3)
     order by o.delivery_date`,
    [b.id, from, to],
  );
  const byId = new Map<string, Order>();
  for (const r of rows) {
    const id = r.id as string;
    const o = byId.get(id) ?? { id, orderRef: r.order_ref as string, supplier: r.supplier as string, deliveryDate: r.delivery_date as string, status: r.status as string, lines: [] as OrderLine[] };
    if (r.description) o.lines.push({ key: (r.ingredient_id as string) ?? `d:${r.description}`, description: r.description as string, quantity: num(r.quantity), unit: r.unit as string, unitPrice: num(r.unit_price) });
    byId.set(id, o);
  }
  return [...byId.values()];
}

export interface InvoiceCheck {
  invoiceId: string;
  invoiceNumber: string;
  supplier: string;
  date: string;
  orderRef: string | null;
  matchedOrder: string | null;
  method: string | null;
  status: CheckStatus;
  atStake: number;
  lines: CheckedLine[];
  missingFromInvoice: OrderLine[];
}

export async function invoiceChecks(b: BusinessCtx, from: string, to: string): Promise<{ checks: InvoiceCheck[]; summary: { invoices: number; verified: number; discrepancies: number; noOrder: number; atStake: number; byCode: Record<string, { count: number; atStake: number }> } }> {
  const [orders, rows] = await Promise.all([
    loadOrders(b, from, to),
    query<Record<string, unknown>>(
      `select i.id, i.invoice_number, i.invoice_date::text as date, i.order_ref, s.name as supplier,
         l.ingredient_id, l.description, l.quantity, l.unit, l.unit_price, l.line_total
       from supplier_invoices i join suppliers s on s.id = i.supplier_id join supplier_invoice_lines l on l.invoice_id = i.id
       where i.business_id = $1 and i.invoice_date >= $2 and i.invoice_date < $3 order by i.invoice_date, s.name`,
      [b.id, from, to],
    ),
  ]);
  const invs = new Map<string, { id: string; number: string; date: string; orderRef: string | null; supplier: string; lines: { key: string | null; description: string; quantity: number; unit: string; unitPrice: number; lineTotal: number }[] }>();
  for (const r of rows) {
    const id = r.id as string;
    const e = invs.get(id) ?? { id, number: r.invoice_number as string, date: r.date as string, orderRef: (r.order_ref as string) ?? null, supplier: r.supplier as string, lines: [] };
    e.lines.push({ key: (r.ingredient_id as string) ?? null, description: r.description as string, quantity: num(r.quantity), unit: r.unit as string, unitPrice: num(r.unit_price), lineTotal: num(r.line_total) });
    invs.set(id, e);
  }
  const checks: InvoiceCheck[] = [];
  for (const inv of invs.values()) {
    const m = findOrder({ orderRef: inv.orderRef, supplier: inv.supplier, date: inv.date }, orders);
    const cmp = compareLines(inv.lines, m?.order ?? null);
    checks.push({
      invoiceId: inv.id, invoiceNumber: inv.number, supplier: inv.supplier, date: inv.date, orderRef: inv.orderRef,
      matchedOrder: m?.order.orderRef ?? null, method: m?.method ?? null, status: checkStatus(m?.order ?? null, cmp.lines, cmp.missingFromInvoice),
      atStake: cmp.atStake, lines: cmp.lines, missingFromInvoice: cmp.missingFromInvoice,
    });
  }
  const byCode: Record<string, { count: number; atStake: number }> = {};
  for (const c of checks) for (const l of c.lines) for (const i of l.issues) {
    const e = (byCode[i.code] ??= { count: 0, atStake: 0 });
    e.count++;
    e.atStake += i.atStake;
  }
  return {
    checks,
    summary: {
      invoices: checks.length,
      verified: checks.filter((c) => c.status === "verified").length,
      discrepancies: checks.filter((c) => c.status === "discrepancies").length,
      noOrder: checks.filter((c) => c.status === "no_order").length,
      atStake: checks.reduce((s, c) => s + c.atStake, 0),
      byCode,
    },
  };
}

// ---------------------------------------------------------------------------
// Stock & expiry forecast
// ---------------------------------------------------------------------------

export interface StockRow {
  ingredientId: string;
  ingredient: string;
  storage: string;
  baseUnit: string;
  shelfLifeDays: number;
  dailyUse: number;
  onHand: number;
  stockValue: number;
  daysCover: number | null;
  nextExpiry: string | null;
  atRiskQty: number; // in stock now, modelled to expire unused
  atRiskValue: number;
  expiredLast30Value: number; // modelled expiry losses in the 30 days to asOf
  typicalDeliveryDays: number | null; // average delivery size in days of use
  latestDelivery: { date: string; quantity: number; pctUsedBeforeExpiry: number; wasteValue: number; expiryDate: string; printedExpiry: boolean } | null;
}

/** Latest date with sales — the forecast's "today" (the data's present). */
export async function dataAsOf(b: BusinessCtx): Promise<string | null> {
  const r = await query<{ d: string | null }>(`select max(ordered_at)::date::text as d from sales where business_id = $1`, [b.id]);
  return r[0]?.d ?? null;
}

export async function stockForecast(b: BusinessCtx, asOfIn?: string) {
  const asOf = asOfIn ?? (await dataAsOf(b));
  if (!asOf) return null;
  // Daily use = theoretical usage (recipes × units sold) over the 28 days to asOf. Only deliveries from
  // the last ~5 weeks are simulated, so one usage rate is applied to a period where it actually held.
  const windowStart = addDays(asOf, -27);
  const win: Period = { key: "window", label: `28 days to ${asOf}`, short: "28d", start: windowStart, end: addDays(asOf, 1), days: 28 };
  const m = await loadPeriod(b, win);
  const usage = ingredientUsage(m);
  const lines = await query<Record<string, unknown>>(
    `select l.id, l.ingredient_id, ing.name, ing.base_unit, ing.shelf_life_days, ing.storage_area, l.quantity, l.unit_price,
       i.invoice_date::text as arrival, l.expiry_date::text as printed_expiry
     from supplier_invoice_lines l join supplier_invoices i on i.id = l.invoice_id join ingredients ing on ing.id = l.ingredient_id
     where l.business_id = $1 and ing.shelf_life_days is not null and i.invoice_date <= $2 and i.invoice_date >= ($2::date - 34)`,
    [b.id, asOf],
  );
  const batches: (Batch & { ingredientId: string; printed: boolean })[] = lines.map((r) => {
    const arrival = r.arrival as string;
    const printed = r.printed_expiry as string | null;
    return {
      id: r.id as string, ingredientId: r.ingredient_id as string, ingredient: r.name as string, quantity: num(r.quantity), unitPrice: num(r.unit_price),
      arrivalDate: arrival, expiryDate: printed ?? addDays(arrival, num(r.shelf_life_days)), printed: !!printed,
    };
  });
  const meta = new Map(lines.map((r) => [r.ingredient_id as string, { name: r.name as string, unit: r.base_unit as string, shelf: num(r.shelf_life_days), storage: (r.storage_area as string) ?? "—" }]));
  const nameToId = new Map(lines.map((r) => [(r.name as string).toLowerCase(), r.ingredient_id as string]));
  const dailyUse = (name: string) => (usage.get(nameToId.get(name.toLowerCase()) ?? "") ?? 0) / 28;
  const f = forecast(batches, dailyUse, asOf);

  const rows: StockRow[] = [];
  for (const [id, mt] of meta) {
    const bs = batches.filter((x) => x.ingredientId === id).sort((a, z) => a.arrivalDate.localeCompare(z.arrivalDate));
    const du = dailyUse(mt.name);
    let onHand = 0, value = 0, atRiskQty = 0, atRiskValue = 0, expired30 = 0;
    let nextExpiry: string | null = null;
    for (const x of bs) {
      const r = f.get(x.id)!;
      if (!r.expired && x.arrivalDate <= asOf && r.leftNow > 0) {
        onHand += r.leftNow;
        value += r.leftNow * x.unitPrice;
        if (!nextExpiry || x.expiryDate < nextExpiry) nextExpiry = x.expiryDate;
        atRiskQty += r.wasteQty;
        atRiskValue += r.wasteValue;
      }
      if (r.expired && diffDays(asOf, x.expiryDate) <= 30) expired30 += r.wasteValue;
    }
    const last = bs[bs.length - 1];
    const lr = last ? f.get(last.id)! : null;
    const avgDelivery = bs.length ? bs.reduce((s, x) => s + x.quantity, 0) / bs.length : 0;
    rows.push({
      ingredientId: id, ingredient: mt.name, storage: mt.storage, baseUnit: mt.unit, shelfLifeDays: mt.shelf, dailyUse: du,
      onHand, stockValue: value, daysCover: du > 0 ? onHand / du : null, nextExpiry, atRiskQty, atRiskValue, expiredLast30Value: expired30,
      typicalDeliveryDays: du > 0 && avgDelivery ? avgDelivery / du : null,
      latestDelivery: last && lr ? { date: last.arrivalDate, quantity: last.quantity, pctUsedBeforeExpiry: lr.pctUsedBeforeExpiry, wasteValue: lr.wasteValue, expiryDate: last.expiryDate, printedExpiry: last.printed } : null,
    });
  }
  rows.sort((a, z) => z.atRiskValue + z.expiredLast30Value - (a.atRiskValue + a.expiredLast30Value));
  return {
    asOf,
    rows,
    totals: {
      stockValue: rows.reduce((s, r) => s + r.stockValue, 0),
      atRiskValue: rows.reduce((s, r) => s + r.atRiskValue, 0),
      expiredLast30Value: rows.reduce((s, r) => s + r.expiredLast30Value, 0),
      expiringIn3Days: rows.filter((r) => r.nextExpiry && diffDays(r.nextExpiry, asOf) <= 3).length,
    },
    // Ingredients whose deliveries are bigger than what can be used within shelf life.
    overOrdered: rows.filter((r) => r.typicalDeliveryDays !== null && r.typicalDeliveryDays > r.shelfLifeDays && r.expiredLast30Value + r.atRiskValue > 5),
  };
}
