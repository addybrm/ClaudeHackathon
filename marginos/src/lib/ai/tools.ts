/**
 * Investigator tools. Each tool is a thin, validated wrapper around the deterministic
 * financial engine. Claude chooses which tools to call; the numbers always come from here.
 */
import { z } from "zod";
import type { BusinessCtx, ChannelKind } from "@/lib/finance/engine";
import * as engine from "@/lib/finance/engine";
import { isPeriodKey, period, previousPeriod } from "@/lib/finance/period";
import * as ops from "@/lib/finance/operations";

const periodKey = z.string().refine(isPeriodKey, "Period must be YYYY-MM");
const channel = z.enum(["all", "dine_in", "collection", "delivery"]);

/** Round all numbers (3 dp) so tool output is compact while percentages still round consistently with the UI. */
function compact<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "number" ? Math.round(x * 1000) / 1000 : x)));
}

type ToolDef = {
  name: string;
  description: string;
  schema: z.ZodType;
  input_schema: Record<string, unknown>;
  run: (b: BusinessCtx, input: never) => Promise<unknown>;
};

const P = (description: string) => ({ type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$", description });

export const TOOLS: ToolDef[] = [
  {
    name: "get_sales_comparison",
    description: "Headline P&L lines for two monthly periods: orders, gross sales, discounts, refunds, net revenue (ex VAT), food cost, packaging, platform commission, contribution, contribution margin %, recorded waste and wage cost. Use first to establish what changed.",
    schema: z.object({ current_period: periodKey, previous_period: periodKey.optional() }),
    input_schema: { type: "object", properties: { current_period: P("Month to analyse, YYYY-MM"), previous_period: P("Comparison month, defaults to the month before") }, required: ["current_period"], additionalProperties: false },
    run: async (b, i: { current_period: string; previous_period?: string }) => {
      const cur = period(i.current_period);
      const prev = i.previous_period ? period(i.previous_period) : previousPeriod(i.current_period);
      const [c, p] = await Promise.all([engine.periodSummary(b, cur), engine.periodSummary(b, prev)]);
      const pick = (s: engine.PeriodSummary) => ({
        period: s.period.label, orders: s.orders, gross_sales_ex_vat: s.grossSales, discounts: s.discounts, refunds: s.refunds, net_revenue: s.netRevenue,
        food_cost: s.foodCost, packaging: s.packaging, platform_commission: s.commission, commission_estimated_share_pct: s.commissionEstimatedShare * 100,
        contribution: s.contribution, contribution_margin_pct: s.contributionMarginPct, gross_margin_pct: s.grossMarginPct,
        net_revenue_without_recipe_cost: s.revenueWithoutRecipeCost, recorded_waste_cost: s.waste.totalCost, wage_cost: s.labour.totalCost,
        contribution_after_waste_and_wages: s.contributionAfterWasteLabour,
      });
      const a = pick(c), z0 = pick(p);
      const changes: Record<string, { change: number; change_pct: number | null }> = {};
      for (const k of ["net_revenue", "contribution", "food_cost", "platform_commission", "discounts", "recorded_waste_cost", "wage_cost"] as const) {
        const cv = a[k] as number, pv = z0[k] as number;
        changes[k] = { change: cv - pv, change_pct: pv ? ((cv - pv) / Math.abs(pv)) * 100 : null };
      }
      return { definitions: "All amounts GBP ex VAT. Contribution = net revenue − food cost − packaging − platform commission. Not net profit.", current: a, previous: z0, changes, contribution_margin_change_pts: a.contribution_margin_pct !== null && z0.contribution_margin_pct !== null ? a.contribution_margin_pct - z0.contribution_margin_pct : null };
    },
  },
  {
    name: "get_menu_item_profitability",
    description: "Per-dish profitability for a month: price, recipe cost, packaging, commission and discounts allocated to the dish, units, contribution per unit, margin %, total contribution, change vs previous month, and menu-engineering quadrant. Optionally filter to one channel or one dish.",
    schema: z.object({ period: periodKey, channel: channel.optional(), sort_by: z.enum(["total_contribution", "contribution_per_unit", "margin_pct", "units", "contribution_per_unit_change"]).optional(), limit: z.number().int().min(1).max(30).optional(), item_name: z.string().optional() }),
    input_schema: {
      type: "object",
      properties: {
        period: P("Month, YYYY-MM"),
        channel: { type: "string", enum: ["all", "dine_in", "collection", "delivery"], description: "Default all" },
        sort_by: { type: "string", enum: ["total_contribution", "contribution_per_unit", "margin_pct", "units", "contribution_per_unit_change"], description: "Sort ascending for margin/contribution (worst first); units descending. Default total_contribution ascending." },
        limit: { type: "integer", minimum: 1, maximum: 30 },
        item_name: { type: "string", description: "Case-insensitive substring to select specific dishes" },
      },
      required: ["period"],
      additionalProperties: false,
    },
    run: async (b, i: { period: string; channel?: "all" | ChannelKind; sort_by?: string; limit?: number; item_name?: string }) => {
      const res = await engine.menuProfitability(b, period(i.period));
      const ch = i.channel ?? "all";
      let rows = res.items.map((it) => {
        const l = ch === "all" ? it.total : it.byChannel[ch];
        return {
          dish: it.name, category: it.category, in_house_price_gross: it.priceGross, delivery_price_gross: it.deliveryPriceGross,
          recipe_cost: it.recipeCost, recipe_cost_previous_month: it.previous?.recipeCost ?? null, recipe_status: !it.hasRecipe ? "no recipe" : it.recipeComplete ? (it.recipeEstimated ? "complete (includes estimated costs)" : "complete") : `incomplete: ${it.missingCosts.join(", ")}`,
          packaging_per_unit: it.packagingCost, units: l.units, net_revenue: l.netRevenue, discounts: l.discounts, commission: l.commission,
          contribution_per_unit: l.contributionPerUnit, contribution_per_unit_previous_month: ch === "all" ? it.previous?.contributionPerUnit ?? null : null,
          margin_pct: l.marginPct, total_contribution: l.contribution, quadrant: it.quadrant,
        };
      });
      if (i.item_name) rows = rows.filter((r) => r.dish.toLowerCase().includes(i.item_name!.toLowerCase()));
      const sort = i.sort_by ?? "total_contribution";
      const v = (r: (typeof rows)[number]) =>
        sort === "units" ? -r.units : sort === "margin_pct" ? r.margin_pct ?? Infinity : sort === "contribution_per_unit" ? r.contribution_per_unit ?? Infinity :
        sort === "contribution_per_unit_change" ? (r.contribution_per_unit !== null && r.contribution_per_unit_previous_month !== null ? r.contribution_per_unit - r.contribution_per_unit_previous_month : Infinity) : r.total_contribution ?? Infinity;
      rows.sort((a, z0) => v(a) - v(z0));
      return { period: res.period.label, channel: ch, quadrant_thresholds: { units: res.thresholds.volume, contribution_per_unit: res.thresholds.contribution }, dishes: rows.slice(0, i.limit ?? 30) };
    },
  },
  {
    name: "get_supplier_price_changes",
    description: "Ingredient unit-cost changes between two months from supplier invoices (quantity-weighted), with the estimated contribution impact = current usage × price change, the dishes affected, and the invoice lines that evidence each price. Also returns cases where the same ingredient was bought cheaper from another supplier in the current month.",
    schema: z.object({ current_period: periodKey, previous_period: periodKey.optional(), min_change_pct: z.number().optional() }),
    input_schema: { type: "object", properties: { current_period: P("Month, YYYY-MM"), previous_period: P("Comparison month"), min_change_pct: { type: "number", description: "Only include ingredients whose absolute change is at least this %, default 1" } }, required: ["current_period"], additionalProperties: false },
    run: async (b, i: { current_period: string; previous_period?: string; min_change_pct?: number }) => {
      const cur = period(i.current_period);
      const prev = i.previous_period ? period(i.previous_period) : previousPeriod(i.current_period);
      const res = await engine.supplierPriceChanges(b, cur, prev);
      const min = i.min_change_pct ?? 1;
      const comp = await engine.supplierComparison(b, cur.start, cur.end);
      return {
        current: cur.label, previous: prev.label,
        total_ingredient_price_impact: res.totalImpact,
        note: "Impact is negative when higher prices reduce contribution. Price = weighted average invoice price in the month.",
        changes: res.changes.filter((c) => c.changePct !== null && Math.abs(c.changePct) >= min).map((c) => ({
          ingredient: c.ingredient, unit: c.baseUnit, suppliers: c.suppliers, previous_unit_cost: c.previousUnitCost, current_unit_cost: c.currentUnitCost, change_pct: c.changePct,
          usage_current_period: c.usageCurrent, impact_current_period: c.impactCurrentPeriod,
          affected_dishes: c.affectedDishes.filter((d) => d.unitsSold > 0).slice(0, 5).map((d) => ({ dish: d.name, units_sold: d.unitsSold, cost_change_per_unit: d.costChangePerUnit, impact: d.impact })),
          invoice_evidence: c.invoiceEvidence.slice(-4).map((e) => ({ invoice: e.invoiceNumber, supplier: e.supplier, date: e.date, unit_price: e.unitPrice, quantity: e.quantity })),
        })),
        cheaper_alternatives_seen: comp.filter((c) => c.potentialSaving > 0).map((c) => ({ ingredient: c.ingredient, unit: c.baseUnit, main_supplier: c.mainSupplier, cheapest_supplier: c.cheapestSupplier, spread_pct: c.spreadPct, suppliers: c.suppliers, saving_if_all_bought_at_cheapest: c.potentialSaving })),
      };
    },
  },
  {
    name: "get_delivery_channel_costs",
    description: "Contribution by sales channel (dine-in, collection, each delivery platform) for two months: orders, average order value, net revenue, discounts, refunds, platform commission and fees (actual vs estimated), packaging, food cost, contribution, margin % and contribution per order.",
    schema: z.object({ current_period: periodKey, previous_period: periodKey.optional() }),
    input_schema: { type: "object", properties: { current_period: P("Month, YYYY-MM"), previous_period: P("Comparison month") }, required: ["current_period"], additionalProperties: false },
    run: async (b, i: { current_period: string; previous_period?: string }) => {
      const cur = period(i.current_period);
      const prev = i.previous_period ? period(i.previous_period) : previousPeriod(i.current_period);
      const [c, p] = await Promise.all([engine.channelAnalysis(b, cur), engine.channelAnalysis(b, prev)]);
      const map = (r: engine.ChannelResult) => ({ channel: r.channel, kind: r.kind, orders: r.orders, avg_order_value_gross: r.avgOrderValueGross, net_revenue: r.netRevenue, discounts: r.discounts, refunds: r.refunds, commission_and_fees: r.commission, of_which_estimated: r.commissionEstimated, packaging: r.packaging, food_cost: r.foodCost, contribution: r.contribution, margin_pct: r.marginPct, contribution_per_order: r.contributionPerOrder, revenue_excluded_no_recipe_cost: r.uncostedRevenue });
      return { current: cur.label, previous: prev.label, current_channels: c.map(map), previous_channels: p.map(map) };
    },
  },
  {
    name: "get_food_waste_analysis",
    description: "Recorded food waste for a month and the month before: total cost, by reason, by ingredient/dish, plus records that could not be costed. Waste cost = quantity × ingredient unit cost (dishes: portions × recipe cost).",
    schema: z.object({ period: periodKey }),
    input_schema: { type: "object", properties: { period: P("Month, YYYY-MM") }, required: ["period"], additionalProperties: false },
    run: async (b, i: { period: string }) => {
      const cur = period(i.period);
      const prev = previousPeriod(i.period);
      const [mc, mp] = await Promise.all([engine.loadPeriod(b, cur), engine.loadPeriod(b, prev)]);
      const [c, p] = await Promise.all([engine.wasteSummary(mc), engine.wasteSummary(mp)]);
      const strip = (w: engine.WasteSummary) => ({ records: w.records, total_cost: w.totalCost, uncosted_records: w.uncostedRecords, by_reason: w.byReason, top_items: w.byItem.slice(0, 8) });
      return { current: { period: cur.label, ...strip(c) }, previous: { period: prev.label, ...strip(p) }, change: c.totalCost - p.totalCost, note: c.records === 0 ? "No waste records for this period." : undefined };
    },
  },
  {
    name: "get_labour_cost_analysis",
    description: "Wage cost (hours × rate, excluding employer NI and pension) for a month: total, hours, by role, by weekday, wage cost as % of net revenue, and days where wage cost % was unusually high.",
    schema: z.object({ period: periodKey }),
    input_schema: { type: "object", properties: { period: P("Month, YYYY-MM") }, required: ["period"], additionalProperties: false },
    run: async (b, i: { period: string }) => {
      const cur = period(i.period);
      const prev = previousPeriod(i.period);
      const [c, p] = await Promise.all([engine.labourAnalysis(b, cur), engine.labourAnalysis(b, prev)]);
      if (c.records === 0) return { period: cur.label, note: "No labour records for this period — wage cost cannot be analysed." };
      return {
        current: { period: cur.label, wage_cost: c.totalCost, hours: c.totalHours, net_revenue: c.revenue, wage_pct_of_revenue: c.labourPctOfRevenue, by_role: c.byRole, by_weekday: c.byWeekday, flagged_days: c.flaggedDays },
        previous: { period: prev.label, wage_cost: p.totalCost, hours: p.totalHours, net_revenue: p.revenue, wage_pct_of_revenue: p.labourPctOfRevenue, by_role: p.byRole },
      };
    },
  },
  {
    name: "investigate_profit_change",
    description: "The profit-leak investigation. Decomposes the change in contribution between two months into additive, non-overlapping effects (sales volume, ingredient prices, menu mix, discounts, refunds, delivery mix, commission rate, packaging), with confidence per effect, then reports waste and wage changes below contribution, top ingredient increases, channel results and data gaps. Use for any 'why did profit/margin change' question.",
    schema: z.object({ current_period: periodKey, previous_period: periodKey.optional() }),
    input_schema: { type: "object", properties: { current_period: P("Month, YYYY-MM"), previous_period: P("Comparison month") }, required: ["current_period"], additionalProperties: false },
    run: async (b, i: { current_period: string; previous_period?: string }) => {
      const r = await engine.investigateProfitChange(b, i.current_period, i.previous_period);
      const billing = await ops.invoiceChecks(b, r.current.start, r.current.end);
      return {
        supplier_billing_checks: { note: "Invoices compared with supplier order confirmations. Money at stake may be recoverable as supplier credit; it is already inside food cost, not an extra effect.", invoices_checked: billing.summary.invoices, with_discrepancies: billing.summary.discrepancies, without_order: billing.summary.noOrder, at_stake: billing.summary.atStake },
        current: r.current.label, previous: r.previous.label, headline: r.headline, contribution_bridge: r.contributionBridge,
        below_contribution: r.belowContribution, top_ingredient_increases: r.topIngredientIncreases,
        channels_current: r.channels.current.map((c) => ({ channel: c.channel, contribution: c.contribution, margin_pct: c.marginPct, net_revenue: c.netRevenue, discounts: c.discounts, commission_and_fees: c.commission })),
        channels_previous: r.channels.previous.map((c) => ({ channel: c.channel, contribution: c.contribution, margin_pct: c.marginPct, net_revenue: c.netRevenue, discounts: c.discounts, commission_and_fees: c.commission })),
        data_gaps: r.dataGaps,
      };
    },
  },
  {
    name: "calculate_price_scenario",
    description: "What-if for changing one dish's price on one channel: contribution per unit before/after, total contribution at an assumed demand change, and the volume drop that would make the change break even. Uses the dish's real recipe cost and the channel's actual commission and discount rates.",
    schema: z.object({ period: periodKey, menu_item_name: z.string().min(2), new_price_gross: z.number().positive().max(500), channel: z.enum(["dine_in", "collection", "delivery"]), demand_change_pct: z.number().min(-100).max(200).optional() }),
    input_schema: {
      type: "object",
      properties: {
        period: P("Month whose volumes and costs to use, YYYY-MM"),
        menu_item_name: { type: "string", description: "Dish name (substring match)" },
        new_price_gross: { type: "number", description: "New VAT-inclusive menu price in GBP" },
        channel: { type: "string", enum: ["dine_in", "collection", "delivery"] },
        demand_change_pct: { type: "number", description: "Assumed % change in units sold, default 0. State this as an assumption." },
      },
      required: ["period", "menu_item_name", "new_price_gross", "channel"],
      additionalProperties: false,
    },
    run: async (b, i: { period: string; menu_item_name: string; new_price_gross: number; channel: ChannelKind; demand_change_pct?: number }) => {
      const items = await engine.menuItems(b);
      const matches = items.filter((m) => m.name.toLowerCase().includes(i.menu_item_name.toLowerCase()));
      if (matches.length === 0) return { error: `No dish matches "${i.menu_item_name}". Available: ${items.map((m) => m.name).join(", ")}` };
      if (matches.length > 1 && !matches.some((m) => m.name.toLowerCase() === i.menu_item_name.toLowerCase())) return { error: `Ambiguous dish name; matches: ${matches.map((m) => m.name).join(", ")}` };
      const item = matches.find((m) => m.name.toLowerCase() === i.menu_item_name.toLowerCase()) ?? matches[0];
      return engine.priceScenarioForItem(b, period(i.period), { menuItemId: item.id, newPriceGross: i.new_price_gross, channel: i.channel, demandChangePct: i.demand_change_pct ?? 0 });
    },
  },
];

TOOLS.push(
  {
    name: "get_invoice_order_checks",
    description: "Checks every supplier invoice in a month against the supplier's order confirmation: overcharges (price above agreed), billed quantity above the order, short deliveries, lines not on the order, and invoices with no order on file. Returns the money at stake per discrepancy (potentially claimable as supplier credit).",
    schema: z.object({ period: periodKey }),
    input_schema: { type: "object", properties: { period: P("Month, YYYY-MM") }, required: ["period"], additionalProperties: false },
    run: async (b, i: { period: string }) => {
      const p = period(i.period);
      const r = await ops.invoiceChecks(b, p.start, p.end);
      return {
        period: p.label,
        summary: { invoices_checked: r.summary.invoices, verified: r.summary.verified, with_discrepancies: r.summary.discrepancies, without_order: r.summary.noOrder, total_at_stake: r.summary.atStake, by_issue: r.summary.byCode },
        problems: r.checks.filter((c) => c.status !== "verified").map((c) => ({
          invoice: c.invoiceNumber, supplier: c.supplier, date: c.date, order: c.matchedOrder, status: c.status, at_stake: c.atStake,
          issues: c.lines.flatMap((l) => l.issues.map((x) => ({ line: l.description, issue: x.code, detail: x.text, at_stake: x.atStake }))),
          ordered_but_not_invoiced: c.missingFromInvoice.map((m) => m.description),
        })),
      };
    },
  },
  {
    name: "get_stock_expiry_forecast",
    description: "Models stock on hand from recent deliveries and expiry dates (printed, or delivery date + shelf life), using daily usage derived from recipes × sales over the last 28 days, first-expiry-first-out. Returns stock value, stock likely to expire unused, modelled expiry losses in the last 30 days (compare with recorded waste), and ingredients whose usual delivery is larger than can be used within its shelf life. A model, not a stock count.",
    schema: z.object({}),
    input_schema: { type: "object", properties: {}, additionalProperties: false },
    run: async (b) => {
      const st = await ops.stockForecast(b);
      if (!st) return { note: "No sales data, so daily usage cannot be estimated." };
      return {
        as_of: st.asOf,
        totals: { stock_value: st.totals.stockValue, at_risk_value: st.totals.atRiskValue, modelled_expiry_losses_last_30_days: st.totals.expiredLast30Value, ingredients_expiring_within_3_days: st.totals.expiringIn3Days },
        deliveries_outlasting_shelf_life: st.overOrdered.map((r) => ({ ingredient: r.ingredient, usual_delivery_days_of_use: r.typicalDeliveryDays, shelf_life_days: r.shelfLifeDays, daily_use: r.dailyUse, unit: r.baseUnit, modelled_expiry_losses_last_30_days: r.expiredLast30Value })),
        top_items: st.rows.slice(0, 10).map((r) => ({ ingredient: r.ingredient, storage: r.storage, on_hand: r.onHand, unit: r.baseUnit, days_cover: r.daysCover, next_expiry: r.nextExpiry, at_risk_value: r.atRiskValue, modelled_expiry_losses_last_30_days: r.expiredLast30Value })),
      };
    },
  },
);

export const TOOL_NAMES = TOOLS.map((t) => t.name);

export async function runTool(b: BusinessCtx, name: string, input: unknown): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { ok: false, error: `Unknown tool ${name}` };
  const parsed = t.schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  try {
    return { ok: true, result: compact(await t.run(b, parsed.data as never)) };
  } catch (err) {
    console.error(`[tool] ${name} failed`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Final structured report
// ---------------------------------------------------------------------------

export const ReportSchema = z.object({
  main_finding: z.string().min(5),
  summary: z.string().min(5),
  current_period: z.string(),
  comparison_period: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
  findings: z.array(z.object({
    title: z.string(),
    detail: z.string(),
    previous_value: z.string().nullable(),
    current_value: z.string().nullable(),
    difference: z.string().nullable(),
    impact_gbp: z.number().nullable(),
    confidence: z.enum(["high", "medium", "low"]),
    attribution: z.enum(["measured", "estimated", "correlation"]),
    evidence_tool_ids: z.array(z.string()),
  })).max(8),
  data_gaps: z.array(z.string()),
  recommendations: z.array(z.object({
    action: z.string(),
    rationale: z.string(),
    estimated_impact: z.string().nullable(),
    effort: z.enum(["low", "medium", "high"]),
  })).max(6),
});
export type InvestigationReport = z.infer<typeof ReportSchema>;

export const REPORT_TOOL = {
  name: "submit_investigation_report",
  description: "Submit the final structured investigation. Call exactly once, after gathering evidence with the data tools. Every figure must be copied from a tool result; cite the tool_use ids that contain the evidence.",
  input_schema: {
    type: "object",
    properties: {
      main_finding: { type: "string", description: "One sentence answer to the owner's question, with the key figures" },
      summary: { type: "string", description: "2–4 sentence plain-English explanation" },
      current_period: { type: "string" },
      comparison_period: { type: ["string", "null"] },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      findings: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            detail: { type: "string" },
            previous_value: { type: ["string", "null"] },
            current_value: { type: ["string", "null"] },
            difference: { type: ["string", "null"] },
            impact_gbp: { type: ["number", "null"], description: "£ effect on contribution for the current period (negative = reduces contribution), copied from a tool result" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            attribution: { type: "string", enum: ["measured", "estimated", "correlation"] },
            evidence_tool_ids: { type: "array", items: { type: "string" } },
          },
          required: ["title", "detail", "previous_value", "current_value", "difference", "impact_gbp", "confidence", "attribution", "evidence_tool_ids"],
          additionalProperties: false,
        },
      },
      data_gaps: { type: "array", items: { type: "string" } },
      recommendations: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          properties: { action: { type: "string" }, rationale: { type: "string" }, estimated_impact: { type: ["string", "null"] }, effort: { type: "string", enum: ["low", "medium", "high"] } },
          required: ["action", "rationale", "estimated_impact", "effort"],
          additionalProperties: false,
        },
      },
    },
    required: ["main_finding", "summary", "current_period", "comparison_period", "confidence", "findings", "data_gaps", "recommendations"],
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Figure verification: every £/% figure in the report should appear in a tool result.
// ---------------------------------------------------------------------------

export function verifyFigures(report: InvestigationReport, toolResults: unknown[]) {
  const pool: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "number") pool.push(v);
    // Figures quoted inside tool-result text (e.g. "agreed £8.75") are evidence too.
    else if (typeof v === "string") for (const m of v.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) pool.push(Number(m[0].replace(/,/g, "")));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  toolResults.forEach(walk);
  // Differences between two quoted figures are legitimate derived numbers.
  const text = [report.main_finding, report.summary, ...report.findings.flatMap((f) => [f.title, f.detail, f.previous_value, f.current_value, f.difference]), ...report.recommendations.flatMap((r) => [r.action, r.rationale, r.estimated_impact])].filter(Boolean).join(" \n ");
  const figures = [...text.matchAll(/(£\s?-?[\d,]+(?:\.\d+)?k?|-?[\d,]+(?:\.\d+)?\s?%|-?[\d,]+(?:\.\d+)?\s?(?:pts|pp|percentage points))/gi)].map((m) => m[0]);
  const parse = (s: string) => {
    let n = Number(s.replace(/[£,%\s]|pts|pp|percentage points/gi, "").replace(/k$/i, ""));
    if (/k$/i.test(s.trim())) n *= 1000;
    return Math.abs(n);
  };
  const absPool = pool.map(Math.abs);
  const matches = (n: number) => {
    const tol = Math.max(0.6, n * 0.006); // allow rounding to whole pounds / one decimal
    return absPool.some((p) => Math.abs(p - n) <= tol) || absPool.some((a) => absPool.some((c) => Math.abs(Math.abs(a - c) - n) <= tol && n > 1));
  };
  const unverified = [...new Set(figures)].filter((f) => {
    const n = parse(f);
    if (!Number.isFinite(n) || n === 0) return false;
    return !matches(n);
  });
  for (const f of report.findings) if (f.impact_gbp !== null && !matches(Math.abs(f.impact_gbp))) unverified.push(`£${f.impact_gbp}`);
  return { figuresChecked: figures.length, unverified: [...new Set(unverified)] };
}
