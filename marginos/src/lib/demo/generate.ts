/**
 * DEMO DATA — "The Copper Table", a FICTIONAL independent restaurant in Newcastle upon Tyne.
 * All suppliers, platforms, people and figures are invented for demonstration.
 *
 * The generator is deterministic (seeded PRNG) so every load produces identical data.
 * Built-in storyline for September → October 2026:
 *   • Tyne Valley Meats raises chicken prices (breast £5.20 → £6.10/kg from 6 Oct).
 *   • Frying oil rises £28.50 → £34.80 per 20 L at Quayside Cash & Carry.
 *   • A restaurant-funded "25% off" FeastFleet promotion (plus a 4% "Boost" placement fee) lifts delivery volume.
 *   • Recorded waste rises (chicken spoilage, over-production during delivery peaks).
 *   • An extra delivery packer shift is added Thursday–Sunday.
 * The 31 October exports (POS, waste, rota) and the late QuickPlate settlement are NOT
 * seeded — they are offered as sample files in the Data Centre to demonstrate importing.
 */

export const DEMO_START = "2026-09-01";
export const DEMO_END = "2026-11-01"; // exclusive
export const HELD_BACK_DAY = "2026-10-31"; // exported as sample CSVs instead of seeded
export const QP_UNSETTLED_FROM = "2026-10-26"; // QuickPlate settlement for 26–31 Oct not yet received

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DemoSupplier { key: string; name: string; category: string }
export interface DemoIngredient {
  key: string; name: string; category: string; baseUnit: "kg" | "l" | "each";
  supplier: string; packSize: number; packLabel: string;
  priceSep: number; priceOct: number; standardCost: number | null; vatable: boolean; invoiced: boolean;
}
export interface DemoMenuItem {
  key: string; name: string; category: string; price: number; deliveryPrice: number | null; packaging: number;
  recipe: [string, number, string][] | null;
}

export const SUPPLIERS: DemoSupplier[] = [
  { key: "tvm", name: "Tyne Valley Meats", category: "Butcher" },
  { key: "nsf", name: "North Shields Fish Co", category: "Fishmonger" },
  { key: "nfp", name: "Northumbria Fresh Produce", category: "Greengrocer" },
  { key: "qcc", name: "Quayside Cash & Carry", category: "Wholesale" },
  { key: "ocs", name: "Ouseburn Catering Supplies", category: "Wholesale" },
];

const I = (key: string, name: string, category: string, baseUnit: "kg" | "l" | "each", supplier: string, packSize: number, packLabel: string, priceSep: number, priceOct = priceSep, opts: Partial<Pick<DemoIngredient, "standardCost" | "vatable" | "invoiced">> = {}): DemoIngredient => ({
  key, name, category, baseUnit, supplier, packSize, packLabel, priceSep, priceOct, standardCost: opts.standardCost ?? null, vatable: opts.vatable ?? false, invoiced: opts.invoiced ?? true,
});

export const INGREDIENTS: DemoIngredient[] = [
  I("chicken_breast", "Chicken breast fillet", "Meat", "kg", "tvm", 5, "5kg case", 5.2, 6.1),
  I("chicken_thigh", "Chicken thigh, boneless", "Meat", "kg", "tvm", 5, "5kg case", 4.1, 4.75),
  I("chicken_wings", "Chicken wings", "Meat", "kg", "tvm", 5, "5kg case", 3.4, 3.65),
  I("beef_mince", "Beef mince 15%", "Meat", "kg", "tvm", 5, "5kg pack", 8.6, 8.75),
  I("rump_steak", "Rump steak", "Meat", "kg", "tvm", 2, "2kg pack", 19.5),
  I("lamb_mince", "Lamb mince", "Meat", "kg", "tvm", 2.5, "2.5kg pack", 10.4),
  I("bacon", "Smoked streaky bacon", "Meat", "kg", "tvm", 2, "2kg pack", 8.9),
  I("haddock", "Haddock fillet", "Fish", "kg", "nsf", 2, "2kg pack", 16.8, 17.2),
  I("potatoes", "Maris Piper potatoes", "Produce", "kg", "nfp", 25, "25kg sack", 0.62, 0.64),
  I("lettuce", "Romaine lettuce", "Produce", "each", "nfp", 12, "box of 12", 0.85),
  I("tomatoes", "Vine tomatoes", "Produce", "kg", "nfp", 6, "6kg tray", 2.1, 2.3),
  I("red_onion", "Red onions", "Produce", "kg", "nfp", 10, "10kg sack", 0.95),
  I("onions", "Large white onions", "Produce", "kg", "nfp", 10, "10kg sack", 0.82),
  I("mushrooms", "Chestnut mushrooms", "Produce", "kg", "nfp", 2.5, "2.5kg box", 3.8),
  I("lemons", "Lemons", "Produce", "each", "nfp", 40, "box of 40", 0.22),
  I("salad_leaves", "Mixed salad leaves", "Produce", "kg", "nfp", 1, "1kg bag", 7.5),
  I("oil", "Rapeseed frying oil", "Dry goods", "l", "qcc", 20, "20L drum", 1.425, 1.74),
  I("buns", "Brioche burger buns", "Bakery", "each", "qcc", 48, "case of 48", 0.46, 0.49),
  I("flatbread", "Flatbreads", "Bakery", "each", "qcc", 30, "pack of 30", 0.38),
  I("cheddar", "Mature cheddar slices", "Dairy", "kg", "qcc", 1, "1kg pack", 9.4),
  I("halloumi", "Halloumi", "Dairy", "kg", "qcc", 1, "1kg block", 11.8, 11.2),
  I("parmesan", "Parmesan", "Dairy", "kg", "qcc", 1, "1kg wedge", 17.5),
  I("buttermilk", "Buttermilk", "Dairy", "l", "qcc", 2, "2L bottle", 1.6),
  I("cream", "Double cream", "Dairy", "l", "qcc", 2, "2L tub", 3.4),
  I("butter", "Unsalted butter", "Dairy", "kg", "qcc", 2, "2kg block", 6.8),
  I("eggs", "Free-range eggs", "Dairy", "each", "qcc", 180, "tray of 180", 0.24),
  I("rice", "Arborio rice", "Dry goods", "kg", "qcc", 5, "5kg bag", 2.4),
  I("flour", "Plain flour", "Dry goods", "kg", "qcc", 16, "16kg sack", 0.75),
  I("panko", "Panko breadcrumbs", "Dry goods", "kg", "qcc", 2, "2kg bag", 3.1),
  I("batter_mix", "Beer batter mix", "Dry goods", "kg", "qcc", 3.5, "3.5kg tub", 2.9),
  I("mayo", "Mayonnaise", "Sauces", "l", "qcc", 5, "5L tub", 4.2),
  I("hot_sauce", "Hot sauce", "Sauces", "l", "qcc", 1, "1L bottle", 6.5),
  I("harissa", "Harissa paste", "Sauces", "kg", "qcc", 1, "1kg tub", 7.8),
  I("garnish", "Pickles, slaw & garnish (prepared)", "Prepared", "kg", "qcc", 5, "5kg tub", 6.8),
  I("stock", "Vegetable stock", "Dry goods", "l", "qcc", 10, "10L (from concentrate)", 0.55),
  I("cola", "Cola 330ml can", "Drinks", "each", "qcc", 24, "case of 24", 0.52, 0.52, { vatable: true }),
  I("lager", "Craft lager (keg)", "Drinks", "l", "qcc", 30, "30L keg", 3.4, 3.4, { vatable: true }),
  I("stp", "Sticky toffee pudding portion", "Desserts", "each", "qcc", 24, "box of 24", 1.45),
  I("brownie", "Chocolate brownie portion", "Desserts", "each", "qcc", 24, "box of 24", 1.25),
  I("ice_cream", "Vanilla ice cream", "Desserts", "l", "qcc", 4, "4L tub", 4.2),
  I("truffle_oil", "Truffle oil", "Dry goods", "l", "qcc", 0.25, "250ml bottle", 38, 38, { standardCost: 38, invoiced: false }),
];

export const MENU: DemoMenuItem[] = [
  { key: "chicken_burger", name: "Buttermilk Fried Chicken Burger", category: "Mains", price: 14.5, deliveryPrice: 16.5, packaging: 0.62,
    recipe: [["chicken_breast", 220, "g"], ["buttermilk", 60, "ml"], ["flour", 45, "g"], ["oil", 140, "ml"], ["buns", 1, "each"], ["lettuce", 0.1, "each"], ["mayo", 30, "ml"], ["hot_sauce", 12, "ml"], ["cheddar", 25, "g"], ["garnish", 60, "g"], ["potatoes", 380, "g"]] },
  { key: "schnitzel", name: "Chicken Schnitzel & Fries", category: "Mains", price: 16, deliveryPrice: 18, packaging: 0.62,
    recipe: [["chicken_breast", 220, "g"], ["panko", 50, "g"], ["eggs", 1, "each"], ["flour", 30, "g"], ["oil", 150, "ml"], ["lemons", 0.5, "each"], ["salad_leaves", 40, "g"], ["garnish", 50, "g"], ["potatoes", 380, "g"]] },
  { key: "caesar", name: "Grilled Chicken Caesar", category: "Mains", price: 13.5, deliveryPrice: 15, packaging: 0.48,
    recipe: [["chicken_thigh", 180, "g"], ["lettuce", 0.75, "each"], ["parmesan", 25, "g"], ["bacon", 40, "g"], ["eggs", 1, "each"], ["mayo", 40, "ml"], ["flatbread", 0.5, "each"], ["lemons", 0.25, "each"]] },
  { key: "wings", name: "Hot Honey Chicken Wings (8)", category: "Small plates", price: 9.5, deliveryPrice: 11, packaging: 0.45,
    recipe: [["chicken_wings", 400, "g"], ["flour", 30, "g"], ["oil", 120, "ml"], ["hot_sauce", 35, "ml"], ["garnish", 30, "g"]] },
  { key: "beef_burger", name: "Copper Beef Burger", category: "Mains", price: 15, deliveryPrice: 17, packaging: 0.62,
    recipe: [["beef_mince", 200, "g"], ["buns", 1, "each"], ["cheddar", 30, "g"], ["bacon", 30, "g"], ["lettuce", 0.1, "each"], ["tomatoes", 30, "g"], ["red_onion", 20, "g"], ["mayo", 25, "ml"], ["garnish", 60, "g"], ["potatoes", 380, "g"], ["oil", 90, "ml"]] },
  { key: "steak", name: "8oz Rump Steak Frites", category: "Mains", price: 24, deliveryPrice: 26.5, packaging: 0.7,
    recipe: [["rump_steak", 250, "g"], ["butter", 25, "g"], ["salad_leaves", 40, "g"], ["tomatoes", 40, "g"], ["garnish", 40, "g"], ["potatoes", 400, "g"], ["oil", 100, "ml"]] },
  { key: "haddock", name: "Beer-Battered Haddock & Chips", category: "Mains", price: 17.5, deliveryPrice: 19.5, packaging: 0.66,
    recipe: [["haddock", 220, "g"], ["batter_mix", 70, "g"], ["oil", 170, "ml"], ["lemons", 0.5, "each"], ["garnish", 80, "g"], ["potatoes", 420, "g"]] },
  { key: "halloumi", name: "Halloumi & Harissa Burger (V)", category: "Mains", price: 13.5, deliveryPrice: 15.5, packaging: 0.62,
    recipe: [["halloumi", 130, "g"], ["harissa", 20, "g"], ["buns", 1, "each"], ["lettuce", 0.1, "each"], ["tomatoes", 30, "g"], ["red_onion", 20, "g"], ["mayo", 25, "ml"], ["garnish", 50, "g"], ["potatoes", 380, "g"], ["oil", 90, "ml"]] },
  { key: "risotto", name: "Mushroom & Truffle Risotto (V)", category: "Mains", price: 15.5, deliveryPrice: 17.5, packaging: 0.52,
    recipe: [["rice", 110, "g"], ["mushrooms", 160, "g"], ["parmesan", 30, "g"], ["butter", 25, "g"], ["cream", 40, "ml"], ["onions", 40, "g"], ["stock", 350, "ml"], ["truffle_oil", 5, "ml"]] },
  { key: "kofta", name: "Lamb Kofta Flatbread", category: "Mains", price: 14, deliveryPrice: 16, packaging: 0.55,
    recipe: [["lamb_mince", 180, "g"], ["flatbread", 1, "each"], ["red_onion", 30, "g"], ["tomatoes", 40, "g"], ["salad_leaves", 30, "g"], ["harissa", 15, "g"], ["garnish", 70, "g"], ["lemons", 0.25, "each"]] },
  { key: "loaded_fries", name: "Loaded Chicken Fries", category: "Sides", price: 8.5, deliveryPrice: 10, packaging: 0.4,
    recipe: [["potatoes", 380, "g"], ["oil", 110, "ml"], ["chicken_thigh", 90, "g"], ["cheddar", 40, "g"], ["hot_sauce", 15, "ml"], ["mayo", 20, "ml"]] },
  { key: "fries", name: "Skin-on Fries", category: "Sides", price: 4.5, deliveryPrice: 5.5, packaging: 0.25,
    recipe: [["potatoes", 380, "g"], ["oil", 100, "ml"]] },
  { key: "onion_rings", name: "Beer-Battered Onion Rings", category: "Sides", price: 4.5, deliveryPrice: 5.5, packaging: 0.25,
    recipe: [["onions", 180, "g"], ["batter_mix", 60, "g"], ["oil", 110, "ml"]] },
  { key: "stp", name: "Sticky Toffee Pudding", category: "Desserts", price: 7, deliveryPrice: 8, packaging: 0.35,
    recipe: [["stp", 1, "each"], ["ice_cream", 70, "ml"], ["cream", 30, "ml"]] },
  { key: "brownie", name: "Chocolate Brownie", category: "Desserts", price: 6.5, deliveryPrice: 7.5, packaging: 0.35,
    recipe: [["brownie", 1, "each"], ["ice_cream", 70, "ml"]] },
  { key: "soft_drink", name: "Soft Drink (330ml)", category: "Drinks", price: 3, deliveryPrice: 3.5, packaging: 0,
    recipe: [["cola", 1, "each"]] },
  { key: "lager", name: "Craft Lager (pint)", category: "Drinks", price: 5.8, deliveryPrice: null, packaging: 0,
    recipe: [["lager", 0.568, "l"]] },
  { key: "special", name: "Chef's Seasonal Special", category: "Mains", price: 18, deliveryPrice: null, packaging: 0,
    recipe: null }, // deliberately has no recipe: demonstrates missing-cost handling
];

/** Recipe that the sample menu CSV adds for the seasonal special (venison is not otherwise stocked). */
export const SPECIAL_RECIPE_CSV: [string, number, string][] = [["rump_steak", 200, "g"], ["mushrooms", 80, "g"], ["butter", 20, "g"], ["potatoes", 250, "g"], ["cream", 40, "ml"]];

export const CHANNELS = [
  { key: "dine_in", kind: "dine_in" as const, name: "Dine-in", platform: null, commissionRate: null },
  { key: "collection", kind: "collection" as const, name: "Collection", platform: null, commissionRate: null },
  { key: "ff", kind: "delivery" as const, name: "FeastFleet", platform: "FeastFleet", commissionRate: 0.3 },
  { key: "qp", kind: "delivery" as const, name: "QuickPlate", platform: "QuickPlate", commissionRate: 0.25 },
];

export interface DemoOrderLine { item: string; qty: number; unitPrice: number; gross: number; discount: number; refund: number }
export interface DemoOrder { ref: string; channel: string; at: string; gross: number; discount: number; refund: number; lines: DemoOrderLine[]; commission: number | null; otherFees: number; settlementRef: string | null }
export interface DemoInvoice { supplier: string; number: string; date: string; lines: { ingredient: string; description: string; packs: number; packLabel: string; quantity: number; unit: string; unitPrice: number; total: number; vatable: boolean }[]; subtotal: number; vat: number; total: number; orderRef?: string | null }
export interface DemoSupplierOrder { ref: string; supplier: string; orderedOn: string; deliveryDate: string; status: "confirmed" | "dispatched" | "delivered"; note: string | null; lines: { ingredient: string; description: string; quantity: number; unit: string; unitPrice: number }[] }
export interface DemoWaste { date: string; ingredient: string | null; menuItem: string | null; quantity: number; unit: string; reason: string; description: string }
export interface DemoLabour { date: string; role: string; staffRef: string; hours: number; rate: number }

export interface DemoData {
  orders: DemoOrder[];
  invoices: DemoInvoice[];
  waste: DemoWaste[];
  labour: DemoLabour[];
  supplierOrders: DemoSupplierOrder[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function generateDemo(seed = 20261031): DemoData {
  const rnd = mulberry32(seed);
  const pick = <T extends string>(w: Record<T, number>): T => {
    const entries = Object.entries(w) as [T, number][];
    const total = entries.reduce((s, [, v]) => s + v, 0);
    let x = rnd() * total;
    for (const [k, v] of entries) { if ((x -= v) <= 0) return k; }
    return entries[entries.length - 1][0];
  };
  const menuByKey = new Map(MENU.map((m) => [m.key, m]));
  const orders: DemoOrder[] = [];
  const weekday = [1.1, 0.75, 0.8, 0.9, 1.0, 1.4, 1.5]; // Sun..Sat

  const dineMains = { chicken_burger: 12, schnitzel: 8, caesar: 7, beef_burger: 12, steak: 9, haddock: 11, halloumi: 5, risotto: 5, kofta: 6, special: 4 };
  const delMainsSep = { chicken_burger: 22, schnitzel: 8, caesar: 5, beef_burger: 14, steak: 3, haddock: 10, halloumi: 5, risotto: 3, kofta: 6, loaded_fries: 8 };
  const delMainsOct = { ...delMainsSep, chicken_burger: 31, loaded_fries: 11 };
  let seq = 10000;

  for (let t = Date.parse(DEMO_START); t < Date.parse(DEMO_END); t += 86400000) {
    const d = new Date(t);
    const oct = d.getUTCMonth() === 9;
    const wf = weekday[d.getUTCDay()];
    const counts: Record<string, number> = {
      dine_in: Math.round((oct ? 35 : 40) * wf * (0.9 + 0.2 * rnd())),
      collection: Math.round((oct ? 12 : 13) * wf * (0.9 + 0.2 * rnd())),
      ff: Math.round((oct ? 35 : 14) * wf * (0.88 + 0.24 * rnd())),
      qp: Math.round((oct ? 8 : 10) * wf * (0.88 + 0.24 * rnd())),
    };
    for (const ch of CHANNELS) {
      for (let n = 0; n < counts[ch.key]; n++) {
        const delivery = ch.kind === "delivery";
        const lines = new Map<string, number>();
        const add = (k: string, q = 1) => lines.set(k, (lines.get(k) ?? 0) + q);
        if (ch.kind === "dine_in") {
          const covers = 1 + Math.floor(rnd() * 3.2 + rnd() * 0.8);
          for (let c = 0; c < covers; c++) {
            add(pick(dineMains));
            if (rnd() < 0.45) add(rnd() < 0.7 ? "fries" : "onion_rings");
            if (rnd() < 0.3) add(rnd() < 0.55 ? "stp" : "brownie");
            add(rnd() < 0.62 ? "lager" : "soft_drink");
          }
          if (rnd() < 0.3) add("wings");
        } else {
          const mains = 1 + (rnd() < 0.55 ? 1 : 0) + (rnd() < 0.15 ? 1 : 0);
          for (let c = 0; c < mains; c++) {
            add(pick(delivery ? (oct ? delMainsOct : delMainsSep) : delMainsSep));
            if (rnd() < 0.6) add(rnd() < 0.72 ? "fries" : "onion_rings");
            if (rnd() < 0.4) add("soft_drink");
          }
          if (rnd() < 0.25) add("wings");
          if (rnd() < 0.15) add(rnd() < 0.5 ? "stp" : "brownie");
        }
        const hour = ch.kind === "dine_in" ? (rnd() < 0.3 ? 12 + Math.floor(rnd() * 3) : 17 + Math.floor(rnd() * 5)) : (rnd() < 0.2 ? 12 + Math.floor(rnd() * 2) : 17 + Math.floor(rnd() * 5));
        const at = new Date(t + hour * 3600000 + Math.floor(rnd() * 60) * 60000).toISOString();
        const ol: DemoOrderLine[] = [...lines.entries()].map(([k, q]) => {
          const m = menuByKey.get(k)!;
          const price = delivery ? m.deliveryPrice ?? m.price : m.price;
          return { item: m.name, qty: q, unitPrice: price, gross: r2(price * q), discount: 0, refund: 0 };
        });
        const gross = r2(ol.reduce((s, l) => s + l.gross, 0));
        // Restaurant-funded discounts
        let discRate = 0;
        if (ch.key === "ff") discRate = oct ? (rnd() < 0.72 ? 0.25 : 0) : rnd() < 0.15 ? 0.1 : 0;
        else if (ch.key === "qp") discRate = oct && rnd() < 0.1 ? 0.1 : 0;
        else if (ch.kind === "dine_in") discRate = rnd() < 0.04 ? 0.1 : 0;
        let discount = r2(gross * discRate);
        if (discount > 0) {
          let allocated = 0;
          ol.forEach((l, i) => {
            l.discount = i === ol.length - 1 ? r2(discount - allocated) : r2((discount * l.gross) / gross);
            allocated = r2(allocated + l.discount);
          });
        }
        // Refunds: one line refunded in full (missing / incorrect item)
        let refund = 0;
        const refundP = delivery ? (oct ? 0.035 : 0.012) : 0.004;
        if (rnd() < refundP) {
          const l = ol[Math.floor(rnd() * ol.length)];
          l.refund = r2(l.gross - l.discount);
          refund = l.refund;
        }
        let commission: number | null = null;
        let otherFees = 0;
        let settlementRef: string | null = null;
        if (delivery) {
          commission = r2((gross - discount) * (ch.commissionRate ?? 0));
          // QuickPlate: flat service fee. FeastFleet (Oct): 4% "Boost" placement fee for promoted listings.
          otherFees = ch.key === "qp" ? 0.2 : oct && ch.key === "ff" ? r2((gross - discount) * 0.04) : 0;
          const wk = Math.floor((t - Date.parse(DEMO_START)) / (7 * 86400000));
          settlementRef = `${ch.key.toUpperCase()}-STL-2026-${String(36 + wk).padStart(2, "0")}`;
        }
        seq++;
        orders.push({ ref: `CT-${iso(d).replace(/-/g, "")}-${seq}`, channel: ch.key, at, gross, discount, refund, lines: ol, commission, otherFees, settlementRef });
      }
    }
  }

  // ---- Waste -------------------------------------------------------------
  const waste: DemoWaste[] = [];
  for (let t = Date.parse(DEMO_START); t < Date.parse(DEMO_END); t += 86400000) {
    const d = new Date(t);
    const oct = d.getUTCMonth() === 9;
    const date = iso(d);
    const wd = d.getUTCDay();
    waste.push({ date, ingredient: "potatoes", menuItem: null, quantity: r2((oct ? 7.5 : 5) + rnd() * 3), unit: "kg", reason: "overproduction", description: "Blanched fries not used by close" });
    if (rnd() < 0.6) waste.push({ date, ingredient: "lettuce", menuItem: null, quantity: 1 + Math.floor(rnd() * 2), unit: "each", reason: "prep_trim", description: "Outer leaves / wilted" });
    if (rnd() < (oct ? 0.45 : 0.15)) waste.push({ date, ingredient: "chicken_breast", menuItem: null, quantity: r2(1.5 + rnd() * (oct ? 3 : 1.5)), unit: "kg", reason: "spoilage", description: "Past use-by date" });
    if (rnd() < 0.25) waste.push({ date, ingredient: "tomatoes", menuItem: null, quantity: r2(0.4 + rnd() * 0.8), unit: "kg", reason: "spoilage", description: "Over-ripe" });
    if (rnd() < (oct ? 0.5 : 0.25)) waste.push({ date, ingredient: null, menuItem: "Buttermilk Fried Chicken Burger", quantity: 1 + Math.floor(rnd() * (oct ? 5 : 2)), unit: "portion", reason: "plate_waste", description: "Remade — incorrect / late delivery order" });
    if (wd === 0 || wd === 6) waste.push({ date, ingredient: null, menuItem: "Sticky Toffee Pudding", quantity: 1 + Math.floor(rnd() * 3), unit: "portion", reason: "overproduction", description: "Pre-portioned, not sold" });
    if (rnd() < 0.15) waste.push({ date, ingredient: "haddock", menuItem: null, quantity: r2(0.3 + rnd() * 0.6), unit: "kg", reason: "prep_trim", description: "Trim and pin-bone loss" });
    if (rnd() < 0.08) waste.push({ date, ingredient: "cream", menuItem: null, quantity: 1, unit: "l", reason: "spoilage", description: "Opened tub past date" });
  }

  // ---- Labour (wage cost only) -------------------------------------------
  const labour: DemoLabour[] = [];
  for (let t = Date.parse(DEMO_START); t < Date.parse(DEMO_END); t += 86400000) {
    const d = new Date(t);
    const oct = d.getUTCMonth() === 9;
    const date = iso(d);
    const wd = d.getUTCDay();
    const busy = wd === 5 || wd === 6;
    const L = (role: string, staffRef: string, hours: number, rate: number) => labour.push({ date, role, staffRef, hours: r2(hours), rate });
    if (wd !== 1 && wd !== 2) L("Head chef", "HC-01", 9.5, 18.0);
    if (wd !== 3 && wd !== 4) L("Sous chef", "SC-01", 9.5, 15.5);
    const cooks = busy ? 3 : 2;
    for (let i = 0; i < cooks; i++) L("Line cook", `LC-0${i + 1}`, 7.5 + rnd(), 13.2);
    L("Kitchen porter", "KP-01", 7.5, 12.71);
    if (busy) L("Kitchen porter", "KP-02", 6, 12.71);
    L("Floor supervisor", "FS-01", 8.5, 14.0);
    const servers = busy ? 4 : wd === 0 || wd === 4 ? 3 : 2;
    for (let i = 0; i < servers; i++) L("Server", `SV-0${i + 1}`, 6 + rnd() * 1.5, 12.71);
    if (oct && (wd === 4 || wd === 5 || wd === 6 || wd === 0)) L("Delivery packer", "DP-01", 6, 12.71);
    if (oct && busy) L("Line cook", "LC-04", 6, 13.2);
  }

  // ---- Supplier invoices: weekly, sized from the week's theoretical usage + waste
  const ingByKey = new Map(INGREDIENTS.map((i) => [i.key, i]));
  const conv = (q: number, unit: string) => (unit === "g" || unit === "ml" ? q / 1000 : q);
  const usageByWeek = new Map<string, Map<string, number>>(); // invoiceDate -> ingKey -> qty
  const invoiceDates: string[] = [];
  for (let t = Date.parse(DEMO_START); t < Date.parse(DEMO_END); t += 7 * 86400000) invoiceDates.push(iso(new Date(t)));
  const weekOf = (date: string) => invoiceDates[Math.min(invoiceDates.length - 1, Math.floor((Date.parse(date) - Date.parse(DEMO_START)) / (7 * 86400000)))];
  const menuByName = new Map(MENU.map((m) => [m.name, m]));
  const addUsage = (date: string, ing: string, q: number) => {
    const w = weekOf(date);
    const m = usageByWeek.get(w) ?? new Map<string, number>();
    m.set(ing, (m.get(ing) ?? 0) + q);
    usageByWeek.set(w, m);
  };
  for (const o of orders) {
    for (const l of o.lines) {
      const m = menuByName.get(l.item)!;
      const recipe = m.recipe ?? SPECIAL_RECIPE_CSV;
      for (const [ing, q, u] of recipe) addUsage(o.at.slice(0, 10), ing, conv(q, u) * l.qty);
    }
  }
  for (const w of waste) {
    if (w.ingredient) addUsage(w.date, w.ingredient, conv(w.quantity, w.unit));
  }
  const invoices: DemoInvoice[] = [];
  const prefix: Record<string, string> = { tvm: "TVM", nsf: "NSF", nfp: "NFP", qcc: "QCC", ocs: "OCS" };
  let invSeq = 4810;
  for (const date of invoiceDates) {
    const usage = usageByWeek.get(date) ?? new Map();
    const octPrices = date >= "2026-10-01";
    for (const s of SUPPLIERS) {
      if (s.key === "ocs") continue;
      const lines: DemoInvoice["lines"] = [];
      for (const ing of INGREDIENTS) {
        if (ing.supplier !== s.key || !ing.invoiced) continue;
        let need = (usage.get(ing.key) ?? 0) * (1.0 + rnd() * 0.04);
        // October: one oil order is placed with Ouseburn instead (see below).
        if (ing.key === "oil" && date === "2026-10-13") need = Math.max(0, need - 40);
        if (need <= 0) continue;
        const packs = Math.max(1, Math.ceil(need / ing.packSize));
        const qty = r2(packs * ing.packSize);
        // Chicken increase lands on the 6 Oct invoice; the 29 Sep invoice is still at the old price.
        const price = date >= "2026-10-06" || (octPrices && !ing.key.startsWith("chicken")) ? ing.priceOct : ing.priceSep;
        lines.push({ ingredient: ing.key, description: `${ing.name} ${ing.packLabel}`, packs, packLabel: ing.packLabel, quantity: qty, unit: ing.baseUnit, unitPrice: price, total: r2(qty * price), vatable: ing.vatable });
      }
      if (!lines.length) continue;
      const subtotal = r2(lines.reduce((x, l) => x + l.total, 0));
      const vat = r2(lines.filter((l) => l.vatable).reduce((x, l) => x + l.total, 0) * 0.2);
      invoices.push({ supplier: s.key, number: `${prefix[s.key]}-${invSeq++}`, date, lines, subtotal, vat, total: r2(subtotal + vat) });
    }
  }
  // One-off cheaper oil purchase (supplier comparison evidence).
  {
    const lines = [
      { ingredient: "oil", description: "Rapeseed frying oil 20L drum", packs: 2, packLabel: "20L drum", quantity: 40, unit: "l", unitPrice: 1.56, total: 62.4, vatable: false },
      { ingredient: "flour", description: "Plain flour 16kg sack", packs: 1, packLabel: "16kg sack", quantity: 16, unit: "kg", unitPrice: 0.72, total: 11.52, vatable: false },
    ];
    const subtotal = r2(lines.reduce((x, l) => x + l.total, 0));
    invoices.push({ supplier: "ocs", number: "OCS-20771", date: "2026-10-13", lines, subtotal, vat: 0, total: subtotal });
  }

  // ---- Supplier order confirmations -------------------------------------
  // Every invoice has an order confirmation (as emailed by the supplier) at the agreed prices.
  // A few invoices then differ from their order. These are the planted billing leaks.
  const supplierOrders: DemoSupplierOrder[] = [];
  let poSeq = 1900;
  for (const inv of invoices) {
    const ref = `PO-CT-${poSeq++}`;
    inv.orderRef = ref;
    supplierOrders.push({
      ref, supplier: inv.supplier, orderedOn: addDaysIso(inv.date, -2), deliveryDate: inv.date, status: "delivered", note: null,
      lines: inv.lines.map((l) => ({ ingredient: l.ingredient, description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice })),
    });
  }
  const tweak = (supplier: string, date: string, fn: (inv: DemoInvoice) => void) => {
    const inv = invoices.find((i) => i.supplier === supplier && i.date === date);
    if (!inv) return;
    fn(inv);
    for (const l of inv.lines) l.total = r2(l.quantity * l.unitPrice);
    inv.subtotal = r2(inv.lines.reduce((x, l) => x + l.total, 0));
    inv.vat = r2(inv.lines.filter((l) => l.vatable).reduce((x, l) => x + l.total, 0) * 0.2);
    inv.total = r2(inv.subtotal + inv.vat);
  };
  // 1. Beef mince invoiced above the agreed price.
  tweak("tvm", "2026-10-20", (inv) => { const l = inv.lines.find((x) => x.ingredient === "beef_mince"); if (l) l.unitPrice = 9.4; });
  // 2. One more drum of oil billed than was ordered.
  tweak("qcc", "2026-10-27", (inv) => { const l = inv.lines.find((x) => x.ingredient === "oil"); if (l) { l.quantity = r2(l.quantity + 20); l.packs += 1; } });
  // 3. Tomatoes short-delivered (billed for what arrived, so no overcharge, just a stock gap).
  tweak("nfp", "2026-10-13", (inv) => { const l = inv.lines.find((x) => x.ingredient === "tomatoes"); if (l && l.quantity > 6) { l.quantity = r2(l.quantity - 6); l.packs -= 1; } });
  // 4. A fish invoice with no order confirmation on file.
  {
    const inv = invoices.find((i) => i.supplier === "nsf" && i.date === "2026-10-27");
    if (inv) {
      const idx = supplierOrders.findIndex((o) => o.ref === inv.orderRef);
      if (idx >= 0) supplierOrders.splice(idx, 1);
      inv.orderRef = null;
    }
  }
  // Orders for the held-back sample documents (the confirmations arrived before the paperwork).
  supplierOrders.push(...SAMPLE_ORDERS);

  return { orders, invoices, waste, labour, supplierOrders };
}

function addDaysIso(iso: string, days: number) {
  return new Date(Date.parse(iso + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}

/** Order confirmations matching the two sample documents in the Data Centre. */
export const SAMPLE_ORDERS: DemoSupplierOrder[] = [
  {
    ref: "PO-CT-2041", supplier: "ocs", orderedOn: "2026-10-27", deliveryDate: "2026-10-29", status: "delivered",
    note: "Price held at £30.40 per drum as agreed on the phone.",
    lines: [
      { ingredient: "oil", description: "Rapeseed frying oil 20L drum", quantity: 60, unit: "l", unitPrice: 1.52 },
      { ingredient: "panko", description: "Panko breadcrumbs 2kg bag", quantity: 4, unit: "kg", unitPrice: 3.2 },
      { ingredient: "flour", description: "Plain flour 16kg sack", quantity: 16, unit: "kg", unitPrice: 0.72 },
    ],
  },
  {
    ref: "PO-CT-2042", supplier: "tvm", orderedOn: "2026-10-28", deliveryDate: "2026-10-30", status: "delivered", note: null,
    lines: [
      { ingredient: "chicken_breast", description: "Chicken breast fillet 5kg case", quantity: 20, unit: "kg", unitPrice: 6.1 },
      { ingredient: "chicken_thigh", description: "Chicken thigh, boneless 5kg case", quantity: 10, unit: "kg", unitPrice: 4.75 },
      { ingredient: "beef_mince", description: "Beef mince 15% 5kg pack", quantity: 5, unit: "kg", unitPrice: 8.75 },
    ],
  },
];

/** Shelf life (days from delivery) and storage area, used by the stock & expiry forecast. */
export const SHELF: Record<string, [number, string]> = {
  chicken_breast: [6, "Fridge B · Meat"], chicken_thigh: [6, "Fridge B · Meat"], chicken_wings: [6, "Fridge B · Meat"],
  beef_mince: [6, "Fridge B · Meat"], rump_steak: [14, "Fridge B · Meat"], lamb_mince: [7, "Fridge B · Meat"], bacon: [14, "Fridge B · Meat"],
  haddock: [8, "Fridge C · Fish"],
  potatoes: [21, "Veg store"], lettuce: [7, "Fridge D · Produce"], tomatoes: [8, "Fridge D · Produce"], red_onion: [30, "Veg store"],
  onions: [30, "Veg store"], mushrooms: [7, "Fridge D · Produce"], lemons: [21, "Fridge D · Produce"], salad_leaves: [5, "Fridge D · Produce"],
  oil: [180, "Dry store"], buns: [8, "Dry store"], flatbread: [14, "Dry store"], cheddar: [28, "Fridge A · Dairy"], halloumi: [60, "Fridge A · Dairy"],
  parmesan: [90, "Fridge A · Dairy"], buttermilk: [14, "Fridge A · Dairy"], cream: [10, "Fridge A · Dairy"], butter: [60, "Fridge A · Dairy"],
  eggs: [28, "Fridge A · Dairy"], rice: [365, "Dry store"], flour: [180, "Dry store"], panko: [180, "Dry store"], batter_mix: [180, "Dry store"],
  mayo: [60, "Fridge A · Dairy"], hot_sauce: [180, "Dry store"], harissa: [60, "Fridge D · Produce"], garnish: [7, "Fridge D · Produce"],
  stock: [365, "Dry store"], cola: [270, "Dry store"], lager: [90, "Cellar"], stp: [120, "Freezer 1"], brownie: [120, "Freezer 1"],
  ice_cream: [180, "Freezer 1"], truffle_oil: [365, "Dry store"],
};

/** The late invoice provided as a sample PDF for Claude extraction (not seeded). */
export const SAMPLE_PDF_INVOICE = {
  supplier: "Ouseburn Catering Supplies",
  address: ["Unit 4, Lime Street Workshops", "Newcastle upon Tyne NE1 2PQ"],
  vatNo: "GB 000 0000 00 (fictional)",
  number: "OCS-20794",
  orderRef: "PO-CT-2041",
  date: "2026-10-29",
  billTo: ["The Copper Table (DEMO)", "Newcastle upon Tyne"],
  lines: [
    { description: "Rapeseed frying oil 20L drum", qty: 3, unit: "drum", unitPrice: 31.2, vat: 0 },
    { description: "Panko breadcrumbs 2kg bag", qty: 2, unit: "bag", unitPrice: 6.4, vat: 0 },
    { description: "Plain flour 16kg sack", qty: 1, unit: "sack", unitPrice: 11.52, vat: 0 },
    { description: "Kraft takeaway boxes (x200)", qty: 1, unit: "case", unitPrice: 38.0, vat: 20 },
  ],
};

/** The delivery receipt provided as a sample photo (PNG) for Claude extraction (not seeded). */
export const SAMPLE_RECEIPT = {
  supplier: "Tyne Valley Meats",
  number: "TVM-4851",
  orderRef: "PO-CT-2042",
  date: "2026-10-30",
  lines: [
    { raw: "CHKN BRST FILLET 5KG", ingredient: "chicken_breast", cases: 3, packKg: 5, perKg: 6.1, useBy: "2026-11-05" },
    { raw: "CHKN THIGH BNLS 5KG", ingredient: "chicken_thigh", cases: 2, packKg: 5, perKg: 4.75, useBy: "2026-11-05" },
    { raw: "BEEF MINCE 15% 5KG", ingredient: "beef_mince", cases: 1, packKg: 5, perKg: 8.75, useBy: "2026-11-04" },
  ],
};
