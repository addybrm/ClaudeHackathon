/**
 * Invoice ↔ supplier order checks — adapted from the LarderCheck prototype (lib/reconcile.js, by addybrm).
 *
 * An invoice is matched to its order confirmation by order reference, then by supplier and a
 * delivery date within 2 days. Lines are compared on ingredient, quantity and agreed price.
 * MarginOS adds the £ at stake for each discrepancy, because overcharges are profit leaks.
 */
import { diffDays, isIsoDate } from "./stock";

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const NOISE = new Set(["ltd", "limited", "co", "company", "the", "and", "plc", "llp", "supplies", "catering"]);
const tokens = (name: string) => name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !NOISE.has(t));

export function sameSupplier(a: string, b: string) {
  const ta = new Set(tokens(a));
  return tokens(b).some((t) => ta.has(t));
}

export interface OrderLine { key: string; description: string; quantity: number; unit: string; unitPrice: number }
export interface Order { id: string; orderRef: string; supplier: string; deliveryDate: string; status: string; lines: OrderLine[] }
export interface InvoiceLineIn { key: string | null; description: string; quantity: number; unit: string; unitPrice: number; lineTotal: number }

export function findOrder(inv: { orderRef: string | null; supplier: string; date: string | null }, orders: Order[]): { order: Order; method: "order reference" | "supplier and date" } | null {
  const ref = norm(inv.orderRef);
  if (ref) {
    const hit = orders.find((o) => norm(o.orderRef) === ref);
    if (hit) return { order: hit, method: "order reference" };
  }
  if (!isIsoDate(inv.date)) return null;
  const cands = orders.filter((o) => sameSupplier(o.supplier, inv.supplier) && Math.abs(diffDays(o.deliveryDate, inv.date!)) <= 2);
  return cands.length === 1 ? { order: cands[0], method: "supplier and date" } : null;
}

export type IssueCode = "price_mismatch" | "billed_over_order" | "short_delivery" | "not_on_order" | "unit_mismatch";
export interface LineIssue { code: IssueCode; text: string; atStake: number } // atStake > 0 = money you may be owed

export interface CheckedLine extends InvoiceLineIn { issues: LineIssue[]; orderQty: number | null; orderPrice: number | null }

export function compareLines(lines: InvoiceLineIn[], order: Order | null): { lines: CheckedLine[]; missingFromInvoice: OrderLine[]; atStake: number } {
  const remaining = order ? [...order.lines] : [];
  const out: CheckedLine[] = lines.map((l) => {
    const issues: LineIssue[] = [];
    if (!order) return { ...l, issues, orderQty: null, orderPrice: null };
    const idx = remaining.findIndex((o) => (l.key && o.key === l.key) || norm(o.description) === norm(l.description));
    if (idx === -1) {
      issues.push({ code: "not_on_order", text: `Not on order ${order.orderRef}`, atStake: l.lineTotal });
      return { ...l, issues, orderQty: null, orderPrice: null };
    }
    const [m] = remaining.splice(idx, 1);
    if (norm(m.unit) !== norm(l.unit)) {
      issues.push({ code: "unit_mismatch", text: `Order says ${m.quantity} ${m.unit}, invoice says ${l.quantity} ${l.unit}`, atStake: 0 });
    } else {
      const dq = l.quantity - m.quantity;
      if (dq > Math.max(0.005 * m.quantity, 0.001)) issues.push({ code: "billed_over_order", text: `Billed ${round(dq)} ${l.unit} more than ordered (${m.quantity} ordered, ${l.quantity} billed)`, atStake: round(dq * l.unitPrice, 2) });
      else if (dq < -Math.max(0.005 * m.quantity, 0.001)) issues.push({ code: "short_delivery", text: `Short by ${round(-dq)} ${l.unit}: ordered ${m.quantity}, billed ${l.quantity}`, atStake: 0 });
    }
    if (Math.abs(m.unitPrice - l.unitPrice) > 0.005) {
      const diff = round((l.unitPrice - m.unitPrice) * Math.min(l.quantity, m.quantity), 2);
      issues.push({ code: "price_mismatch", text: `Charged £${l.unitPrice.toFixed(2)}/${l.unit}, agreed £${m.unitPrice.toFixed(2)} (${diff > 0 ? "+" : ""}£${diff.toFixed(2)})`, atStake: Math.max(0, diff) });
    }
    return { ...l, issues, orderQty: m.quantity, orderPrice: m.unitPrice };
  });
  const atStake = round(out.reduce((s, l) => s + l.issues.reduce((x, i) => x + i.atStake, 0), 0), 2);
  return { lines: out, missingFromInvoice: remaining, atStake };
}

export type CheckStatus = "verified" | "discrepancies" | "no_order";
export function checkStatus(order: Order | null, lines: CheckedLine[], missing: OrderLine[]): CheckStatus {
  if (!order) return "no_order";
  return missing.length || lines.some((l) => l.issues.length) ? "discrepancies" : "verified";
}

function round(x: number, dp = 3) {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
