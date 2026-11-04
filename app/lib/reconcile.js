// Checks a receipt Claude has read against the supplier's confirmation emails.

import { diffDays, isIsoDate } from "./dates.js";

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const SUPPLIER_NOISE = new Set(["ltd", "limited", "co", "company", "the", "and", "plc", "llp", "dry", "goods"]);

function supplierTokens(name) {
  return String(name ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !SUPPLIER_NOISE.has(t));
}

export function sameSupplier(a, b) {
  const ta = new Set(supplierTokens(a));
  return supplierTokens(b).some((t) => ta.has(t));
}

/** Finds the order email a receipt belongs to: by order reference first, then supplier + date. */
export function findEmail(extraction, emails) {
  const orders = emails.filter((e) => Array.isArray(e.items) && e.items.length);
  const ref = norm(extraction.orderRef);
  if (ref) {
    const hit = orders.find((e) => norm(e.orderRef) === ref);
    if (hit) return { email: hit, method: "order reference" };
  }
  if (!isIsoDate(extraction.receiptDate)) return null;
  const candidates = orders.filter(
    (e) =>
      sameSupplier(e.fromName, extraction.supplier) &&
      isIsoDate(e.deliveryDate) &&
      Math.abs(diffDays(e.deliveryDate, extraction.receiptDate)) <= 2,
  );
  if (candidates.length === 1) return { email: candidates[0], method: "supplier and date" };
  return null;
}

/**
 * Compares receipt lines with the email's order lines.
 * Each receipt line gets `issues` (empty = verified). Email lines that never appear on
 * the receipt are returned in `missingFromReceipt`.
 */
export function compareLines(items, email) {
  const remaining = email ? [...email.items] : [];
  const lines = items.map((item) => {
    const issues = [];
    if (item.confidence === "low") issues.push({ code: "low_confidence", text: "Claude wasn't sure it read this line correctly" });
    if (item.arithmetic === false) issues.push({ code: "arithmetic", text: "Quantity × price doesn't match the line total" });
    if (!email) return { ...item, issues, emailQty: null, emailPrice: null };

    const idx = remaining.findIndex((e) => norm(e.ingredient) === norm(item.ingredient));
    if (idx === -1) {
      issues.push({ code: "not_on_order", text: "Not on the confirmation email" });
      return { ...item, issues, emailQty: null, emailPrice: null };
    }
    const [match] = remaining.splice(idx, 1);
    if (norm(match.unit) !== norm(item.unit)) {
      issues.push({ code: "unit_mismatch", text: `Email says ${match.quantity} ${match.unit}, receipt says ${item.quantity} ${item.unit}` });
    } else if (Math.abs(match.quantity - item.quantity) > Math.max(0.005 * match.quantity, 0.001)) {
      const diff = round(item.quantity - match.quantity);
      issues.push({
        code: "qty_mismatch",
        text: `${diff < 0 ? "Short" : "Over"} by ${Math.abs(diff)} ${item.unit}: ordered ${match.quantity}, received ${item.quantity}`,
      });
    }
    if (Math.abs(match.unitPrice - item.unitPrice) > 0.005) {
      const diff = round((item.unitPrice - match.unitPrice) * item.quantity, 2);
      issues.push({
        code: "price_mismatch",
        text: `Charged £${item.unitPrice.toFixed(2)}/${item.unit}, email says £${match.unitPrice.toFixed(2)} (${diff > 0 ? "+" : ""}£${diff.toFixed(2)} overall)`,
      });
    }
    return { ...item, issues, emailQty: match.quantity, emailPrice: match.unitPrice };
  });
  return { lines, missingFromReceipt: remaining };
}

export function receiptStatus(email, lines, missingFromReceipt) {
  if (!email) return "unverified";
  if (missingFromReceipt.length || lines.some((l) => l.issues.length)) return "discrepancies";
  return "verified";
}

function round(x, dp = 3) {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
