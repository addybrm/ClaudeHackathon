"""Read-side analytics. Loads one in-memory snapshot from the database per request and derives
every figure deterministically with the formulas in services/finance.py.

Definitions (also in docs/PRODUCT_SPEC.md):
  revenue                = sum(units sold x selling price)                 [sales]
  ingredient expenditure = sum(confirmed invoice line totals)              [actual purchases]
  theoretical food cost  = sum(units sold x recipe cost at that week's prices)
  gross profit           = revenue - ingredient expenditure
  gross margin %         = gross profit / revenue x 100
  food cost %            = ingredient expenditure / revenue x 100
  waste cost             = sum(waste qty x unit price in effect on that date)
  unexplained variance   = ingredient expenditure - theoretical food cost - waste cost
"""
from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from .. import config, models as m
from .finance import (D, ZERO, change_pct, dish_metrics, linear_fit, money, pct, price_for_target_food_cost,
                      ratio_pct, recipe_cost)


def week_end(week_start: date) -> date:
    """Sales are weekly; cost them at the prices in effect by the end of that week."""
    return week_start + timedelta(days=6)


@dataclass
class Period:
    start: date
    end: date

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    def previous(self) -> "Period":
        return Period(self.start - timedelta(days=self.days), self.start - timedelta(days=1))

    def contains(self, d: date) -> bool:
        return self.start <= d <= self.end

    def as_dict(self) -> dict:
        return {"start": self.start.isoformat(), "end": self.end.isoformat(), "days": self.days}


class Snapshot:
    def __init__(self, db: Session, location_id: int | None = None):
        self.restaurant = db.get(m.Restaurant, 1)
        self.locations = {l.id: l for l in db.scalars(select(m.Location))}
        if location_id is not None and location_id not in self.locations:
            raise HTTPException(404, f"Unknown location_id {location_id}")
        self.location_id = location_id
        self.suppliers = {s.id: s for s in db.scalars(select(m.Supplier))}
        self.ingredients = {i.id: i for i in db.scalars(select(m.Ingredient))}
        self.dishes = {d.id: d for d in db.scalars(select(m.Dish).where(m.Dish.active.is_(True)))}
        loc = (lambda q, col: q.where(col == location_id)) if location_id else (lambda q, col: q)
        self.sales = list(db.scalars(loc(select(m.Sale), m.Sale.location_id)))
        self.invoices = list(db.scalars(loc(select(m.Invoice), m.Invoice.location_id)))
        self.waste = list(db.scalars(loc(select(m.WasteRecord), m.WasteRecord.location_id)))
        # Price history: invoice prices are what was actually paid (all locations: suppliers price the business)
        self._hist: dict[str, list[tuple[date, Decimal, int]]] = defaultdict(list)
        self.quotes: list[m.PriceRecord] = []
        for r in db.scalars(select(m.PriceRecord).order_by(m.PriceRecord.observed_on, m.PriceRecord.id)):
            (self._hist[r.ingredient_id].append((r.observed_on, D(r.unit_price), r.supplier_id))
             if r.source == "invoice" else self.quotes.append(r))
        self._dates = {k: [d for d, _, _ in v] for k, v in self._hist.items()}
        self.week_starts = sorted({s.week_start for s in self.sales})
        self.data_start = self.week_starts[0] if self.week_starts else date.today()
        self.data_end = self.week_starts[-1] + timedelta(days=6) if self.week_starts else date.today()

    # ---- prices ---------------------------------------------------------
    def price_on(self, ing: str, d: date) -> Decimal:
        hist = self._hist.get(ing)
        if not hist:
            return ZERO
        i = bisect_right(self._dates[ing], d)
        return hist[max(i - 1, 0)][1]

    def current_price(self, ing: str) -> Decimal:
        hist = self._hist.get(ing)
        return hist[-1][1] if hist else ZERO

    def current_supplier(self, ing: str) -> str | None:
        hist = self._hist.get(ing)
        return self.suppliers[hist[-1][2]].name if hist else None

    def history(self, ing: str) -> list[dict]:
        out, last = [], None
        for d, p, s in self._hist.get(ing, []):
            if last is None or p != last[0] or s != last[1]:  # collapse repeats
                out.append({"date": d.isoformat(), "unit_price": money(p), "supplier": self.suppliers[s].name})
            last = (p, s)
        return out

    def dish_cost(self, dish: m.Dish, on: date | None = None, overrides: dict | None = None) -> Decimal:
        def price(i):
            if overrides and i in overrides:
                return overrides[i]
            return self.price_on(i, on) if on else self.current_price(i)
        return recipe_cost(((l.ingredient_id, D(l.quantity)) for l in dish.recipe), price)

    # ---- periods --------------------------------------------------------
    def period(self, start: date | None, end: date | None) -> Period:
        end = end or self.data_end
        start = start or (end - timedelta(days=27))
        if start > end:
            raise HTTPException(422, "start must be on or before end")
        if (end - start).days > 366:
            raise HTTPException(422, "period cannot exceed 366 days")
        return Period(start, end)

    def weeks_in(self, p: Period) -> int:
        return max(1, sum(1 for w in self.week_starts if p.contains(w)))

    # ---- core totals ----------------------------------------------------
    def totals(self, p: Period) -> dict:
        revenue = theoretical = ZERO
        units = 0
        for s in self.sales:
            if p.contains(s.week_start) and s.dish_id in self.dishes:
                revenue += D(s.unit_price) * s.quantity
                theoretical += self.dish_cost(self.dishes[s.dish_id], week_end(s.week_start)) * s.quantity
                units += s.quantity
        purchases = sum((D(l.line_total) for i in self.invoices if p.contains(i.invoice_date) for l in i.lines), ZERO)
        waste = sum((D(w.cost) for w in self.waste if p.contains(w.recorded_on)), ZERO)
        gp = revenue - purchases
        return {"revenue": revenue, "purchases": purchases, "theoretical": theoretical, "waste": waste,
                "gross_profit": gp, "units": units, "variance": purchases - theoretical - waste}


def _period_meta(snap: Snapshot, p: Period) -> dict:
    return {**p.as_dict(), "weeks_of_sales": snap.weeks_in(p),
            "data_available": {"start": snap.data_start.isoformat(), "end": snap.data_end.isoformat()},
            "location": (snap.locations[snap.location_id].name if snap.location_id else "All locations")}


# ======================================================================
# Dashboard (Module A)
# ======================================================================
def kpis(snap: Snapshot, p: Period) -> dict:
    t, prev = snap.totals(p), snap.totals(p.previous())
    weeks = snap.weeks_in(p)
    k = {
        "revenue": money(t["revenue"]),
        "ingredient_expenditure": money(t["purchases"]),
        "gross_profit": money(t["gross_profit"]),
        "gross_margin_pct": ratio_pct(t["gross_profit"], t["revenue"]),
        "food_cost_pct": ratio_pct(t["purchases"], t["revenue"]),
        "theoretical_food_cost": money(t["theoretical"]),
        "theoretical_food_cost_pct": ratio_pct(t["theoretical"], t["revenue"]),
        "waste_cost": money(t["waste"]),
        "unexplained_variance": money(t["variance"]),
        "covers_sold": t["units"],
        "target_food_cost_pct": config.TARGET_FOOD_COST_PCT,
        "changes_vs_previous_period_pct": {
            "revenue": change_pct(prev["revenue"], t["revenue"]) if prev["revenue"] else None,
            "ingredient_expenditure": change_pct(prev["purchases"], t["purchases"]) if prev["purchases"] else None,
            "gross_profit": change_pct(prev["gross_profit"], t["gross_profit"]) if prev["revenue"] else None,
            "waste_cost": change_pct(prev["waste"], t["waste"]) if prev["waste"] else None,
        },
        # Backward-compatible weekly averages (used by the v1 frontend)
        "weekly_revenue": money(t["revenue"] / weeks),
        "weekly_food_cost": money(t["purchases"] / weeks),
        "weekly_gross_profit": money(t["gross_profit"] / weeks),
    }
    return k


def trend(snap: Snapshot) -> list[dict]:
    out = []
    for w in snap.week_starts:
        t = snap.totals(Period(w, w + timedelta(days=6)))
        out.append({"week_start": w.isoformat(), "revenue": money(t["revenue"]),
                    "ingredient_expenditure": money(t["purchases"]), "gross_profit": money(t["gross_profit"]),
                    "gross_margin_pct": ratio_pct(t["gross_profit"], t["revenue"]),
                    "food_cost_pct": ratio_pct(t["purchases"], t["revenue"]),
                    "theoretical_food_cost_pct": ratio_pct(t["theoretical"], t["revenue"]),
                    "waste_cost": money(t["waste"]), "type": "actual"})
    return out


def dashboard(snap: Snapshot, p: Period) -> dict:
    menu_items = menu(snap, p)["dishes"]
    ranked = sorted(menu_items, key=lambda d: d["gross_margin_pct"], reverse=True)
    al = alerts(snap, p)
    leak = leakage(snap, p)
    return {
        "restaurant": {"name": snap.restaurant.name, "currency": snap.restaurant.currency,
                       "region": snap.restaurant.region, "is_demo_data": snap.restaurant.is_demo},
        "period": _period_meta(snap, p),
        "kpis": kpis(snap, p),
        "trend": trend(snap),
        "top_dishes": ranked[:3],
        "bottom_dishes": ranked[-3:][::-1],
        "supplier_price_changes": supplier_changes(snap, p)[:5],
        "profit_leakage": {"total": leak["total_estimated_leakage"], "annualised": leak["annualised_estimate"],
                           "by_category": [{k: c[k] for k in ("category", "label", "amount")} for c in leak["categories"]]},
        "waste": {k: v for k, v in waste_summary(snap, p).items() if k in ("total_cost", "by_reason", "top_ingredients")},
        "alerts": al[:5],
        "alert_count": len(al),
    }


# ======================================================================
# Menu profitability (Module B)
# ======================================================================
def dish_detail(snap: Snapshot, dish: m.Dish, p: Period) -> dict:
    cost_now = snap.dish_cost(dish)
    met = dish_metrics(dish.selling_price, cost_now)
    cost_start = snap.dish_cost(dish, p.start)
    met_start = dish_metrics(dish.selling_price, cost_start)
    units = revenue = gp = ZERO
    for s in snap.sales:
        if s.dish_id == dish.id and p.contains(s.week_start):
            units += s.quantity
            revenue += D(s.unit_price) * s.quantity
            gp += (D(s.unit_price) - snap.dish_cost(dish, week_end(s.week_start))) * s.quantity
    weeks = snap.weeks_in(p)
    fc = met["food_cost_pct"]
    status = ("healthy" if fc <= config.TARGET_FOOD_COST_PCT else
              "watch" if fc <= config.CRITICAL_FOOD_COST_PCT else "critical")
    ingredients = []
    for l in dish.recipe:
        ing = snap.ingredients[l.ingredient_id]
        up_now, up_start = snap.current_price(ing.id), snap.price_on(ing.id, p.start)
        ingredients.append({"ingredient_id": ing.id, "name": ing.name, "quantity": float(l.quantity), "unit": ing.unit,
                            "unit_cost": money(up_now), "line_cost": money(D(l.quantity) * up_now),
                            "unit_cost_change_pct": change_pct(up_start, up_now) if up_start else None})
    return {
        "id": dish.id, "name": dish.name, "category": dish.category,
        "selling_price": money(dish.selling_price),
        **met,
        "production_cost": met["ingredient_cost"],  # ingredient-only costing (labour/energy out of MVP scope)
        "units_sold": int(units), "revenue": money(revenue), "gross_profit_contribution": money(gp),
        "gross_margin_pct_at_period_start": met_start["gross_margin_pct"],
        "margin_change_pp": pct(D(met["gross_margin_pct"]) - D(met_start["gross_margin_pct"])),
        "cost_change_pct": change_pct(cost_start, cost_now),
        "cost_trend": [{"week_start": w.isoformat(), "ingredient_cost": money(snap.dish_cost(dish, week_end(w)))}
                       for w in snap.week_starts] + [{"week_start": "current", "ingredient_cost": money(cost_now)}],
        "suggested_price_for_target": price_for_target_food_cost(cost_now, config.TARGET_FOOD_COST_PCT),
        "status": status,
        "ingredients": ingredients,
        # Backward-compatible fields (v1 frontend)
        "menu_price": money(dish.selling_price), "weekly_units_sold": int(units / weeks),
    }


def menu(snap: Snapshot, p: Period) -> dict:
    items = [dish_detail(snap, d, p) for d in snap.dishes.values()]
    # Menu engineering (Kasavana & Smith): popularity threshold = 70% of equal share; profit threshold = weighted avg GP
    total_units = sum(i["units_sold"] for i in items) or 1
    avg_gp = sum(D(i["gross_profit"]) * i["units_sold"] for i in items) / total_units
    pop_threshold = D(total_units) / len(items) * D("0.7") if items else ZERO
    for i in items:
        popular, profitable = D(i["units_sold"]) >= pop_threshold, D(i["gross_profit"]) >= avg_gp
        i["menu_class"] = ("star" if popular and profitable else "plowhorse" if popular else
                           "puzzle" if profitable else "dog")
    for rank, i in enumerate(sorted(items, key=lambda x: -x["gross_profit_contribution"]), 1):
        i["profitability_rank"] = rank
    items.sort(key=lambda x: x["profitability_rank"])
    return {"period": _period_meta(snap, p), "currency": snap.restaurant.currency,
            "target_food_cost_pct": config.TARGET_FOOD_COST_PCT,
            "menu_engineering": {"popularity_threshold_units": money(pop_threshold), "average_unit_gross_profit": money(avg_gp)},
            "dishes": items}


# ======================================================================
# Supplier intelligence (Module C)
# ======================================================================
def _purchased_qty(snap: Snapshot, p: Period) -> dict[str, Decimal]:
    q: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for inv in snap.invoices:
        if p.contains(inv.invoice_date):
            for l in inv.lines:
                q[l.ingredient_id] += D(l.quantity)
    return q


def supplier_changes(snap: Snapshot, p: Period) -> list[dict]:
    """Price at period start vs latest price, with affected dishes and weekly impact."""
    weeks = snap.weeks_in(p)
    units_by_dish = defaultdict(int)
    for s in snap.sales:
        if p.contains(s.week_start):
            units_by_dish[s.dish_id] += s.quantity
    out = []
    for ing in snap.ingredients.values():
        before, now = snap.price_on(ing.id, p.start), snap.current_price(ing.id)
        if not before or before == now:
            continue
        affected, weekly = [], ZERO
        for d in snap.dishes.values():
            for l in d.recipe:
                if l.ingredient_id == ing.id:
                    per_portion = D(l.quantity) * (now - before)
                    wk = per_portion * units_by_dish[d.id] / weeks
                    weekly += wk
                    affected.append({"dish_id": d.id, "name": d.name, "cost_change_per_portion": money(per_portion),
                                     "weekly_impact": money(wk)})
        out.append({"ingredient_id": ing.id, "name": ing.name, "unit": ing.unit, "supplier": snap.current_supplier(ing.id),
                    "price_at_period_start": money(before), "current_price": money(now),
                    "change_pct": change_pct(before, now), "weekly_cost_impact": money(weekly),
                    "affected_dishes": sorted(affected, key=lambda a: -a["weekly_impact"]),
                    # v1 compatible keys
                    "previous_price": money(before), "id": ing.id})
    return sorted(out, key=lambda x: -x["change_pct"])


def supplier_comparison(snap: Snapshot, p: Period) -> list[dict]:
    """Latest price per supplier per ingredient (invoices + quotes) and potential saving."""
    latest: dict[str, dict[int, tuple[date, Decimal, str]]] = defaultdict(dict)
    for ing, hist in snap._hist.items():
        for d, price, sup in hist:
            latest[ing][sup] = (d, price, "invoice")
    for q in snap.quotes:
        prev = latest[q.ingredient_id].get(q.supplier_id)
        if not prev or q.observed_on >= prev[0]:
            latest[q.ingredient_id][q.supplier_id] = (q.observed_on, D(q.unit_price), "quote")
    bought = _purchased_qty(snap, p)
    out = []
    for ing, by_sup in latest.items():
        if len(by_sup) < 2:
            continue
        cur = snap.current_price(ing)
        offers = sorted(({"supplier": snap.suppliers[s].name, "unit_price": money(pr), "as_of": d.isoformat(), "source": src}
                         for s, (d, pr, src) in by_sup.items()), key=lambda o: o["unit_price"])
        best = offers[0]
        saving_unit = cur - D(best["unit_price"])
        out.append({"ingredient_id": ing, "name": snap.ingredients[ing].name, "unit": snap.ingredients[ing].unit,
                    "current_supplier": snap.current_supplier(ing), "current_price": money(cur), "offers": offers,
                    "cheapest_supplier": best["supplier"],
                    "potential_saving_in_period": money(max(saving_unit, ZERO) * bought.get(ing, ZERO)),
                    "quantity_purchased_in_period": money(bought.get(ing, ZERO))})
    return sorted(out, key=lambda x: -x["potential_saving_in_period"])


def suppliers_overview(snap: Snapshot, p: Period) -> list[dict]:
    spend, count = defaultdict(lambda: ZERO), defaultdict(int)
    for inv in snap.invoices:
        if p.contains(inv.invoice_date):
            count[inv.supplier_id] += 1
            spend[inv.supplier_id] += sum((D(l.line_total) for l in inv.lines), ZERO)
    total = sum(spend.values(), ZERO)
    return [{"id": s.id, "name": s.name, "category": s.category, "contact_email": s.contact_email,
             "invoices_in_period": count[s.id], "spend_in_period": money(spend[s.id]),
             "share_of_spend_pct": ratio_pct(spend[s.id], total) if total else 0.0,
             "ingredients_supplied": sorted(i.name for i in snap.ingredients.values() if i.primary_supplier_id == s.id),
             "is_current_supplier": count[s.id] > 0}
            for s in snap.suppliers.values()]


# ======================================================================
# Waste (Module F)
# ======================================================================
def waste_summary(snap: Snapshot, p: Period) -> dict:
    recs = [w for w in snap.waste if p.contains(w.recorded_on)]
    prev_cost = sum((D(w.cost) for w in snap.waste if p.previous().contains(w.recorded_on)), ZERO)
    total = sum((D(w.cost) for w in recs), ZERO)
    by_ing: dict[str, dict] = {}
    by_reason: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for w in recs:
        e = by_ing.setdefault(w.ingredient_id, {"ingredient_id": w.ingredient_id, "name": snap.ingredients[w.ingredient_id].name,
                                                "unit": w.unit, "records": 0, "quantity": ZERO, "cost": ZERO})
        e["records"] += 1
        e["quantity"] += D(w.quantity)
        e["cost"] += D(w.cost)
        by_reason[w.reason] += D(w.cost)
    weeks = snap.weeks_in(p)
    top = sorted(by_ing.values(), key=lambda e: -e["cost"])
    for e in top:
        e["avg_weekly_quantity"] = money(e["quantity"] / weeks)
        e["quantity"], e["cost"] = money(e["quantity"]), money(e["cost"])
        e["suggestion"] = (f"Reduce weekly order of {e['name'].lower()} by about {e['avg_weekly_quantity']} {e['unit']} "
                           f"or review storage/prep (recorded {e['records']} times).")
    revenue = snap.totals(p)["revenue"]
    return {"period": _period_meta(snap, p), "total_cost": money(total), "previous_period_cost": money(prev_cost),
            "change_pct": change_pct(prev_cost, total) if prev_cost else None,
            "waste_pct_of_revenue": ratio_pct(total, revenue) if revenue else None,
            "by_reason": [{"reason": r, "cost": money(c)} for r, c in sorted(by_reason.items(), key=lambda x: -x[1])],
            "top_ingredients": top[:5], "frequently_wasted": [e["name"] for e in top if e["records"] >= weeks],
            "record_count": len(recs)}


# ======================================================================
# Profit leakage (Module E)
# ======================================================================
def leakage(snap: Snapshot, p: Period) -> dict:
    weeks = snap.weeks_in(p)
    # 1. supplier price increases paid during the period vs prices at period start
    price_inc, price_items = ZERO, defaultdict(lambda: ZERO)
    anomalies = []
    for inv in snap.invoices:
        if not p.contains(inv.invoice_date):
            continue
        for l in inv.lines:
            base = snap.price_on(l.ingredient_id, p.start)
            extra = (D(l.unit_price) - base) * D(l.quantity)
            if extra > 0:
                price_inc += extra
                price_items[l.ingredient_id] += extra
            prev = snap.price_on(l.ingredient_id, inv.invoice_date - timedelta(days=1))
            jump = change_pct(prev, l.unit_price) if prev else None
            if jump is not None and abs(jump) >= 10:
                anomalies.append({"invoice_number": inv.invoice_number, "date": inv.invoice_date.isoformat(),
                                  "supplier": snap.suppliers[inv.supplier_id].name,
                                  "ingredient": snap.ingredients[l.ingredient_id].name,
                                  "previous_price": money(prev), "invoiced_price": money(l.unit_price), "change_pct": jump})
    # 2. unexplained purchasing variance per ingredient: bought - theoretical usage - recorded waste (at cost)
    theo, bought, wasted = defaultdict(lambda: ZERO), defaultdict(lambda: ZERO), defaultdict(lambda: ZERO)
    for s in snap.sales:
        if p.contains(s.week_start) and s.dish_id in snap.dishes:
            for l in snap.dishes[s.dish_id].recipe:
                theo[l.ingredient_id] += D(l.quantity) * s.quantity * snap.price_on(l.ingredient_id, week_end(s.week_start))
    for inv in snap.invoices:
        if p.contains(inv.invoice_date):
            for l in inv.lines:
                bought[l.ingredient_id] += D(l.line_total)
    for w in snap.waste:
        if p.contains(w.recorded_on):
            wasted[w.ingredient_id] += D(w.cost)
    variance_items = []
    for ing in bought:
        v = bought[ing] - theo[ing] - wasted[ing]
        if v > 0:
            variance_items.append({"ingredient_id": ing, "name": snap.ingredients[ing].name, "amount": money(v),
                                   "variance_pct_of_usage": ratio_pct(v, theo[ing]) if theo[ing] else None})
    variance_items.sort(key=lambda x: -x["amount"])
    variance_total = sum((D(v["amount"]) for v in variance_items), ZERO)
    ws = waste_summary(snap, p)
    # 3. margin decline (informational: already counted within price increases)
    declining = [{"dish_id": d["id"], "name": d["name"], "margin_change_pp": d["margin_change_pp"],
                  "gross_margin_pct": d["gross_margin_pct"],
                  "lost_gross_profit": money((D(d["ingredient_cost"]) - snap.dish_cost(snap.dishes[d["id"]], p.start)) * d["units_sold"])}
                 for d in (dish_detail(snap, x, p) for x in snap.dishes.values()) if d["margin_change_pp"] <= -config.MARGIN_DECLINE_ALERT_PP]
    high_cost = []
    for x in snap.dishes.values():
        d = dish_detail(snap, x, p)
        if d["food_cost_pct"] > config.TARGET_FOOD_COST_PCT:
            excess = (D(d["ingredient_cost"]) - D(d["selling_price"]) * D(config.TARGET_FOOD_COST_PCT) / 100) * d["units_sold"]
            high_cost.append({"dish_id": d["id"], "name": d["name"], "food_cost_pct": d["food_cost_pct"],
                              "excess_cost_vs_target": money(excess)})
    categories = [
        {"category": "supplier_price_increases", "label": "Supplier price increases", "amount": money(price_inc),
         "formula": "sum over invoice lines in period of (invoiced unit price - unit price at period start) x quantity",
         "items": [{"ingredient_id": i, "name": snap.ingredients[i].name, "amount": money(a)}
                   for i, a in sorted(price_items.items(), key=lambda x: -x[1])]},
        {"category": "unexplained_purchasing_variance", "label": "Purchases above recipe usage",
         "amount": money(variance_total),
         "formula": "per ingredient: purchases - (units sold x recipe quantity x unit price) - recorded waste cost; positive values only",
         "items": variance_items[:8]},
        {"category": "food_waste", "label": "Recorded food waste", "amount": ws["total_cost"],
         "formula": "sum of waste quantity x unit price in effect on the waste date", "items": ws["top_ingredients"]},
    ]
    total = sum((D(c["amount"]) for c in categories), ZERO)
    return {"period": _period_meta(snap, p), "total_estimated_leakage": money(total),
            "annualised_estimate": money(total / weeks * 52), "annualisation": "total / weeks in period x 52 (projection)",
            "categories": categories,
            "declining_margin_dishes": declining,
            "high_food_cost_dishes": sorted(high_cost, key=lambda x: -x["excess_cost_vs_target"]),
            "invoice_price_anomalies": anomalies[-10:],
            "note": "Declining-margin and high-food-cost dishes are shown for context and are not added to the total "
                    "(their cost increases are already counted under supplier price increases)."}


# ======================================================================
# Alerts (FR7, FR11)
# ======================================================================
def alerts(snap: Snapshot, p: Period) -> list[dict]:
    out = []
    for c in supplier_changes(snap, p):
        if c["change_pct"] >= config.PRICE_ALERT_PCT:
            dishes = ", ".join(a["name"] for a in c["affected_dishes"][:3]) or "no current dishes"
            out.append({"id": f"price-{c['ingredient_id']}", "type": "supplier_price_increase",
                        "severity": "high" if c["change_pct"] >= 15 else "medium",
                        "title": f"{c['name']} up {c['change_pct']}%",
                        "message": f"{c['supplier']}: £{c['price_at_period_start']:.2f} → £{c['current_price']:.2f}/{c['unit']}. "
                                   f"Costs about £{c['weekly_cost_impact']:.2f} a week. Affects: {dishes}.",
                        "impact_gbp_weekly": c["weekly_cost_impact"], "entity": {"ingredient_id": c["ingredient_id"]}})
    for x in snap.dishes.values():
        d = dish_detail(snap, x, p)
        if d["margin_change_pp"] <= -config.MARGIN_DECLINE_ALERT_PP:
            out.append({"id": f"margin-{d['id']}", "type": "declining_margin",
                        "severity": "high" if d["margin_change_pp"] <= -4 else "medium",
                        "title": f"{d['name']}: margin down {abs(d['margin_change_pp'])} pts",
                        "message": f"Gross margin fell from {d['gross_margin_pct_at_period_start']}% to {d['gross_margin_pct']}% "
                                   f"as ingredient cost rose {d['cost_change_pct']}%.",
                        "impact_gbp_weekly": None, "entity": {"dish_id": d["id"]}})
        if d["status"] != "healthy":
            out.append({"id": f"foodcost-{d['id']}", "type": "high_food_cost",
                        "severity": "high" if d["status"] == "critical" else "medium",
                        "title": f"{d['name']}: food cost {d['food_cost_pct']}%",
                        "message": f"Above the {config.TARGET_FOOD_COST_PCT:.0f}% target. A price of £{d['suggested_price_for_target']:.2f} "
                                   f"(now £{d['selling_price']:.2f}) or a smaller portion would restore it.",
                        "suggested_price": d["suggested_price_for_target"], "entity": {"dish_id": d["id"]}})
    leak = leakage(snap, p)
    for v in leak["categories"][1]["items"]:
        if v["variance_pct_of_usage"] and v["variance_pct_of_usage"] >= config.VARIANCE_ALERT_PCT and v["amount"] >= 50:
            out.append({"id": f"variance-{v['ingredient_id']}", "type": "purchasing_variance", "severity": "medium",
                        "title": f"{v['name']}: £{v['amount']:.2f} bought but not accounted for",
                        "message": f"Purchases exceed recipe usage plus recorded waste by {v['variance_pct_of_usage']}%. "
                                   "Check portion sizes, unrecorded waste and deliveries.",
                        "impact_gbp_period": v["amount"], "entity": {"ingredient_id": v["ingredient_id"]}})
    ws = waste_summary(snap, p)
    if ws["change_pct"] is not None and ws["change_pct"] >= 10:
        out.append({"id": "waste-up", "type": "waste_increase", "severity": "medium",
                    "title": f"Food waste up {ws['change_pct']}%",
                    "message": f"£{ws['total_cost']:.2f} wasted this period vs £{ws['previous_period_cost']:.2f} before. "
                               f"Top item: {ws['top_ingredients'][0]['name'] if ws['top_ingredients'] else 'n/a'}.",
                    "entity": {}})
    for c in supplier_comparison(snap, p):
        if c["potential_saving_in_period"] >= 20 and c["cheapest_supplier"] != c["current_supplier"]:
            out.append({"id": f"saving-{c['ingredient_id']}", "type": "cheaper_supplier", "severity": "info",
                        "title": f"Cheaper {c['name'].lower()} available",
                        "message": f"{c['cheapest_supplier']} quoted £{c['offers'][0]['unit_price']:.2f}/{c['unit']} vs "
                                   f"£{c['current_price']:.2f} from {c['current_supplier']}: about £{c['potential_saving_in_period']:.2f} "
                                   "saving over this period's volume.",
                        "impact_gbp_period": c["potential_saving_in_period"], "entity": {"ingredient_id": c["ingredient_id"]}})
    order = {"high": 0, "medium": 1, "info": 2}
    out.sort(key=lambda a: (order[a["severity"]], a["type"]))
    for a in out:  # v1 compatible alias
        a["detail"] = a["message"]
    return out


# ======================================================================
# Forecasting & simulation (Module H)
# ======================================================================
def forecast(snap: Snapshot, weeks_ahead: int, lookback: int = 8) -> dict:
    hist = trend(snap)[-lookback:]
    fut = []
    s_rev, i_rev = linear_fit([h["revenue"] for h in hist])
    s_exp, i_exp = linear_fit([h["ingredient_expenditure"] for h in hist])
    last = snap.week_starts[-1] if snap.week_starts else date.today()
    n = len(hist)
    for h in range(1, weeks_ahead + 1):
        x = n - 1 + h
        rev, exp = max(i_rev + s_rev * x, ZERO), max(i_exp + s_exp * x, ZERO)
        fut.append({"week_start": (last + timedelta(weeks=h)).isoformat(), "revenue": money(rev),
                    "ingredient_expenditure": money(exp), "gross_profit": money(rev - exp),
                    "food_cost_pct": ratio_pct(exp, rev) if rev else None, "type": "projection"})
    # ingredient price projection: linear trend of weekly price over lookback window
    proj_prices, price_rows = {}, []
    for ing in snap.ingredients.values():
        series = [snap.price_on(ing.id, w + timedelta(days=6)) for w in snap.week_starts[-lookback:]]
        slope, icpt = linear_fit(series)
        cur = snap.current_price(ing.id)
        projected = max(icpt + slope * (len(series) - 1 + weeks_ahead), ZERO) if series else cur
        proj_prices[ing.id] = projected
        if slope != 0:
            price_rows.append({"ingredient_id": ing.id, "name": ing.name, "unit": ing.unit, "current_price": money(cur),
                               "projected_price": money(projected), "projected_change_pct": change_pct(cur, projected)})
    dish_rows = []
    for d in snap.dishes.values():
        now, later = snap.dish_cost(d), snap.dish_cost(d, overrides=proj_prices)
        a, b = dish_metrics(d.selling_price, now), dish_metrics(d.selling_price, later)
        warn = b["food_cost_pct"] > config.CRITICAL_FOOD_COST_PCT or (a["gross_margin_pct"] - b["gross_margin_pct"]) >= config.MARGIN_DECLINE_ALERT_PP
        dish_rows.append({"dish_id": d.id, "name": d.name, "current_gross_margin_pct": a["gross_margin_pct"],
                          "projected_gross_margin_pct": b["gross_margin_pct"], "projected_food_cost_pct": b["food_cost_pct"],
                          "projected_ingredient_cost": b["ingredient_cost"], "margin_warning": warn})
    return {"horizon_weeks": weeks_ahead, "method": f"Ordinary least-squares linear trend over the last {len(hist)} weeks of actuals. "
            "Projections are estimates, not actuals.",
            "history": hist, "projection": fut,
            "ingredient_prices": sorted(price_rows, key=lambda r: -(r["projected_change_pct"] or 0)),
            "dishes": sorted(dish_rows, key=lambda r: r["projected_gross_margin_pct"]),
            "warnings": [r["name"] for r in dish_rows if r["margin_warning"]]}


def simulate(snap: Snapshot, ingredient_changes: dict, price_changes: dict, volume_changes: dict, basis_weeks: int) -> dict:
    for i in ingredient_changes:
        if i not in snap.ingredients:
            raise HTTPException(422, f"Unknown ingredient_id '{i}'")
    for d in list(price_changes) + list(volume_changes):
        if d not in snap.dishes:
            raise HTTPException(422, f"Unknown dish_id '{d}'")
    basis = snap.week_starts[-basis_weeks:]
    units = defaultdict(int)
    for s in snap.sales:
        if s.week_start in basis:
            units[s.dish_id] += s.quantity
    overrides = {i: snap.current_price(i) * (1 + D(p) / 100) for i, p in ingredient_changes.items()}
    rows, tb, ts = [], defaultdict(lambda: ZERO), defaultdict(lambda: ZERO)
    for d in snap.dishes.values():
        wu = D(units[d.id]) / max(len(basis), 1)
        wu2 = wu * (1 + D(volume_changes.get(d.id, 0)) / 100)
        p1, p2 = D(d.selling_price), D(price_changes.get(d.id, d.selling_price))
        c1, c2 = snap.dish_cost(d), snap.dish_cost(d, overrides=overrides)
        a, b = dish_metrics(p1, c1), dish_metrics(p2, c2)
        for t, pp, cc, uu in ((tb, p1, c1, wu), (ts, p2, c2, wu2)):
            t["revenue"] += pp * uu
            t["cost"] += cc * uu
        rows.append({"dish_id": d.id, "name": d.name, "baseline": {"selling_price": money(p1), **a, "weekly_units": money(wu)},
                     "scenario": {"selling_price": money(p2), **b, "weekly_units": money(wu2)},
                     "weekly_gross_profit_change": money((p2 - c2) * wu2 - (p1 - c1) * wu)})

    def tot(t):
        gp = t["revenue"] - t["cost"]
        return {"weekly_revenue": money(t["revenue"]), "weekly_ingredient_cost": money(t["cost"]), "weekly_gross_profit": money(gp),
                "gross_margin_pct": ratio_pct(gp, t["revenue"]), "food_cost_pct": ratio_pct(t["cost"], t["revenue"])}
    base, scen = tot(tb), tot(ts)
    return {"type": "simulation", "basis": f"average weekly units over the last {len(basis)} weeks; current ingredient prices",
            "baseline": base, "scenario": scen,
            "weekly_gross_profit_change": money(D(scen["weekly_gross_profit"]) - D(base["weekly_gross_profit"])),
            "annualised_gross_profit_change": money((D(scen["weekly_gross_profit"]) - D(base["weekly_gross_profit"])) * 52),
            "dishes": sorted(rows, key=lambda r: r["weekly_gross_profit_change"])}
