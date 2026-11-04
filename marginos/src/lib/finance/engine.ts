/**
 * Data-backed financial engine. Reads the database and composes the pure formulas in
 * formulas.ts. Every analysis shown in the UI and every AI investigator tool calls into here.
 */
import { query, num, numOrNull } from "@/lib/db";
import {
  type BaseUnit,
  type CostSource,
  type PeriodTotals,
  classifyMenuItems,
  contribution,
  contributionOf,
  decomposeContributionChange,
  exVat,
  ingredientPriceEffect,
  marginPct,
  pctChange,
  priceScenario,
  recipeCost,
  resolveUnitCost,
  toBaseQuantity,
  wasteCost,
  type RecipeCostResult,
} from "./formulas";
import { type Period, period as mkPeriod, previousPeriod } from "./period";

export type ChannelKind = "dine_in" | "collection" | "delivery";

export interface BusinessCtx {
  id: string;
  name: string;
  location: string | null;
  vatRate: number;
  pricesIncludeVat: boolean;
  isDemo: boolean;
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export interface IngredientCost {
  id: string;
  name: string;
  category: string | null;
  baseUnit: BaseUnit;
  unitCost: number | null;
  source: CostSource;
  purchasedQty: number;
  purchasedValue: number;
}

export async function ingredientCosts(b: BusinessCtx, p: Period): Promise<Map<string, IngredientCost>> {
  const [ings, periodLines, prior] = await Promise.all([
    query<{ id: string; name: string; category: string | null; base_unit: BaseUnit; standard_cost: string | null }>(
      `select id, name, category, base_unit, standard_cost from ingredients where business_id = $1`,
      [b.id],
    ),
    query<{ ingredient_id: string; quantity: string; unit_price: string }>(
      `select l.ingredient_id, l.quantity, l.unit_price from supplier_invoice_lines l
       join supplier_invoices i on i.id = l.invoice_id
       where l.business_id = $1 and l.ingredient_id is not null and i.invoice_date >= $2 and i.invoice_date < $3`,
      [b.id, p.start, p.end],
    ),
    query<{ ingredient_id: string; unit_price: string }>(
      `select distinct on (l.ingredient_id) l.ingredient_id, l.unit_price from supplier_invoice_lines l
       join supplier_invoices i on i.id = l.invoice_id
       where l.business_id = $1 and l.ingredient_id is not null and i.invoice_date < $2
       order by l.ingredient_id, i.invoice_date desc`,
      [b.id, p.start],
    ),
  ]);
  const pts = new Map<string, { quantity: number; unitPrice: number }[]>();
  for (const l of periodLines) {
    const arr = pts.get(l.ingredient_id) ?? [];
    arr.push({ quantity: num(l.quantity), unitPrice: num(l.unit_price) });
    pts.set(l.ingredient_id, arr);
  }
  const priorMap = new Map(prior.map((r) => [r.ingredient_id, num(r.unit_price)]));
  const out = new Map<string, IngredientCost>();
  for (const i of ings) {
    const points = pts.get(i.id) ?? [];
    const r = resolveUnitCost(points, priorMap.get(i.id) ?? null, numOrNull(i.standard_cost));
    out.set(i.id, {
      id: i.id,
      name: i.name,
      category: i.category,
      baseUnit: i.base_unit,
      unitCost: r.unitCost,
      source: r.source,
      purchasedQty: points.reduce((s, x) => s + x.quantity, 0),
      purchasedValue: points.reduce((s, x) => s + x.quantity * x.unitPrice, 0),
    });
  }
  return out;
}

export interface MenuItemRow {
  id: string;
  name: string;
  category: string;
  priceGross: number;
  deliveryPriceGross: number | null;
  packagingCost: number;
  packagingIsEstimate: boolean;
  isActive: boolean;
}

export async function menuItems(b: BusinessCtx): Promise<MenuItemRow[]> {
  const rows = await query<Record<string, unknown>>(
    `select id, name, category, price_gross, delivery_price_gross, packaging_cost, packaging_is_estimate, is_active
     from menu_items where business_id = $1 order by category, name`,
    [b.id],
  );
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    category: r.category as string,
    priceGross: num(r.price_gross),
    deliveryPriceGross: numOrNull(r.delivery_price_gross),
    packagingCost: num(r.packaging_cost),
    packagingIsEstimate: Boolean(r.packaging_is_estimate),
    isActive: Boolean(r.is_active),
  }));
}

export interface RecipeComponent {
  ingredientId: string;
  quantity: number;
  unit: string;
}

export async function recipeComponents(b: BusinessCtx): Promise<Map<string, { portions: number; lines: RecipeComponent[] }>> {
  const rows = await query<{ menu_item_id: string; portions: string; ingredient_id: string | null; quantity: string | null; unit: string | null }>(
    `select r.menu_item_id, r.portions, ri.ingredient_id, ri.quantity, ri.unit
     from recipes r left join recipe_ingredients ri on ri.recipe_id = r.id where r.business_id = $1`,
    [b.id],
  );
  const out = new Map<string, { portions: number; lines: RecipeComponent[] }>();
  for (const r of rows) {
    const e = out.get(r.menu_item_id) ?? { portions: num(r.portions) || 1, lines: [] };
    if (r.ingredient_id) e.lines.push({ ingredientId: r.ingredient_id, quantity: num(r.quantity), unit: r.unit as string });
    out.set(r.menu_item_id, e);
  }
  return out;
}

export function costRecipes(
  recipes: Map<string, { portions: number; lines: RecipeComponent[] }>,
  costs: Map<string, IngredientCost>,
): Map<string, RecipeCostResult> {
  const out = new Map<string, RecipeCostResult>();
  for (const [menuItemId, r] of recipes) {
    out.set(
      menuItemId,
      recipeCost(
        r.lines.map((l) => {
          const ic = costs.get(l.ingredientId);
          return {
            ingredientName: ic?.name ?? "Unknown ingredient",
            quantity: l.quantity,
            unit: l.unit,
            baseUnit: (ic?.baseUnit ?? "each") as BaseUnit,
            unitCost: ic?.unitCost ?? null,
            costSource: ic?.source ?? "missing",
          };
        }),
        r.portions,
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sales facts
// ---------------------------------------------------------------------------

export interface SalesFact {
  menuItemId: string;
  channelKind: ChannelKind;
  channelName: string;
  platform: string | null;
  day?: string;
  units: number;
  gross: number; // VAT inclusive
  discount: number;
  refund: number;
  commissionActual: number;
  commissionEstimated: number;
}

async function salesFacts(b: BusinessCtx, p: Period, byDay = false): Promise<SalesFact[]> {
  const dayCol = byDay ? `, to_char(s.ordered_at at time zone 'UTC', 'YYYY-MM-DD') as day` : "";
  const dayGroup = byDay ? `, day` : "";
  const rows = await query<Record<string, unknown>>(
    `select si.menu_item_id, ch.kind, ch.name as channel_name, ch.platform ${dayCol},
       sum(si.quantity) as units, sum(si.line_gross) as gross, sum(si.line_discount) as discount, sum(si.line_refund) as refund,
       sum(case when df.id is not null and s.gross_amount > 0 then (df.commission_amount + df.other_fees) * si.line_gross / s.gross_amount else 0 end) as commission_actual,
       sum(case when df.id is null and ch.kind = 'delivery' then coalesce(ch.commission_rate, 0) * (si.line_gross - si.line_discount) else 0 end) as commission_estimated
     from sale_items si
     join sales s on s.id = si.sale_id
     join sales_channels ch on ch.id = s.channel_id
     left join delivery_fees df on df.sale_id = s.id
     where s.business_id = $1 and s.ordered_at >= $2 and s.ordered_at < $3
     group by si.menu_item_id, ch.kind, ch.name, ch.platform ${dayGroup}`,
    [b.id, p.start, p.end],
  );
  return rows.map((r) => ({
    menuItemId: r.menu_item_id as string,
    channelKind: r.kind as ChannelKind,
    channelName: r.channel_name as string,
    platform: (r.platform as string) ?? null,
    day: r.day as string | undefined,
    units: num(r.units),
    gross: num(r.gross),
    discount: num(r.discount),
    refund: num(r.refund),
    commissionActual: num(r.commission_actual),
    commissionEstimated: num(r.commission_estimated),
  }));
}

/** Everything needed to cost a period, loaded once. */
export interface PeriodModel {
  b: BusinessCtx;
  p: Period;
  items: MenuItemRow[];
  itemById: Map<string, MenuItemRow>;
  costs: Map<string, IngredientCost>;
  recipes: Map<string, { portions: number; lines: RecipeComponent[] }>;
  recipeCosts: Map<string, RecipeCostResult>;
  facts: SalesFact[];
}

export async function loadPeriod(b: BusinessCtx, p: Period): Promise<PeriodModel> {
  const [items, costs, recipes, facts] = await Promise.all([menuItems(b), ingredientCosts(b, p), recipeComponents(b), salesFacts(b, p)]);
  return { b, p, items, itemById: new Map(items.map((i) => [i.id, i])), costs, recipes, recipeCosts: costRecipes(recipes, costs), facts };
}

function factContribution(m: PeriodModel, f: Pick<SalesFact, "menuItemId" | "channelKind" | "units" | "gross" | "discount" | "refund" | "commissionActual" | "commissionEstimated">) {
  const item = m.itemById.get(f.menuItemId);
  const rc = m.recipeCosts.get(f.menuItemId);
  const foodCostPerUnit = rc && rc.complete ? rc.cost : null;
  return contribution({
    units: f.units,
    grossInclVat: f.gross,
    discountInclVat: f.discount,
    refundInclVat: f.refund,
    commissionExVat: f.commissionActual + f.commissionEstimated,
    foodCostPerUnit,
    packagingPerUnit: f.channelKind === "dine_in" ? 0 : item?.packagingCost ?? 0,
    vatRatePct: m.b.vatRate,
    pricesIncludeVat: m.b.pricesIncludeVat,
  });
}

// ---------------------------------------------------------------------------
// Period summary
// ---------------------------------------------------------------------------

export interface PeriodSummary {
  period: Period;
  orders: number;
  units: number;
  grossSales: number;
  discounts: number;
  refunds: number;
  netRevenue: number;
  foodCost: number;
  packaging: number;
  commission: number;
  commissionEstimatedShare: number; // 0..1
  contribution: number;
  contributionMarginPct: number | null;
  grossMarginPct: number | null;
  deliveryGrossSales: number;
  revenueWithoutRecipeCost: number; // net revenue excluded from contribution because recipe cost is missing
  waste: WasteSummary;
  labour: LabourSummary;
  contributionAfterWasteLabour: number | null;
  totals: PeriodTotals;
}

export async function periodSummary(b: BusinessCtx, p: Period, model?: PeriodModel): Promise<PeriodSummary> {
  const m = model ?? (await loadPeriod(b, p));
  const [orders, waste, labour] = await Promise.all([
    query<{ n: string }>(`select count(*) as n from sales where business_id = $1 and ordered_at >= $2 and ordered_at < $3`, [b.id, p.start, p.end]),
    wasteSummary(m),
    labourSummary(b, p),
  ]);
  let G = 0, D = 0, R = 0, F = 0, P = 0, C = 0, Cest = 0, DG = 0, units = 0, uncosted = 0;
  for (const f of m.facts) {
    const c = factContribution(m, f);
    units += f.units;
    if (c.foodCost === null) {
      // Revenue without a recipe cost cannot produce a contribution figure; report it separately.
      uncosted += c.netRevenue;
      continue;
    }
    G += c.grossSales; D += c.discounts; R += c.refunds; F += c.foodCost; P += c.packaging; C += c.commission;
    Cest += f.commissionEstimated;
    if (f.channelKind === "delivery") DG += c.grossSales;
  }
  const totals: PeriodTotals = { grossSales: G, discounts: D, refunds: R, foodCost: F, packaging: P, commission: C, deliveryGrossSales: DG, waste: waste.totalCost, labour: labour.totalCost };
  const N = G - D - R;
  const contrib = contributionOf(totals);
  return {
    period: p,
    orders: num(orders[0]?.n),
    units,
    grossSales: G,
    discounts: D,
    refunds: R,
    netRevenue: N + uncosted,
    foodCost: F,
    packaging: P,
    commission: C,
    commissionEstimatedShare: C ? Cest / C : 0,
    contribution: contrib,
    contributionMarginPct: marginPct(contrib, N),
    grossMarginPct: marginPct(N - F, N),
    deliveryGrossSales: DG,
    revenueWithoutRecipeCost: uncosted,
    waste,
    labour,
    contributionAfterWasteLabour: labour.records > 0 || waste.records > 0 ? contrib - waste.totalCost - labour.totalCost : null,
    totals,
  };
}

export async function dailySeries(b: BusinessCtx, p: Period, model?: PeriodModel) {
  const m = model ?? (await loadPeriod(b, p));
  const facts = await salesFacts(b, p, true);
  const byDay = new Map<string, { revenue: number; contribution: number }>();
  for (let i = 0; i < p.days; i++) {
    const d = new Date(Date.parse(p.start) + i * 86400000).toISOString().slice(0, 10);
    byDay.set(d, { revenue: 0, contribution: 0 });
  }
  for (const f of facts) {
    const c = factContribution(m, f);
    const e = byDay.get(f.day!) ?? { revenue: 0, contribution: 0 };
    e.revenue += c.netRevenue;
    if (c.contribution !== null) e.contribution += c.contribution;
    byDay.set(f.day!, e);
  }
  return [...byDay.entries()].map(([day, v]) => ({ day, ...v }));
}

// ---------------------------------------------------------------------------
// Menu profitability
// ---------------------------------------------------------------------------

export interface ChannelLine {
  units: number;
  netRevenue: number;
  foodCost: number | null;
  packaging: number;
  commission: number;
  commissionEstimated: number;
  discounts: number;
  refunds: number;
  contribution: number | null;
  contributionPerUnit: number | null;
  marginPct: number | null;
  avgPriceGross: number | null;
}

export interface MenuItemProfit {
  id: string;
  name: string;
  category: string;
  priceGross: number;
  deliveryPriceGross: number | null;
  packagingCost: number;
  packagingIsEstimate: boolean;
  recipeCost: number | null;
  recipeComplete: boolean;
  recipeEstimated: boolean;
  missingCosts: string[];
  hasRecipe: boolean;
  total: ChannelLine;
  byChannel: Record<ChannelKind, ChannelLine>;
  previous: { recipeCost: number | null; contributionPerUnit: number | null; units: number; marginPct: number | null } | null;
  quadrant: string | null;
}

function emptyLine(): ChannelLine {
  return { units: 0, netRevenue: 0, foodCost: 0, packaging: 0, commission: 0, commissionEstimated: 0, discounts: 0, refunds: 0, contribution: 0, contributionPerUnit: null, marginPct: null, avgPriceGross: null };
}

function aggregateItem(m: PeriodModel, itemId: string) {
  const total = emptyLine();
  const byChannel: Record<ChannelKind, ChannelLine> = { dine_in: emptyLine(), collection: emptyLine(), delivery: emptyLine() };
  const grossBy: Record<string, number> = { total: 0, dine_in: 0, collection: 0, delivery: 0 };
  for (const f of m.facts) {
    if (f.menuItemId !== itemId) continue;
    const c = factContribution(m, f);
    for (const [key, line] of [["total", total], [f.channelKind, byChannel[f.channelKind]]] as const) {
      line.units += f.units;
      line.netRevenue += c.netRevenue;
      line.foodCost = c.foodCost === null || line.foodCost === null ? null : line.foodCost + c.foodCost;
      line.packaging += c.packaging;
      line.commission += c.commission;
      line.commissionEstimated += f.commissionEstimated;
      line.discounts += c.discounts;
      line.refunds += c.refunds;
      line.contribution = c.contribution === null || line.contribution === null ? null : line.contribution + c.contribution;
      grossBy[key] += f.gross;
    }
  }
  const rc = m.recipeCosts.get(itemId);
  const costable = !!rc && rc.complete;
  for (const [key, line] of [["total", total], ...Object.entries(byChannel)] as [string, ChannelLine][]) {
    if (!costable) {
      line.foodCost = null;
      line.contribution = null;
    }
    line.contributionPerUnit = line.contribution === null || !line.units ? null : line.contribution / line.units;
    line.marginPct = line.contribution === null ? null : marginPct(line.contribution, line.netRevenue);
    line.avgPriceGross = line.units ? grossBy[key] / line.units : null;
  }
  return { total, byChannel, rc };
}

export async function menuProfitability(b: BusinessCtx, p: Period, opts: { withPrevious?: boolean } = {}): Promise<{ period: Period; items: MenuItemProfit[]; thresholds: { volume: number; contribution: number } }> {
  const m = await loadPeriod(b, p);
  const prevM = opts.withPrevious === false ? null : await loadPeriod(b, previousPeriod(p.key));
  const rows: MenuItemProfit[] = m.items.map((item) => {
    const { total, byChannel, rc } = aggregateItem(m, item.id);
    let previous: MenuItemProfit["previous"] = null;
    if (prevM) {
      const pa = aggregateItem(prevM, item.id);
      previous = { recipeCost: pa.rc && pa.rc.complete ? pa.rc.cost : null, contributionPerUnit: pa.total.contributionPerUnit, units: pa.total.units, marginPct: pa.total.marginPct };
    }
    return {
      id: item.id,
      name: item.name,
      category: item.category,
      priceGross: item.priceGross,
      deliveryPriceGross: item.deliveryPriceGross,
      packagingCost: item.packagingCost,
      packagingIsEstimate: item.packagingIsEstimate,
      recipeCost: rc && rc.complete ? rc.cost : null,
      recipeComplete: !!rc && rc.complete,
      recipeEstimated: !!rc && rc.estimated,
      missingCosts: rc ? rc.missing : [],
      hasRecipe: !!rc,
      total,
      byChannel,
      previous,
      quadrant: null,
    };
  });
  const cls = classifyMenuItems(rows.map((r) => ({ id: r.id, units: r.total.units, contributionPerUnit: r.total.contributionPerUnit })));
  const q = new Map(cls.items.map((i) => [i.id, i.quadrant]));
  for (const r of rows) r.quadrant = q.get(r.id) ?? null;
  return { period: p, items: rows, thresholds: { volume: cls.volumeThreshold, contribution: cls.contributionThreshold } };
}

export async function menuItemDetail(b: BusinessCtx, p: Period, itemId: string) {
  const [m, prevM] = await Promise.all([loadPeriod(b, p), loadPeriod(b, previousPeriod(p.key))]);
  const item = m.itemById.get(itemId);
  if (!item) return null;
  const cur = aggregateItem(m, itemId);
  const prev = aggregateItem(prevM, itemId);
  const recipe = m.recipes.get(itemId);
  const lines = (recipe?.lines ?? []).map((l) => {
    const ic = m.costs.get(l.ingredientId);
    const pc = prevM.costs.get(l.ingredientId);
    const base = ic ? toBaseQuantity(l.quantity, l.unit, ic.baseUnit) : null;
    const portions = recipe?.portions ?? 1;
    return {
      ingredientId: l.ingredientId,
      name: ic?.name ?? "Unknown",
      quantity: l.quantity,
      unit: l.unit,
      baseUnit: ic?.baseUnit ?? "each",
      unitCost: ic?.unitCost ?? null,
      previousUnitCost: pc?.unitCost ?? null,
      costSource: ic?.source ?? "missing",
      cost: base !== null && ic?.unitCost != null ? (base * ic.unitCost) / portions : null,
      previousCost: base !== null && pc?.unitCost != null ? (base * pc.unitCost) / portions : null,
    };
  });
  return { item, current: cur, previous: prev, lines, period: p, previousPeriod: prevM.p };
}

// ---------------------------------------------------------------------------
// Ingredient usage & supplier price changes
// ---------------------------------------------------------------------------

/** Theoretical ingredient usage (base units) implied by recipes × units sold. */
export function ingredientUsage(m: PeriodModel): Map<string, number> {
  const unitsByItem = new Map<string, number>();
  for (const f of m.facts) unitsByItem.set(f.menuItemId, (unitsByItem.get(f.menuItemId) ?? 0) + f.units);
  const usage = new Map<string, number>();
  for (const [itemId, units] of unitsByItem) {
    const r = m.recipes.get(itemId);
    if (!r) continue;
    for (const l of r.lines) {
      const ic = m.costs.get(l.ingredientId);
      if (!ic) continue;
      const base = toBaseQuantity(l.quantity, l.unit, ic.baseUnit);
      if (base === null) continue;
      usage.set(l.ingredientId, (usage.get(l.ingredientId) ?? 0) + (base / r.portions) * units);
    }
  }
  return usage;
}

export interface IngredientPriceChange {
  ingredientId: string;
  ingredient: string;
  baseUnit: BaseUnit;
  suppliers: string[];
  previousUnitCost: number | null;
  currentUnitCost: number | null;
  previousSource: CostSource;
  currentSource: CostSource;
  changePct: number | null;
  usageCurrent: number;
  impactCurrentPeriod: number; // negative = cost increase reduces contribution
  affectedDishes: { id: string; name: string; unitsSold: number; costChangePerUnit: number; impact: number }[];
  invoiceEvidence: { invoiceId: string; invoiceNumber: string; supplier: string; date: string; unitPrice: number; quantity: number }[];
}

export async function supplierPriceChanges(b: BusinessCtx, cur: Period, prev: Period, models?: { cur: PeriodModel; prev: PeriodModel }) {
  const mc = models?.cur ?? (await loadPeriod(b, cur));
  const mp = models?.prev ?? (await loadPeriod(b, prev));
  const usage = ingredientUsage(mc);
  const evidence = await query<Record<string, unknown>>(
    `select l.ingredient_id, i.id as invoice_id, i.invoice_number, s.name as supplier, i.invoice_date::text as date, l.unit_price, l.quantity
     from supplier_invoice_lines l join supplier_invoices i on i.id = l.invoice_id join suppliers s on s.id = i.supplier_id
     where l.business_id = $1 and l.ingredient_id is not null and i.invoice_date >= $2 and i.invoice_date < $3
     order by i.invoice_date`,
    [b.id, prev.start, cur.end],
  );
  const evByIng = new Map<string, IngredientPriceChange["invoiceEvidence"]>();
  for (const e of evidence) {
    const arr = evByIng.get(e.ingredient_id as string) ?? [];
    arr.push({ invoiceId: e.invoice_id as string, invoiceNumber: e.invoice_number as string, supplier: e.supplier as string, date: e.date as string, unitPrice: num(e.unit_price), quantity: num(e.quantity) });
    evByIng.set(e.ingredient_id as string, arr);
  }
  const unitsByItem = new Map<string, number>();
  for (const f of mc.facts) unitsByItem.set(f.menuItemId, (unitsByItem.get(f.menuItemId) ?? 0) + f.units);

  const changes: IngredientPriceChange[] = [];
  for (const [id, c] of mc.costs) {
    const pc = mp.costs.get(id);
    const prevCost = pc?.unitCost ?? null;
    const curCost = c.unitCost;
    const u = usage.get(id) ?? 0;
    const affected: IngredientPriceChange["affectedDishes"] = [];
    for (const [itemId, r] of mc.recipes) {
      const line = r.lines.find((l) => l.ingredientId === id);
      if (!line) continue;
      const base = toBaseQuantity(line.quantity, line.unit, c.baseUnit);
      const delta = base !== null && prevCost !== null && curCost !== null ? ((curCost - prevCost) * base) / r.portions : 0;
      const units = unitsByItem.get(itemId) ?? 0;
      affected.push({ id: itemId, name: mc.itemById.get(itemId)?.name ?? "?", unitsSold: units, costChangePerUnit: delta, impact: -delta * units });
    }
    affected.sort((a, z) => a.impact - z.impact);
    const ev = evByIng.get(id) ?? [];
    changes.push({
      ingredientId: id,
      ingredient: c.name,
      baseUnit: c.baseUnit,
      suppliers: [...new Set(ev.map((e) => e.supplier))],
      previousUnitCost: prevCost,
      currentUnitCost: curCost,
      previousSource: pc?.source ?? "missing",
      currentSource: c.source,
      changePct: prevCost !== null && curCost !== null ? pctChange(curCost, prevCost) : null,
      usageCurrent: u,
      impactCurrentPeriod: prevCost !== null && curCost !== null ? -u * (curCost - prevCost) : 0,
      affectedDishes: affected,
      invoiceEvidence: ev,
    });
  }
  changes.sort((a, z) => a.impactCurrentPeriod - z.impactCurrentPeriod);
  const totalImpact = ingredientPriceEffect(
    changes.filter((c) => c.previousSource.startsWith("invoice") && c.currentSource.startsWith("invoice")).map((c) => ({ usageCurrent: c.usageCurrent, pricePrevious: c.previousUnitCost, priceCurrent: c.currentUnitCost })),
  );
  return { current: cur, previous: prev, changes, totalImpact };
}

/** Same ingredient bought from more than one supplier in the window: price spread. */
export async function supplierComparison(b: BusinessCtx, from: string, to: string) {
  const rows = await query<Record<string, unknown>>(
    `select ing.id as ingredient_id, ing.name as ingredient, ing.base_unit, s.name as supplier,
       sum(l.quantity) as qty, sum(l.quantity * l.unit_price) / nullif(sum(l.quantity), 0) as avg_price, max(i.invoice_date)::text as last_date, count(*) as lines
     from supplier_invoice_lines l join supplier_invoices i on i.id = l.invoice_id
     join suppliers s on s.id = i.supplier_id join ingredients ing on ing.id = l.ingredient_id
     where l.business_id = $1 and i.invoice_date >= $2 and i.invoice_date < $3
     group by ing.id, ing.name, ing.base_unit, s.name`,
    [b.id, from, to],
  );
  const byIng = new Map<string, { ingredient: string; baseUnit: string; suppliers: { supplier: string; avgPrice: number; qty: number; lastDate: string }[] }>();
  for (const r of rows) {
    const e = byIng.get(r.ingredient_id as string) ?? { ingredient: r.ingredient as string, baseUnit: r.base_unit as string, suppliers: [] };
    e.suppliers.push({ supplier: r.supplier as string, avgPrice: num(r.avg_price), qty: num(r.qty), lastDate: r.last_date as string });
    byIng.set(r.ingredient_id as string, e);
  }
  return [...byIng.entries()]
    .filter(([, v]) => v.suppliers.length > 1)
    .map(([id, v]) => {
      const sorted = [...v.suppliers].sort((a, z) => a.avgPrice - z.avgPrice);
      const cheapest = sorted[0];
      const main = [...v.suppliers].sort((a, z) => z.qty - a.qty)[0];
      return {
        ingredientId: id,
        ingredient: v.ingredient,
        baseUnit: v.baseUnit,
        suppliers: sorted,
        mainSupplier: main.supplier,
        cheapestSupplier: cheapest.supplier,
        spreadPct: pctChange(main.avgPrice, cheapest.avgPrice),
        // If every unit bought from the main supplier had been bought at the cheapest observed price.
        potentialSaving: main.supplier === cheapest.supplier ? 0 : main.qty * (main.avgPrice - cheapest.avgPrice),
      };
    });
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export interface ChannelResult {
  channel: string;
  kind: ChannelKind;
  platform: string | null;
  orders: number;
  units: number;
  netRevenue: number;
  grossSales: number;
  discounts: number;
  refunds: number;
  commission: number;
  commissionEstimated: number;
  packaging: number;
  foodCost: number;
  contribution: number;
  marginPct: number | null;
  avgOrderValueGross: number | null;
  contributionPerOrder: number | null;
  uncostedRevenue: number;
}

export async function channelAnalysis(b: BusinessCtx, p: Period, model?: PeriodModel): Promise<ChannelResult[]> {
  const m = model ?? (await loadPeriod(b, p));
  const orderRows = await query<{ name: string; n: string; gross: string }>(
    `select ch.name, count(*) as n, sum(s.gross_amount) as gross from sales s join sales_channels ch on ch.id = s.channel_id
     where s.business_id = $1 and s.ordered_at >= $2 and s.ordered_at < $3 group by ch.name`,
    [b.id, p.start, p.end],
  );
  const orders = new Map(orderRows.map((r) => [r.name, { n: num(r.n), gross: num(r.gross) }]));
  const acc = new Map<string, ChannelResult>();
  for (const f of m.facts) {
    const c = factContribution(m, f);
    const e = acc.get(f.channelName) ?? {
      channel: f.channelName, kind: f.channelKind, platform: f.platform, orders: orders.get(f.channelName)?.n ?? 0, units: 0, netRevenue: 0, grossSales: 0, discounts: 0, refunds: 0, commission: 0, commissionEstimated: 0, packaging: 0, foodCost: 0, contribution: 0, marginPct: null, avgOrderValueGross: null, contributionPerOrder: null, uncostedRevenue: 0,
    };
    e.units += f.units;
    if (c.foodCost === null) {
      e.uncostedRevenue += c.netRevenue;
    } else {
      e.netRevenue += c.netRevenue; e.grossSales += c.grossSales; e.discounts += c.discounts; e.refunds += c.refunds;
      e.commission += c.commission; e.commissionEstimated += f.commissionEstimated; e.packaging += c.packaging; e.foodCost += c.foodCost;
      e.contribution += c.contribution as number;
    }
    acc.set(f.channelName, e);
  }
  const out = [...acc.values()];
  for (const e of out) {
    e.marginPct = marginPct(e.contribution, e.netRevenue);
    const o = orders.get(e.channel);
    e.avgOrderValueGross = o && o.n ? o.gross / o.n : null;
    e.contributionPerOrder = e.orders ? e.contribution / e.orders : null;
  }
  const order: Record<ChannelKind, number> = { dine_in: 0, collection: 1, delivery: 2 };
  return out.sort((a, z) => order[a.kind] - order[z.kind] || a.channel.localeCompare(z.channel));
}

// ---------------------------------------------------------------------------
// Waste
// ---------------------------------------------------------------------------

export interface WasteSummary {
  records: number;
  totalCost: number;
  uncostedRecords: number;
  byReason: { reason: string; cost: number; records: number }[];
  byItem: { name: string; kind: "ingredient" | "menu_item"; cost: number; records: number; quantity: number; unit: string }[];
  byDay: { day: string; cost: number }[];
}

export async function wasteSummary(m: PeriodModel): Promise<WasteSummary> {
  const rows = await query<Record<string, unknown>>(
    `select recorded_on::text as day, ingredient_id, menu_item_id, description, quantity, unit, reason
     from waste_records where business_id = $1 and recorded_on >= $2 and recorded_on < $3 order by recorded_on`,
    [m.b.id, m.p.start, m.p.end],
  );
  const byReason = new Map<string, { reason: string; cost: number; records: number }>();
  const byItem = new Map<string, WasteSummary["byItem"][number]>();
  const byDay = new Map<string, number>();
  let total = 0, uncosted = 0;
  for (const r of rows) {
    const ingId = r.ingredient_id as string | null;
    const miId = r.menu_item_id as string | null;
    let cost: number | null = null;
    let name = r.description as string;
    let kind: "ingredient" | "menu_item" = "ingredient";
    if (ingId) {
      const ic = m.costs.get(ingId);
      if (ic) {
        name = ic.name;
        cost = wasteCost({ quantity: num(r.quantity), unit: r.unit as string }, { kind: "ingredient", baseUnit: ic.baseUnit, unitCost: ic.unitCost });
      }
    } else if (miId) {
      kind = "menu_item";
      const rc = m.recipeCosts.get(miId);
      name = m.itemById.get(miId)?.name ?? name;
      cost = wasteCost({ quantity: num(r.quantity), unit: r.unit as string }, { kind: "menu_item", recipeCost: rc && rc.complete ? rc.cost : null });
    }
    if (cost === null) { uncosted++; continue; }
    total += cost;
    const rr = byReason.get(r.reason as string) ?? { reason: r.reason as string, cost: 0, records: 0 };
    rr.cost += cost; rr.records++; byReason.set(r.reason as string, rr);
    const key = `${kind}:${name}`;
    const it = byItem.get(key) ?? { name, kind, cost: 0, records: 0, quantity: 0, unit: r.unit as string };
    it.cost += cost; it.records++; it.quantity += num(r.quantity); byItem.set(key, it);
    byDay.set(r.day as string, (byDay.get(r.day as string) ?? 0) + cost);
  }
  return {
    records: rows.length,
    totalCost: total,
    uncostedRecords: uncosted,
    byReason: [...byReason.values()].sort((a, z) => z.cost - a.cost),
    byItem: [...byItem.values()].sort((a, z) => z.cost - a.cost),
    byDay: [...byDay.entries()].map(([day, cost]) => ({ day, cost })),
  };
}

// ---------------------------------------------------------------------------
// Labour
// ---------------------------------------------------------------------------

export interface LabourSummary {
  records: number;
  totalCost: number;
  totalHours: number;
  byRole: { role: string; hours: number; cost: number }[];
  byDay: { day: string; hours: number; cost: number }[];
}

export async function labourSummary(b: BusinessCtx, p: Period): Promise<LabourSummary> {
  const rows = await query<Record<string, unknown>>(
    `select work_date::text as day, role, sum(hours) as hours, sum(cost) as cost, count(*) as n
     from labour_records where business_id = $1 and work_date >= $2 and work_date < $3 group by work_date, role order by work_date`,
    [b.id, p.start, p.end],
  );
  const byRole = new Map<string, { role: string; hours: number; cost: number }>();
  const byDay = new Map<string, { day: string; hours: number; cost: number }>();
  let records = 0, cost = 0, hours = 0;
  for (const r of rows) {
    records += num(r.n); cost += num(r.cost); hours += num(r.hours);
    const ro = byRole.get(r.role as string) ?? { role: r.role as string, hours: 0, cost: 0 };
    ro.hours += num(r.hours); ro.cost += num(r.cost); byRole.set(r.role as string, ro);
    const d = byDay.get(r.day as string) ?? { day: r.day as string, hours: 0, cost: 0 };
    d.hours += num(r.hours); d.cost += num(r.cost); byDay.set(r.day as string, d);
  }
  return { records, totalCost: cost, totalHours: hours, byRole: [...byRole.values()].sort((a, z) => z.cost - a.cost), byDay: [...byDay.values()] };
}

export async function labourAnalysis(b: BusinessCtx, p: Period) {
  const m = await loadPeriod(b, p);
  const [labour, daily] = await Promise.all([labourSummary(b, p), dailySeries(b, p, m)]);
  const revenueByDay = new Map(daily.map((d) => [d.day, d.revenue]));
  const days = labour.byDay.map((d) => {
    const rev = revenueByDay.get(d.day) ?? 0;
    return { ...d, revenue: rev, labourPct: marginPct(d.cost, rev) };
  });
  const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const byWeekday = weekdayNames.map((name, wd) => {
    const ds = days.filter((d) => new Date(d.day).getUTCDay() === wd);
    const cost = ds.reduce((s, d) => s + d.cost, 0);
    const rev = ds.reduce((s, d) => s + d.revenue, 0);
    return { weekday: name, days: ds.length, cost, revenue: rev, labourPct: marginPct(cost, rev) };
  });
  const revenue = daily.reduce((s, d) => s + d.revenue, 0);
  const overall = marginPct(labour.totalCost, revenue);
  const flagged = overall === null ? [] : days.filter((d) => d.labourPct !== null && d.labourPct > overall + 8).sort((a, z) => (z.labourPct ?? 0) - (a.labourPct ?? 0)).slice(0, 8);
  return { period: p, ...labour, revenue, labourPctOfRevenue: overall, days, byWeekday, flaggedDays: flagged };
}

// ---------------------------------------------------------------------------
// Profit change investigation
// ---------------------------------------------------------------------------

export type Confidence = "high" | "medium" | "low";

export async function investigateProfitChange(b: BusinessCtx, curKey: string, prevKey?: string) {
  const cur = mkPeriod(curKey);
  const prev = prevKey ? mkPeriod(prevKey) : previousPeriod(curKey);
  const [mc, mp] = await Promise.all([loadPeriod(b, cur), loadPeriod(b, prev)]);
  const [sc, sp, prices, chC, chP] = await Promise.all([
    periodSummary(b, cur, mc),
    periodSummary(b, prev, mp),
    supplierPriceChanges(b, cur, prev, { cur: mc, prev: mp }),
    channelAnalysis(b, cur, mc),
    channelAnalysis(b, prev, mp),
  ]);
  const dec = decomposeContributionChange(sp.totals, sc.totals, prices.totalImpact);
  const confidenceFor = (key: string): Confidence => {
    if (key === "ingredient_prices") return "high";
    if (key === "volume") return "high";
    if (key === "menu_mix") return "low";
    if (key === "commission_rate" || key === "delivery_mix") return sc.commissionEstimatedShare > 0.2 ? "medium" : "high";
    if (key === "packaging") return "medium"; // packaging costs are per-item estimates
    return "high";
  };
  const effects = dec.effects.map((e) => ({ ...e, confidence: confidenceFor(e.key), attribution: e.key === "menu_mix" ? "estimated" : e.key === "packaging" ? "estimated" : "measured" }));

  const dataGaps: string[] = [];
  if (sc.revenueWithoutRecipeCost > 0) {
    const names = mc.items.filter((i) => !mc.recipeCosts.get(i.id)?.complete && mc.facts.some((f) => f.menuItemId === i.id)).map((i) => i.name);
    dataGaps.push(`${money(sc.revenueWithoutRecipeCost)} of ${cur.label} net revenue is excluded from contribution because these items have no complete recipe cost: ${names.join(", ")}.`);
  }
  if (sc.commissionEstimatedShare > 0) dataGaps.push(`${(sc.commissionEstimatedShare * 100).toFixed(0)}% of ${cur.label} platform commission is estimated from contractual rates (no settlement record).`);
  const est = [...mc.costs.values()].filter((c) => c.source === "standard_estimate").map((c) => c.name);
  if (est.length) dataGaps.push(`Using estimated standard costs (no invoice) for: ${est.join(", ")}.`);
  const packEst = mc.items.some((i) => i.packagingIsEstimate && i.packagingCost > 0);
  if (packEst) dataGaps.push("Packaging costs per item are estimates entered on the menu, not invoice-backed.");
  if (sc.labour.records === 0) dataGaps.push(`No labour records for ${cur.label}.`);
  if (sc.waste.records === 0) dataGaps.push(`No waste records for ${cur.label}.`);
  dataGaps.push("Food cost is theoretical (recipe × units sold). Differences between purchases and theoretical usage (e.g. unrecorded waste, over-portioning) are not captured unless recorded as waste.");

  return {
    current: cur,
    previous: prev,
    headline: {
      netRevenue: { previous: sp.netRevenue, current: sc.netRevenue, changePct: pctChange(sc.netRevenue, sp.netRevenue) },
      contribution: { previous: sp.contribution, current: sc.contribution, changePct: pctChange(sc.contribution, sp.contribution) },
      contributionMarginPct: { previous: sp.contributionMarginPct, current: sc.contributionMarginPct, changePts: sc.contributionMarginPct !== null && sp.contributionMarginPct !== null ? sc.contributionMarginPct - sp.contributionMarginPct : null },
      orders: { previous: sp.orders, current: sc.orders },
    },
    contributionBridge: {
      note: "Effects are additive and non-overlapping by construction (they sum to the total change in contribution). Correlation with operational events is not proof of cause.",
      effects,
      totalChange: dec.change,
      residual: dec.residual,
    },
    belowContribution: {
      waste: { previous: sp.waste.totalCost, current: sc.waste.totalCost, change: sc.waste.totalCost - sp.waste.totalCost, topItems: sc.waste.byItem.slice(0, 5) },
      labour: { previous: sp.labour.totalCost, current: sc.labour.totalCost, change: sc.labour.totalCost - sp.labour.totalCost, previousPctOfRevenue: marginPct(sp.labour.totalCost, sp.netRevenue), currentPctOfRevenue: marginPct(sc.labour.totalCost, sc.netRevenue) },
      contributionAfterWasteLabour: { previous: sp.contributionAfterWasteLabour, current: sc.contributionAfterWasteLabour },
    },
    topIngredientIncreases: prices.changes.filter((c) => c.impactCurrentPeriod < -1).slice(0, 6).map((c) => ({
      ingredient: c.ingredient, unit: c.baseUnit, previousUnitCost: c.previousUnitCost, currentUnitCost: c.currentUnitCost, changePct: c.changePct, impact: c.impactCurrentPeriod, suppliers: c.suppliers, topDishes: c.affectedDishes.slice(0, 3).map((d) => d.name),
    })),
    channels: { current: chC, previous: chP },
    dataGaps,
  };
}

// ---------------------------------------------------------------------------
// Price scenario
// ---------------------------------------------------------------------------

export async function priceScenarioForItem(b: BusinessCtx, p: Period, input: { menuItemId: string; newPriceGross: number; channel: ChannelKind; demandChangePct: number }) {
  const m = await loadPeriod(b, p);
  const item = m.itemById.get(input.menuItemId);
  if (!item) throw new Error("Unknown menu item");
  const { byChannel, rc } = aggregateItem(m, item.id);
  if (!rc || !rc.complete) return { ok: false as const, reason: `No complete recipe cost for ${item.name}; a price scenario would be guesswork.` };
  const line = byChannel[input.channel];
  const currentPrice = input.channel === "delivery" ? item.deliveryPriceGross ?? item.priceGross : item.priceGross;
  const grossBase = line.avgPriceGross && line.units ? line.avgPriceGross * line.units : 0;
  const commissionRate = grossBase ? line.commission / grossBase : 0;
  // line.discounts is ex VAT; convert back to VAT-inclusive to express it as a share of the gross price.
  const discountRate = grossBase ? (line.discounts * (1 + b.vatRate / 100)) / grossBase : 0;
  const res = priceScenario({
    currentPriceGross: currentPrice,
    newPriceGross: input.newPriceGross,
    unitsPerPeriod: line.units,
    foodCostPerUnit: rc.cost,
    packagingPerUnit: input.channel === "dine_in" ? 0 : item.packagingCost,
    commissionRate,
    discountRate,
    vatRatePct: b.vatRate,
    demandChangePct: input.demandChangePct,
  });
  return {
    ok: true as const,
    item: item.name,
    channel: input.channel,
    period: p.label,
    assumptions: { commissionRate, discountRate, vatRatePct: b.vatRate, demandChangePct: input.demandChangePct, foodCostPerUnit: rc.cost, packagingPerUnit: input.channel === "dine_in" ? 0 : item.packagingCost },
    currentPriceGross: currentPrice,
    newPriceGross: input.newPriceGross,
    ...res,
  };
}

// ---------------------------------------------------------------------------
// Alerts & data health
// ---------------------------------------------------------------------------

export interface Alert {
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  href: string;
}

export async function alerts(b: BusinessCtx, curKey: string): Promise<Alert[]> {
  const inv = await investigateProfitChange(b, curKey);
  const out: Alert[] = [];
  const h = inv.headline;
  if ((h.netRevenue.changePct ?? 0) > 0 && (h.contribution.changePct ?? 0) < 0) {
    out.push({ severity: "critical", title: "Revenue up, contribution down", detail: `Net revenue ${fmtPct(h.netRevenue.changePct)} vs ${inv.previous.short}, but contribution ${fmtPct(h.contribution.changePct)}.`, href: "/investigator?q=revenue" });
  }
  for (const c of inv.topIngredientIncreases.slice(0, 2)) {
    if ((c.changePct ?? 0) >= 5) out.push({ severity: "warning", title: `${c.ingredient} up ${c.changePct!.toFixed(1)}%`, detail: `£${c.previousUnitCost!.toFixed(2)} → £${c.currentUnitCost!.toFixed(2)}/${c.unit}. Est. ${money(Math.abs(c.impact))} contribution impact in ${inv.current.short} across ${c.topDishes.join(", ")}.`, href: "/costs" });
  }
  const del = inv.channels.current.filter((c) => c.kind === "delivery");
  for (const d of del) {
    const p = inv.channels.previous.find((x) => x.channel === d.channel);
    if (d.marginPct !== null && p?.marginPct != null && d.marginPct < p.marginPct - 3) {
      out.push({ severity: "warning", title: `${d.channel} margin fell ${(p.marginPct - d.marginPct).toFixed(1)} pts`, detail: `Contribution margin ${p.marginPct.toFixed(1)}% → ${d.marginPct.toFixed(1)}%. Discounts ${money(d.discounts)}, commission & fees ${money(d.commission)}.`, href: "/menu?channel=delivery" });
    }
  }
  const w = inv.belowContribution.waste;
  if (w.previous > 0 && w.current > w.previous * 1.15) out.push({ severity: "warning", title: `Recorded waste up ${(((w.current - w.previous) / w.previous) * 100).toFixed(0)}%`, detail: `${money(w.previous)} → ${money(w.current)}. Largest: ${w.topItems.slice(0, 2).map((i) => i.name).join(", ")}.`, href: "/waste-labour" });
  for (const g of inv.dataGaps.slice(0, 1)) if (g.includes("no complete recipe cost")) out.push({ severity: "info", title: "Menu items without recipe costs", detail: g, href: "/menu" });
  return out;
}

const money = (v: number, dp = 0) => `£${v.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const fmtPct = (v: number | null) => (v === null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);

export async function dataHealth(b: BusinessCtx) {
  const r = await query<Record<string, unknown>>(
    `select
      (select count(*) from sales where business_id = $1) as sales,
      (select max(ordered_at)::text from sales where business_id = $1) as sales_latest,
      (select min(ordered_at)::text from sales where business_id = $1) as sales_earliest,
      (select count(*) from supplier_invoices where business_id = $1) as invoices,
      (select max(invoice_date)::text from supplier_invoices where business_id = $1) as invoices_latest,
      (select count(*) from menu_items where business_id = $1) as menu_items,
      (select count(*) from recipes where business_id = $1) as recipes,
      (select count(*) from delivery_fees where business_id = $1) as settlements,
      (select count(*) from sales s join sales_channels c on c.id = s.channel_id where s.business_id = $1 and c.kind = 'delivery') as delivery_orders,
      (select count(*) from waste_records where business_id = $1) as waste,
      (select max(recorded_on)::text from waste_records where business_id = $1) as waste_latest,
      (select count(*) from labour_records where business_id = $1) as labour,
      (select max(work_date)::text from labour_records where business_id = $1) as labour_latest,
      (select count(*) from supplier_invoice_lines where business_id = $1 and ingredient_id is null) as unmatched_lines`,
    [b.id],
  );
  const x = r[0];
  return {
    sales: { count: num(x.sales), latest: x.sales_latest as string | null, earliest: x.sales_earliest as string | null },
    invoices: { count: num(x.invoices), latest: x.invoices_latest as string | null, unmatchedLines: num(x.unmatched_lines) },
    menu: { items: num(x.menu_items), recipes: num(x.recipes) },
    delivery: { orders: num(x.delivery_orders), settled: num(x.settlements) },
    waste: { count: num(x.waste), latest: x.waste_latest as string | null },
    labour: { count: num(x.labour), latest: x.labour_latest as string | null },
  };
}

/** Months that contain sales, newest first. */
export async function availablePeriods(b: BusinessCtx): Promise<string[]> {
  const rows = await query<{ k: string }>(
    `select distinct to_char(ordered_at at time zone 'UTC', 'YYYY-MM') as k from sales where business_id = $1 order by k desc`,
    [b.id],
  );
  return rows.map((r) => r.k);
}
