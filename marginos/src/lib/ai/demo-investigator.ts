/**
 * DEMO MODE investigator — used only when no Claude credentials are configured.
 * It routes the question by keywords, calls the SAME deterministic tools, and fills a
 * report from fixed templates. It is labelled "Demo mode — not live AI" everywhere it appears.
 */
import type { BusinessCtx } from "@/lib/finance/engine";
import { menuItems } from "@/lib/finance/engine";
import { period, previousPeriod } from "@/lib/finance/period";
import type { InvestigationEvent, TraceEntry } from "./investigator";
import { saveFinish } from "./investigator";
import { runTool, verifyFigures, type InvestigationReport } from "./tools";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const gbp = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : `${n < 0 ? "−" : ""}£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`);
const pct = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? "n/a" : `${n.toFixed(d)}%`);
const signedPct = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}%`);

type Intent = "profit" | "leaks" | "dishes" | "suppliers" | "billing" | "stock" | "channels" | "waste" | "labour" | "price";

function classify(q: string): Intent {
  const s = q.toLowerCase();
  if (/what (would|if)|increase the price|raise the price|price (to|of)|scenario/.test(s)) return "price";
  if (/leak|losing money/.test(s)) return "leaks";
  if (/billing|billed|overcharg|invoice.*(right|correct)|credit/.test(s)) return "billing";
  if (/stock|expir|go off|use[- ]by|fridge|shelf/.test(s)) return "stock";
  if (/waste|binned|spoil/.test(s)) return "waste";
  if (/labour|labor|staff|wage|rota|shift/.test(s)) return "labour";
  if (/supplier|ingredient|invoice|price increase|prices/.test(s)) return "suppliers";
  if (/deliver|dine|collection|channel|platform/.test(s)) return "channels";
  if (/dish|menu|item|costing me|investigate/.test(s)) return "dishes";
  return "profit";
}

export async function runDemoInvestigation(b: BusinessCtx, id: string, question: string, current: string, emit: (e: InvestigationEvent) => void, t0: number) {
  const trace: TraceEntry[] = [];
  let n = 0;
  const call = async (name: string, input: Record<string, unknown>) => {
    const tid = `demo_${++n}`;
    emit({ type: "tool_call", id: tid, name, input });
    const s = Date.now();
    const r = await runTool(b, name, input);
    const ms = Date.now() - s;
    trace.push(r.ok ? { id: tid, name, input, ok: true, result: r.result, ms } : { id: tid, name, input, ok: false, error: r.error, ms });
    emit({ type: "tool_result", id: tid, name, ok: r.ok, result: r.ok ? r.result : undefined, error: r.ok ? undefined : r.error, ms });
    if (!r.ok) throw new Error(r.error);
    return { id: tid, data: r.result as Any };
  };

  try {
    emit({ type: "status", message: "Demo mode: routing question with fixed rules (no AI)…" });
    const intent = classify(question);
    const cur = period(current);
    const prev = previousPeriod(current);
    let report: InvestigationReport;

    if (intent === "billing") {
      const c = await call("get_invoice_order_checks", { period: cur.key });
      const probs = c.data.problems as Any[];
      const issues = probs.flatMap((p: Any) => p.issues.map((i: Any) => ({ ...i, invoice: p.invoice, supplier: p.supplier })));
      report = {
        main_finding: c.data.summary.total_at_stake > 0 ? `${c.data.summary.with_discrepancies} of ${c.data.summary.invoices_checked} invoices differ from the supplier's order, with ${gbp(c.data.summary.total_at_stake)} potentially recoverable.` : "Every invoice matched its supplier order.",
        summary: `${c.data.summary.verified} invoices matched their order exactly; ${c.data.summary.without_order} had no order confirmation on file.`,
        current_period: cur.label, comparison_period: null, confidence: "high",
        findings: issues.slice(0, 6).map((i: Any) => ({ title: `${i.supplier} · ${i.invoice}`, detail: `${i.line}: ${i.detail}`, previous_value: null, current_value: null, difference: null, impact_gbp: i.at_stake ? -i.at_stake : null, confidence: "high" as const, attribution: "measured" as const, evidence_tool_ids: [c.id] })),
        data_gaps: probs.filter((p: Any) => p.status === "no_order").map((p: Any) => `${p.supplier} invoice ${p.invoice} has no order confirmation to check against.`),
        recommendations: c.data.summary.total_at_stake > 0 ? [{ action: "Ask the suppliers for a credit note", rationale: `Overcharges and over-billing total ${gbp(c.data.summary.total_at_stake)} this month.`, estimated_impact: null, effort: "low" as const }] : [],
      };
    } else if (intent === "stock") {
      const st = await call("get_stock_expiry_forecast", {});
      const over = st.data.deliveries_outlasting_shelf_life as Any[];
      report = {
        main_finding: over.length ? `${over[0].ingredient}: a usual delivery covers ${over[0].usual_delivery_days_of_use.toFixed(1)} days of use but keeps ${over[0].shelf_life_days} days, so about ${gbp(over[0].modelled_expiry_losses_last_30_days)} expired unused in the last 30 days (modelled).` : "No deliveries are larger than can be used within their shelf life.",
        summary: `Modelled stock on hand ${gbp(st.data.totals.stock_value)} as of ${st.data.as_of}; ${gbp(st.data.totals.at_risk_value)} of it is likely to expire before use.`,
        current_period: cur.label, comparison_period: null, confidence: "medium",
        findings: over.slice(0, 5).map((o: Any) => ({ title: o.ingredient, detail: `Uses ${o.daily_use.toFixed(2)} ${o.unit}/day; usual delivery = ${o.usual_delivery_days_of_use.toFixed(1)} days of use; shelf life ${o.shelf_life_days} days.`, previous_value: null, current_value: null, difference: null, impact_gbp: -o.modelled_expiry_losses_last_30_days, confidence: "medium" as const, attribution: "estimated" as const, evidence_tool_ids: [st.id] })),
        data_gaps: ["Stock is modelled from deliveries and recipe usage, not counted. A stock-take would confirm it.", "Expiry uses printed use-by dates where captured, otherwise typical shelf life."],
        recommendations: over.length ? [{ action: `Split the ${over[0].ingredient.toLowerCase()} order into two deliveries a week`, rationale: "Each delivery would then be used within its shelf life.", estimated_impact: null, effort: "low" as const }] : [],
      };
    } else if (intent === "leaks") {
      const [inv, c, st] = await Promise.all([
        call("investigate_profit_change", { current_period: cur.key }),
        call("get_invoice_order_checks", { period: cur.key }),
        call("get_stock_expiry_forecast", {}),
      ]);
      const neg = [...inv.data.contribution_bridge.effects].filter((e: Any) => e.key !== "volume" && e.impact < -50).sort((a: Any, z: Any) => a.impact - z.impact).slice(0, 3);
      const over = st.data.deliveries_outlasting_shelf_life as Any[];
      report = {
        main_finding: `The biggest measurable leaks are ${neg.map((e: Any) => `${e.label.toLowerCase()} (${gbp(e.impact)})`).join(", ")}.`,
        summary: `On top of that, ${gbp(c.data.summary.total_at_stake)} of invoice charges don't match supplier orders, and about ${gbp(st.data.totals.modelled_expiry_losses_last_30_days)} of stock expired unused in the last 30 days (modelled). These overlap with food cost and waste, so they are not added together.`,
        current_period: cur.label, comparison_period: prev.label, confidence: "medium",
        findings: [
          ...neg.map((e: Any) => ({ title: e.label, detail: `${e.basis}.`, previous_value: null, current_value: null, difference: null, impact_gbp: e.impact, confidence: e.confidence, attribution: e.attribution, evidence_tool_ids: [inv.id] })),
          ...(c.data.summary.total_at_stake > 0 ? [{ title: "Supplier billing errors", detail: `${c.data.summary.with_discrepancies} invoices differ from the order; potentially recoverable.`, previous_value: null, current_value: null, difference: null, impact_gbp: -c.data.summary.total_at_stake, confidence: "high" as const, attribution: "measured" as const, evidence_tool_ids: [c.id] }] : []),
          ...(over[0] ? [{ title: `Over-sized ${over[0].ingredient.toLowerCase()} deliveries`, detail: `Delivery covers ${over[0].usual_delivery_days_of_use.toFixed(1)} days, shelf life ${over[0].shelf_life_days} days.`, previous_value: null, current_value: null, difference: null, impact_gbp: -over[0].modelled_expiry_losses_last_30_days, confidence: "medium" as const, attribution: "estimated" as const, evidence_tool_ids: [st.id] }] : []),
        ],
        data_gaps: inv.data.data_gaps,
        recommendations: [
          { action: "Review the delivery promotion", rationale: "Discounts and the shift to delivery are the largest drags on contribution.", estimated_impact: null, effort: "low" },
          ...(c.data.summary.total_at_stake > 0 ? [{ action: "Claim supplier credits", rationale: `${gbp(c.data.summary.total_at_stake)} billed above the agreed orders.`, estimated_impact: null, effort: "low" as const }] : []),
          ...(over[0] ? [{ action: `Order ${over[0].ingredient.toLowerCase()} twice a week`, rationale: "Smaller, more frequent deliveries fit the shelf life.", estimated_impact: null, effort: "low" as const }] : []),
        ],
      };
    } else if (intent === "profit") {
      const [inv, sup, ch] = await Promise.all([
        call("investigate_profit_change", { current_period: cur.key }),
        call("get_supplier_price_changes", { current_period: cur.key, min_change_pct: 2 }),
        call("get_delivery_channel_costs", { current_period: cur.key }),
      ]);
      const h = inv.data.headline;
      const effects = [...inv.data.contribution_bridge.effects].filter((e: Any) => e.key !== "volume").sort((a: Any, z: Any) => a.impact - z.impact);
      const negatives = effects.filter((e: Any) => e.impact < -50).slice(0, 4);
      const vol = inv.data.contribution_bridge.effects.find((e: Any) => e.key === "volume");
      const findings: InvestigationReport["findings"] = [
        { title: "Sales volume", detail: `Higher sales added ${gbp(vol.impact)} of contribution at last month's margin.`, previous_value: null, current_value: null, difference: null, impact_gbp: vol.impact, confidence: "high", attribution: "measured", evidence_tool_ids: [inv.id] },
        ...negatives.map((e: Any) => ({
          title: e.label,
          detail: `${e.basis}.${e.previousRatioPct !== null ? ` Was ${pct(e.previousRatioPct)}, now ${pct(e.currentRatioPct)}.` : ""}`,
          previous_value: e.previousRatioPct !== null ? pct(e.previousRatioPct) : null,
          current_value: e.currentRatioPct !== null ? pct(e.currentRatioPct) : null,
          difference: null,
          impact_gbp: e.impact,
          confidence: e.confidence,
          attribution: e.attribution,
          evidence_tool_ids: [inv.id, ...(e.key === "ingredient_prices" ? [sup.id] : e.key.includes("delivery") || e.key === "discounts" || e.key === "commission_rate" ? [ch.id] : [])],
        })),
      ];
      const top = sup.data.changes.filter((c: Any) => c.impact_current_period < 0).slice(0, 2);
      const w = inv.data.below_contribution.waste;
      if (w.current > w.previous) findings.push({ title: "Recorded waste (below contribution)", detail: `Recorded waste rose from ${gbp(w.previous)} to ${gbp(w.current)}. Largest item: ${w.topItems[0]?.name ?? "n/a"}.`, previous_value: gbp(w.previous), current_value: gbp(w.current), difference: gbp(w.change), impact_gbp: -w.change, confidence: "high", attribution: "measured", evidence_tool_ids: [inv.id] });
      const del = ch.data.current_channels.filter((c: Any) => c.kind === "delivery").sort((a: Any, z: Any) => z.discounts - a.discounts)[0];
      const delPrev = del ? ch.data.previous_channels.find((c: Any) => c.channel === del.channel) : null;
      report = {
        main_finding: `Net revenue ${signedPct(h.netRevenue.changePct)} but contribution ${signedPct(h.contribution.changePct)} (${gbp(h.contribution.previous)} → ${gbp(h.contribution.current)}); contribution margin ${h.contributionMarginPct.changePts < 0 ? "fell" : "rose"} ${Math.abs(h.contributionMarginPct.changePts).toFixed(1)} pts.`,
        summary: `The largest measurable drags were ${negatives.slice(0, 3).map((e: Any) => `${e.label.toLowerCase()} (${gbp(e.impact)})`).join(", ")}. These effects are additive and do not overlap. ${top.length ? `${top[0].ingredient} rose from £${top[0].previous_unit_cost.toFixed(2)} to £${top[0].current_unit_cost.toFixed(2)}/${top[0].unit}.` : ""}`,
        current_period: cur.label,
        comparison_period: prev.label,
        confidence: "medium",
        findings,
        data_gaps: inv.data.data_gaps,
        recommendations: [
          ...(del && delPrev ? [{ action: `Review the ${del.channel} promotion`, rationale: `${del.channel} discounts were ${gbp(del.discounts)} vs ${gbp(delPrev.discounts)} and margin ${pct(delPrev.margin_pct)} → ${pct(del.margin_pct)}. Check whether promoted orders are incremental before renewing.`, estimated_impact: null, effort: "low" as const }] : []),
          ...(top[0] ? [{ action: `Renegotiate or re-source ${top[0].ingredient.toLowerCase()}`, rationale: `Price change ${signedPct(top[0].change_pct)} cost about ${gbp(top[0].impact_current_period)} this month across ${top[0].affected_dishes.slice(0, 2).map((d: Any) => d.dish).join(" and ")}.`, estimated_impact: null, effort: "medium" as const }] : []),
          ...(sup.data.cheaper_alternatives_seen[0] ? [{ action: `Compare ${sup.data.cheaper_alternatives_seen[0].ingredient.toLowerCase()} suppliers`, rationale: `${sup.data.cheaper_alternatives_seen[0].cheapest_supplier} was ${pct(sup.data.cheaper_alternatives_seen[0].spread_pct)} cheaper than ${sup.data.cheaper_alternatives_seen[0].main_supplier} on invoices in this window.`, estimated_impact: null, effort: "low" as const }] : []),
          { action: "Add a recipe for every item on sale", rationale: "Items without recipes are excluded from contribution and cannot be priced with confidence.", estimated_impact: null, effort: "low" },
        ],
      };
    } else if (intent === "dishes") {
      const m = await call("get_menu_item_profitability", { period: cur.key, sort_by: "contribution_per_unit_change", limit: 30 });
      const dishes = m.data.dishes as Any[];
      const declining = dishes.filter((d) => d.contribution_per_unit !== null && d.contribution_per_unit_previous_month !== null && d.contribution_per_unit < d.contribution_per_unit_previous_month).slice(0, 4);
      const hvlc = dishes.filter((d) => d.quadrant === "high_volume_low_contribution");
      const uncosted = dishes.filter((d) => d.total_contribution === null);
      report = {
        main_finding: declining.length ? `${declining[0].dish} lost the most contribution per unit: £${declining[0].contribution_per_unit_previous_month.toFixed(2)} → £${declining[0].contribution_per_unit.toFixed(2)}.` : "No dish lost contribution per unit this month.",
        summary: `${hvlc.length} high-volume dishes earn below-average contribution per unit${hvlc.length ? ` (${hvlc.map((d) => d.dish).join(", ")})` : ""}. ${uncosted.length ? `${uncosted.map((d) => d.dish).join(", ")} cannot be assessed without a recipe cost.` : ""}`,
        current_period: cur.label,
        comparison_period: prev.label,
        confidence: "high",
        findings: declining.map((d) => ({ title: d.dish, detail: `Recipe cost £${d.recipe_cost_previous_month?.toFixed(2) ?? "n/a"} → £${d.recipe_cost?.toFixed(2) ?? "n/a"}; ${d.units} sold; margin ${pct(d.margin_pct)}.`, previous_value: `£${d.contribution_per_unit_previous_month.toFixed(2)}/unit`, current_value: `£${d.contribution_per_unit.toFixed(2)}/unit`, difference: null, impact_gbp: null, confidence: "high" as const, attribution: "measured" as const, evidence_tool_ids: [m.id] })),
        data_gaps: uncosted.map((d) => `${d.dish}: ${d.recipe_status}`),
        recommendations: hvlc.slice(0, 2).map((d) => ({ action: `Re-cost ${d.dish}`, rationale: `High volume (${d.units} units) at ${pct(d.margin_pct)} margin. Test a price scenario or portion change.`, estimated_impact: null, effort: "medium" as const })),
      };
    } else if (intent === "suppliers") {
      const s = await call("get_supplier_price_changes", { current_period: cur.key, min_change_pct: 1 });
      const ups = (s.data.changes as Any[]).filter((c) => c.change_pct > 0).slice(0, 5);
      const alt = s.data.cheaper_alternatives_seen as Any[];
      report = {
        main_finding: ups.length ? `${ups[0].ingredient} had the largest cost impact: £${ups[0].previous_unit_cost.toFixed(2)} → £${ups[0].current_unit_cost.toFixed(2)}/${ups[0].unit} (${signedPct(ups[0].change_pct)}), about ${gbp(ups[0].impact_current_period)} this month.` : "No ingredient price increases found.",
        summary: `Total ingredient price impact at current usage: ${gbp(s.data.total_ingredient_price_impact)}.`,
        current_period: cur.label,
        comparison_period: prev.label,
        confidence: "high",
        findings: ups.map((c) => ({ title: `${c.ingredient} (${c.suppliers.join(", ")})`, detail: `Affects ${c.affected_dishes.map((d: Any) => d.dish).slice(0, 3).join(", ")}.`, previous_value: `£${c.previous_unit_cost.toFixed(2)}/${c.unit}`, current_value: `£${c.current_unit_cost.toFixed(2)}/${c.unit}`, difference: signedPct(c.change_pct), impact_gbp: c.impact_current_period, confidence: "high" as const, attribution: "measured" as const, evidence_tool_ids: [s.id] })),
        data_gaps: [],
        recommendations: alt.slice(0, 2).map((a) => ({ action: `Quote ${a.ingredient.toLowerCase()} from ${a.cheapest_supplier}`, rationale: `${pct(a.spread_pct)} cheaper than ${a.main_supplier} on recent invoices.`, estimated_impact: null, effort: "low" as const })),
      };
    } else if (intent === "channels") {
      const c = await call("get_delivery_channel_costs", { current_period: cur.key });
      const rows = c.data.current_channels as Any[];
      const best = [...rows].sort((a, z) => (z.margin_pct ?? -1) - (a.margin_pct ?? -1));
      report = {
        main_finding: `${best[0].channel} earns the highest contribution margin (${pct(best[0].margin_pct)}); ${best[best.length - 1].channel} the lowest (${pct(best[best.length - 1].margin_pct)}).`,
        summary: rows.map((r) => `${r.channel}: ${gbp(r.contribution)} contribution, ${gbp(r.contribution_per_order)} per order`).join("; ") + ".",
        current_period: cur.label,
        comparison_period: prev.label,
        confidence: "high",
        findings: rows.map((r) => {
          const p = (c.data.previous_channels as Any[]).find((x) => x.channel === r.channel);
          return { title: r.channel, detail: `Discounts ${gbp(r.discounts)}, commission & fees ${gbp(r.commission_and_fees)}${r.of_which_estimated > 0 ? ` (${gbp(r.of_which_estimated)} estimated)` : ""}, packaging ${gbp(r.packaging)}.`, previous_value: p ? pct(p.margin_pct) : null, current_value: pct(r.margin_pct), difference: null, impact_gbp: null, confidence: (r.of_which_estimated > 0 ? "medium" : "high") as "medium" | "high", attribution: "measured" as const, evidence_tool_ids: [c.id] };
        }),
        data_gaps: rows.filter((r) => r.of_which_estimated > 0).map((r) => `${r.channel} commission partly estimated — settlement not yet imported.`),
        recommendations: [{ action: "Compare promoted vs non-promoted delivery orders", rationale: "Discounts and commission together decide whether delivery growth adds contribution.", estimated_impact: null, effort: "low" }],
      };
    } else if (intent === "waste") {
      const w = await call("get_food_waste_analysis", { period: cur.key });
      const c = w.data.current, p = w.data.previous;
      report = {
        main_finding: `Recorded waste cost ${gbp(c.total_cost)} in ${c.period} vs ${gbp(p.total_cost)} in ${p.period}.`,
        summary: `Largest: ${c.top_items.slice(0, 3).map((i: Any) => `${i.name} (${gbp(i.cost)})`).join(", ")}.`,
        current_period: cur.label,
        comparison_period: prev.label,
        confidence: c.uncosted_records ? "medium" : "high",
        findings: c.by_reason.slice(0, 4).map((r: Any) => ({ title: r.reason.replace("_", " "), detail: `${r.records} records`, previous_value: null, current_value: gbp(r.cost), difference: null, impact_gbp: -r.cost, confidence: "high", attribution: "measured", evidence_tool_ids: [w.id] })),
        data_gaps: c.uncosted_records ? [`${c.uncosted_records} waste records could not be costed.`] : [],
        recommendations: [{ action: `Tighten ordering and prep for ${c.top_items[0]?.name ?? "top items"}`, rationale: "Highest recorded waste cost this month.", estimated_impact: null, effort: "low" }],
      };
    } else if (intent === "labour") {
      const l = await call("get_labour_cost_analysis", { period: cur.key });
      if (!l.data.current) {
        report = { main_finding: l.data.note, summary: "Import a rota or timesheet export in the Data Centre.", current_period: cur.label, comparison_period: null, confidence: "low", findings: [], data_gaps: [l.data.note], recommendations: [] };
      } else {
        const c = l.data.current, p = l.data.previous;
        report = {
          main_finding: `Wage cost ${gbp(c.wage_cost)} (${pct(c.wage_pct_of_revenue)} of net revenue) vs ${gbp(p.wage_cost)} (${pct(p.wage_pct_of_revenue)}).`,
          summary: `Largest roles: ${c.by_role.slice(0, 3).map((r: Any) => `${r.role} ${gbp(r.cost)}`).join(", ")}. Excludes employer NI and pension.`,
          current_period: cur.label,
          comparison_period: prev.label,
          confidence: "high",
          findings: c.flagged_days.slice(0, 4).map((d: Any) => ({ title: `High wage % on ${d.day}`, detail: `${d.hours.toFixed(1)} hours`, previous_value: null, current_value: pct(d.labourPct), difference: null, impact_gbp: null, confidence: "high", attribution: "measured", evidence_tool_ids: [l.id] })),
          data_gaps: ["Wage cost excludes employer NI and pension."],
          recommendations: [{ action: "Review rota on the flagged days", rationale: "Wage cost % was well above the monthly average.", estimated_impact: null, effort: "medium" }],
        };
      }
    } else {
      const items = await menuItems(b);
      const s = question.toLowerCase();
      const item = items.find((i) => s.includes(i.name.toLowerCase())) ?? items.find((i) => i.name.toLowerCase().split(/\s+/).filter((w) => w.length > 4).some((w) => s.includes(w))) ?? items.find((i) => i.name.includes("Chicken Burger"))!;
      const m = question.match(/£\s?(\d+(?:\.\d{1,2})?)/);
      const newPrice = m ? Number(m[1]) : item.priceGross + 1;
      const r = await call("calculate_price_scenario", { period: cur.key, menu_item_name: item.name, new_price_gross: newPrice, channel: /deliver/.test(s) ? "delivery" : "dine_in", demand_change_pct: 0 });
      const d = r.data;
      if (!d.ok) {
        report = { main_finding: d.reason ?? d.error, summary: "", current_period: cur.label, comparison_period: null, confidence: "low", findings: [], data_gaps: [d.reason ?? d.error], recommendations: [] };
      } else {
        report = {
          main_finding: `At £${d.newPriceGross.toFixed(2)}, ${d.item} (${d.channel.replace("_", "-")}) would earn £${d.contributionPerUnitAfter.toFixed(2)} contribution per unit vs £${d.contributionPerUnitBefore.toFixed(2)} — ${gbp(d.change)} a month at unchanged volume.`,
          summary: d.breakEvenDemandChangePct !== null ? `Volume could fall ${Math.abs(d.breakEvenDemandChangePct).toFixed(1)}% before the change stops paying off.` : "",
          current_period: cur.label,
          comparison_period: null,
          confidence: "medium",
          findings: [{ title: "Price scenario", detail: `Based on ${d.unitsBefore} units sold in ${d.period}, food cost £${d.assumptions.foodCostPerUnit.toFixed(2)}/unit.`, previous_value: `£${d.currentPriceGross.toFixed(2)}`, current_value: `£${d.newPriceGross.toFixed(2)}`, difference: null, impact_gbp: d.change, confidence: "medium", attribution: "estimated", evidence_tool_ids: [r.id] }],
          data_gaps: ["Demand response to a price change is an assumption (0% by default)."],
          recommendations: [{ action: "Trial the price for 4 weeks and compare unit sales", rationale: "The break-even volume tells you how much demand you can afford to lose.", estimated_impact: null, effort: "low" }],
        };
      }
    }

    const verification = verifyFigures(report, trace.filter((t) => t.ok).map((t) => t.result));
    emit({ type: "report", report, verification });
    const durationMs = Date.now() - t0;
    await saveFinish(b, id, { status: "completed", report, trace, verification, durationMs });
    emit({ type: "done", investigationId: id, durationMs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "error", message });
    await saveFinish(b, id, { status: "failed", trace, error: message, durationMs: Date.now() - t0 });
  }
}
