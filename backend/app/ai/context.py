"""Builds the factual context handed to any advisor provider. Every number comes from analytics."""
import re
from ..services import analytics as A


def detect_scenario(question: str, snap: A.Snapshot) -> dict | None:
    """Parse simple what-if questions, e.g. 'what if cod goes up 10%?', 'raise fish and chips to £17.50'."""
    q = question.lower()
    pct = re.search(r"(-?\d+(?:\.\d+)?)\s*(?:%|percent)", q)
    gbp = re.search(r"£\s*(\d+(?:\.\d+)?)", q)
    if not (pct or gbp):
        return None
    down = any(w in q for w in ("drop", "fall", "decrease", "cut", "lower", "reduce", "cheaper"))

    def mentioned(items):
        best = None
        for key, name in items:
            words = [w for w in re.findall(r"[a-z]+", name.lower()) if len(w) >= 3 and w not in ("with", "and", "the", "fillet", "fresh")]
            if key.replace("_", " ") in q or name.lower() in q or (words and any(re.search(rf"\b{w}\b", q) for w in words)):
                if best is None or len(name) > len(best[1]):
                    best = (key, name)
        return best

    dish = mentioned((d.id, d.name) for d in snap.dishes.values())
    ing = mentioned((i.id, i.name) for i in snap.ingredients.values() if i.id != "pantry")
    menu_words = any(w in q for w in ("charge", "raise", "menu", "sell", "selling price", "put up", "increase the price"))
    if dish and (gbp or menu_words or (not ing and "price" in q)):
        if gbp:
            new_price = float(gbp.group(1))
        else:
            change = float(pct.group(1)) * (-1 if down else 1)
            new_price = round(float(snap.dishes[dish[0]].selling_price) * (1 + change / 100), 2)
        if new_price <= 0:
            return None
        return {"kind": "menu_price", "description": f"{dish[1]} priced at £{new_price:.2f}",
                "result": A.simulate(snap, {}, {dish[0]: new_price}, {}, 4)}
    if ing and pct:
        change = float(pct.group(1)) * (-1 if down else 1)
        if not -90 <= change <= 500:
            return None
        return {"kind": "ingredient_price", "description": f"{ing[1]} price {'+' if change >= 0 else ''}{change:g}%",
                "result": A.simulate(snap, {ing[0]: change}, {}, {}, 4)}
    return None


def build(snap: A.Snapshot, period: A.Period, question: str) -> dict:
    m = A.menu(snap, period)["dishes"]
    leak = A.leakage(snap, period)
    fc = A.forecast(snap, 4)
    return {
        "restaurant": {"name": snap.restaurant.name, "region": snap.restaurant.region, "currency": "GBP",
                       "is_demo_data": snap.restaurant.is_demo},
        "period": A._period_meta(snap, period),
        "kpis": A.kpis(snap, period),
        "dishes": [{k: d[k] for k in ("id", "name", "selling_price", "ingredient_cost", "gross_profit", "gross_margin_pct",
                                      "food_cost_pct", "units_sold", "gross_profit_contribution", "margin_change_pp",
                                      "status", "menu_class", "suggested_price_for_target", "profitability_rank")} for d in m],
        "supplier_price_changes": [{k: c[k] for k in ("name", "supplier", "price_at_period_start", "current_price", "change_pct",
                                                     "weekly_cost_impact")} | {"affected_dishes": [a["name"] for a in c["affected_dishes"]]}
                                   for c in A.supplier_changes(snap, period)[:8]],
        "cheaper_supplier_offers": [{k: c[k] for k in ("name", "current_supplier", "current_price", "cheapest_supplier",
                                                       "potential_saving_in_period")} | {"best_price": c["offers"][0]["unit_price"]}
                                    for c in A.supplier_comparison(snap, period)[:5]],
        "profit_leakage": {"total": leak["total_estimated_leakage"], "annualised": leak["annualised_estimate"],
                           "categories": [{"label": c["label"], "amount": c["amount"], "top_items": c["items"][:3]}
                                          for c in leak["categories"]],
                           "declining_margin_dishes": leak["declining_margin_dishes"]},
        "waste": {k: v for k, v in A.waste_summary(snap, period).items()
                  if k in ("total_cost", "change_pct", "by_reason", "top_ingredients", "frequently_wasted")},
        "forecast_4_weeks": {"method": fc["method"], "projection": fc["projection"], "margin_warnings": fc["warnings"],
                             "ingredient_prices": fc["ingredient_prices"][:5]},
        "alerts": [{"severity": a["severity"], "title": a["title"]} for a in A.alerts(snap, period)[:8]],
        "scenario": detect_scenario(question, snap),
    }
