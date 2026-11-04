"""Profitability report (Module I, FR16): JSON for the UI and Markdown for download/printing."""
from datetime import datetime
from . import analytics as A


def recommendations(snap: A.Snapshot, p: A.Period) -> list[dict]:
    """Deterministic, rule-based recommendations with the figure that triggered each one."""
    recs = []
    for c in A.supplier_comparison(snap, p)[:2]:
        if c["potential_saving_in_period"] > 0:
            recs.append({"area": "Suppliers", "action": f"Ask {c['current_supplier']} to match {c['cheapest_supplier']}'s "
                         f"£{c['offers'][0]['unit_price']:.2f}/{c['unit']} for {c['name'].lower()}, or switch.",
                         "estimated_impact": c["potential_saving_in_period"], "basis": "saving over this period's purchased volume"})
    for d in sorted((d for d in A.menu(snap, p)["dishes"] if d["status"] != "healthy"), key=lambda d: -d["food_cost_pct"])[:3]:
        gain = round((d["suggested_price_for_target"] - d["selling_price"]) * d["units_sold"], 2)
        recs.append({"area": "Menu", "action": f"Reprice {d['name']} from £{d['selling_price']:.2f} towards £{d['suggested_price_for_target']:.2f} "
                     f"or reduce portion cost (food cost {d['food_cost_pct']}%).", "estimated_impact": gain,
                     "basis": "price gap x units sold this period, assuming unchanged demand"})
    leak = A.leakage(snap, p)
    var = leak["categories"][1]["items"]
    if var:
        recs.append({"area": "Kitchen", "action": f"Audit portioning and deliveries for {var[0]['name'].lower()}.",
                     "estimated_impact": var[0]["amount"], "basis": "purchases above recipe usage plus recorded waste"})
    ws = A.waste_summary(snap, p)
    if ws["top_ingredients"]:
        t = ws["top_ingredients"][0]
        recs.append({"area": "Waste", "action": t["suggestion"], "estimated_impact": t["cost"], "basis": "recorded waste cost this period"})
    return recs


def build(snap: A.Snapshot, p: A.Period) -> dict:
    menu = A.menu(snap, p)["dishes"]
    return {
        "title": f"Profitability report: {snap.restaurant.name}",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "period": A._period_meta(snap, p),
        "is_demo_data": snap.restaurant.is_demo,
        "summary": A.kpis(snap, p),
        "menu_performance": {"top": menu[:3], "bottom": menu[-3:][::-1],
                             "table": [{k: d[k] for k in ("profitability_rank", "name", "selling_price", "ingredient_cost", "gross_profit",
                                                          "gross_margin_pct", "food_cost_pct", "units_sold", "gross_profit_contribution",
                                                          "margin_change_pp", "status", "menu_class")} for d in menu]},
        "supplier_changes": A.supplier_changes(snap, p),
        "supplier_spend": [s for s in A.suppliers_overview(snap, p) if s["spend_in_period"] > 0],
        "waste": A.waste_summary(snap, p),
        "profit_leakage": A.leakage(snap, p),
        "recommendations": recommendations(snap, p),
    }


def to_markdown(r: dict) -> str:
    k, per = r["summary"], r["period"]
    out = [f"# {r['title']}", "",
           f"**Period:** {per['start']} to {per['end']} ({per['location']}) · **Generated:** {r['generated_at']}",
           "*Fictional demonstration data.*" if r["is_demo_data"] else "", "",
           "## Summary", "", "| Metric | Value |", "|---|---|",
           f"| Revenue | £{k['revenue']:,.2f} |", f"| Ingredient expenditure | £{k['ingredient_expenditure']:,.2f} |",
           f"| Gross profit | £{k['gross_profit']:,.2f} |", f"| Gross margin | {k['gross_margin_pct']}% |",
           f"| Food cost | {k['food_cost_pct']}% (target {k['target_food_cost_pct']:.0f}%) |",
           f"| Waste cost | £{k['waste_cost']:,.2f} |",
           f"| Estimated profit leakage | £{r['profit_leakage']['total_estimated_leakage']:,.2f} |", "",
           "## Menu performance", "", "| # | Dish | Price | Cost | GP | Margin | Food cost | Sold | Status |", "|---|---|---|---|---|---|---|---|---|"]
    for d in r["menu_performance"]["table"]:
        out.append(f"| {d['profitability_rank']} | {d['name']} | £{d['selling_price']:.2f} | £{d['ingredient_cost']:.2f} | £{d['gross_profit']:.2f} "
                   f"| {d['gross_margin_pct']}% | {d['food_cost_pct']}% | {d['units_sold']} | {d['status']} |")
    out += ["", "## Supplier price changes", "", "| Ingredient | Supplier | Before | Now | Change | Weekly impact |", "|---|---|---|---|---|---|"]
    for s in r["supplier_changes"]:
        out.append(f"| {s['name']} | {s['supplier']} | £{s['price_at_period_start']:.2f} | £{s['current_price']:.2f} | {s['change_pct']:+}% | £{s['weekly_cost_impact']:.2f} |")
    w = r["waste"]
    out += ["", "## Food waste", "", f"Total £{w['total_cost']:,.2f} ({w['record_count']} records).", ""]
    out += [f"- {t['name']}: {t['quantity']} {t['unit']}, £{t['cost']:.2f}" for t in w["top_ingredients"]]
    out += ["", "## Profit leakage", ""]
    out += [f"- {c['label']}: £{c['amount']:,.2f} ({c['formula']})" for c in r["profit_leakage"]["categories"]]
    out += ["", "## Recommendations", ""]
    out += [f"{i}. **{x['area']}:** {x['action']} (≈£{x['estimated_impact']:,.2f}; {x['basis']})" for i, x in enumerate(r["recommendations"], 1)]
    out += ["", "*All figures are calculated deterministically from recorded sales, invoices and waste. Estimates and projections are labelled.*"]
    return "\n".join(out)
