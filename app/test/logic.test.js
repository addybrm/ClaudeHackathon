import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { forecast } from "../lib/forecast.js";
import { compareLines, findEmail, receiptStatus } from "../lib/reconcile.js";
import { normalise } from "../lib/extract.js";
import { addDays, diffDays } from "../lib/dates.js";

const catalog = JSON.parse(fs.readFileSync(new URL("../data/catalog.json", import.meta.url)));
const { emails } = JSON.parse(fs.readFileSync(new URL("../data/emails.json", import.meta.url)));
const expected = (f) => JSON.parse(fs.readFileSync(new URL(`../samples/expected/${f}.json`, import.meta.url)));

const batch = (o) => ({ id: o.id, ingredient: "Basil", quantity: 8, unitPrice: 1, arrivalDate: "2026-11-04", expiryDate: "2026-11-08", ...o });

test("dates", () => {
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-03-28", 2), "2026-03-30"); // across a UK clock change
  assert.equal(diffDays("2026-11-07", "2026-11-04"), 3);
});

test("forecast: partial use before expiry gives waste", () => {
  // 8 packs, 1 per day, usable 4th..8th inclusive = 5 days -> 5 used, 3 wasted.
  const f = forecast([batch({ id: "a" })], () => 1, "2026-11-04").get("a");
  assert.equal(f.consumed, 5);
  assert.equal(f.pctUsedBeforeExpiry, 63);
  assert.equal(f.wasteQty, 3);
  assert.equal(f.wasteValue, 3);
  assert.equal(f.leftNow, 8);
});

test("forecast: past consumption reduces what's left now", () => {
  const f = forecast([batch({ id: "a", arrivalDate: "2026-11-02" })], () => 1, "2026-11-04").get("a");
  assert.equal(f.leftNow, 6); // used on the 2nd and 3rd
});

test("forecast: oldest expiry is used first; a new delivery can push an older batch to waste", () => {
  const old = batch({ id: "old", quantity: 6, arrivalDate: "2026-11-01", expiryDate: "2026-11-08" });
  const fresh = batch({ id: "new", quantity: 4, arrivalDate: "2026-11-03", expiryDate: "2026-11-06" });
  const f = forecast([old, fresh], () => 1, "2026-11-04");
  // 1st-2nd: only "old" has arrived. 3rd-6th: "new" expires first, so it's used first.
  // 7th-8th: back to "old", which then expires with 2 left.
  assert.equal(f.get("new").consumed, 4);
  assert.equal(f.get("old").consumed, 4);
  assert.equal(f.get("old").wasteQty, 2);
  assert.equal(f.get("old").leftNow, 4);
  assert.equal(f.get("new").leftNow, 3);
});

test("forecast: zero usage means nothing gets used", () => {
  const f = forecast([batch({ id: "a" })], () => 0, "2026-11-04").get("a");
  assert.equal(f.pctUsedBeforeExpiry, 0);
  assert.equal(f.wasteQty, 8);
});

test("forecast: incoming batch has nothing left now and isn't expired", () => {
  const f = forecast([batch({ id: "a", arrivalDate: "2026-11-06", expiryDate: "2026-11-10" })], () => 1, "2026-11-04").get("a");
  assert.equal(f.leftNow, 0);
  assert.equal(f.expired, false);
  assert.equal(f.consumed, 5);
});

test("findEmail matches by order reference, then supplier and date", () => {
  assert.equal(findEmail({ orderRef: "hsm 7730", supplier: "x", receiptDate: "2026-11-03" }, emails).email.id, "em-7730");
  const bySupplier = findEmail({ orderRef: "", supplier: "COLDHARBOUR FISH", receiptDate: "2026-11-04" }, emails);
  assert.equal(bySupplier.email.id, "em-3021");
  assert.equal(bySupplier.method, "supplier and date");
  assert.equal(findEmail({ orderRef: "PL-0558", supplier: "Pennine Larder Dry Goods", receiptDate: "2026-11-01" }, emails), null);
});

test("sample receipts reconcile as designed", () => {
  const check = (file) => {
    const ex = normalise(expected(file), catalog);
    const m = findEmail(ex, emails);
    const { lines, missingFromReceipt } = compareLines(ex.items, m?.email);
    return { status: receiptStatus(m?.email, lines, missingFromReceipt), lines, missingFromReceipt };
  };
  const dairy = check("brackenfield-dairy-receipt.png");
  assert.equal(dairy.status, "discrepancies");
  assert.deepEqual(dairy.lines.filter((l) => l.issues.length).map((l) => [l.ingredient, l.issues[0].code]), [["Double cream", "price_mismatch"]]);

  const meat = check("holystone-meats-receipt.png");
  assert.equal(meat.status, "discrepancies");
  assert.match(meat.lines[0].issues[0].text, /Short by 2 kg/);

  assert.equal(check("wansbeck-greens-photo.jpg").status, "verified");
  assert.equal(check("coldharbour-fish-receipt.png").status, "verified");
  assert.equal(check("pennine-larder-invoice.pdf").status, "unverified");
});

test("normalise flags lines whose maths doesn't add up and maps to catalog names", () => {
  const out = normalise(
    {
      supplier: "S", orderRef: "", receiptDate: "04/11/2026", currency: "GBP", total: 50, warnings: [],
      items: [
        { rawName: "CHKN", ingredient: "chicken breast", category: "other", quantity: 5, unit: "KG", unitPrice: 7.4, lineTotal: 74, expiryDate: "", confidence: "high", note: "" },
        { rawName: "?", ingredient: "", category: "dry", quantity: 1, unit: "each", unitPrice: 1, lineTotal: 1, expiryDate: "", confidence: "high", note: "" },
      ],
    },
    catalog,
  );
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].ingredient, "Chicken breast");
  assert.equal(out.items[0].category, "meat");
  assert.equal(out.items[0].unit, "kg");
  assert.equal(out.items[0].arithmetic, false);
  assert.equal(out.receiptDate, "");
  assert.ok(out.warnings.some((w) => /add up/.test(w)));
  assert.ok(out.warnings.some((w) => /date/.test(w)));
  const { lines } = compareLines(out.items, null);
  assert.equal(lines[0].issues[0].code, "arithmetic");
});
