"""Deterministic demo advisor: keyword intent routing + templated explanations built ONLY from the
computed context. It is not a language model and is always labelled as such."""


def _gbp(x) -> str:
    return f"-£{abs(x):,.2f}" if x < 0 else f"£{x:,.2f}"


class DemoProvider:
    name = "demo"
    live = False

    def answer(self, question: str, ctx: dict) -> dict:
        q = question.lower()
        if ctx.get("scenario"):
            return {"intent": "simulation", "answer": self._scenario(ctx)}
        routes = [
            ("waste", ("waste", "bin", "throw", "spoil", "expired")),
            ("forecast", ("forecast", "next month", "next week", "future", "predict", "projection", "coming weeks")),
            ("suppliers", ("supplier", "invoice", "price increase", "prices", "ingredient cost", "cheaper", "negotiat")),
            ("menu", ("menu", "dish", "promote", "reprice", "best seller", "most profit", "least profit", "item")),
        ]
        for intent, words in routes:
            if any(w in q for w in words):
                return {"intent": intent, "answer": getattr(self, "_" + intent)(ctx)}
        return {"intent": "overview", "answer": self._overview(ctx)}

    def extract_invoice_image(self, content, media_type, ingredients):
        return None  # no OCR without a live provider; user enters lines manually

    # ---- templates ---------------------------------------------------------
    def _overview(self, c):
        k, leak = c["kpis"], c["profit_leakage"]
        ch = k["changes_vs_previous_period_pct"]
        cats = sorted(leak["categories"], key=lambda x: -x["amount"])
        worst = [d for d in c["dishes"] if d["status"] != "healthy"]
        lines = [
            f"Over {c['period']['start']} to {c['period']['end']} ({c['period']['location']}), revenue was {_gbp(k['revenue'])} "
            f"and ingredient spend {_gbp(k['ingredient_expenditure'])}: food cost {k['food_cost_pct']}% vs your "
            f"{k['target_food_cost_pct']:.0f}% target, gross margin {k['gross_margin_pct']}%.",
        ]
        if ch.get("ingredient_expenditure") is not None and ch.get("revenue") is not None:
            lines.append(f"Ingredient spend changed {ch['ingredient_expenditure']:+}% against revenue {ch['revenue']:+}% vs the previous period.")
        lines.append(f"Estimated profit leakage: {_gbp(leak['total'])} this period (~{_gbp(leak['annualised'])}/year if it continues), "
                     f"mainly {cats[0]['label'].lower()} ({_gbp(cats[0]['amount'])}) and {cats[1]['label'].lower()} ({_gbp(cats[1]['amount'])}).")
        lines.append("What to do first:")
        n = 1
        sc = sorted(c["supplier_price_changes"], key=lambda s: -s["weekly_cost_impact"])
        if sc:
            s = sc[0]
            offer = next((o for o in c["cheaper_supplier_offers"] if o["name"] == s["name"]), None)
            lines.append(f"{n}. {s['name']} from {s['supplier']} rose {s['change_pct']}%, costing about {_gbp(s['weekly_cost_impact'])} a week. "
                         + (f"{offer['cheapest_supplier']} quoted {_gbp(offer['best_price'])} vs {_gbp(offer['current_price'])}: ask for a match or switch."
                            if offer else "Ask for a second quote."))
            n += 1
        if worst:
            d = max(worst, key=lambda x: x["food_cost_pct"])
            lines.append(f"{n}. Reprice or re-portion {d['name']} (food cost {d['food_cost_pct']}%): "
                         f"{_gbp(d['suggested_price_for_target'])} would bring it back to target.")
            n += 1
        var = next((x for x in leak["categories"] if "recipe" in x["label"]), None)
        if var and var["top_items"]:
            lines.append(f"{n}. Check portioning of {var['top_items'][0]['name'].lower()}: {_gbp(var['top_items'][0]['amount'])} "
                         "bought beyond recipe usage and recorded waste.")
        return "\n".join(lines)

    def _suppliers(self, c):
        sc = c["supplier_price_changes"]
        if not sc:
            return "No supplier price changes in this period."
        lines = ["Biggest supplier price changes this period:"]
        for s in sc[:4]:
            lines.append(f"- {s['name']} ({s['supplier']}): {_gbp(s['price_at_period_start'])} → {_gbp(s['current_price'])} "
                         f"({s['change_pct']:+}%), about {_gbp(s['weekly_cost_impact'])} a week; hits {', '.join(s['affected_dishes'][:3]) or 'no dishes'}.")
        if c["cheaper_supplier_offers"]:
            lines.append("Cheaper offers on file:")
            for o in c["cheaper_supplier_offers"][:3]:
                lines.append(f"- {o['name']}: {o['cheapest_supplier']} at {_gbp(o['best_price'])} vs {_gbp(o['current_price'])} "
                             f"from {o['current_supplier']} (≈{_gbp(o['potential_saving_in_period'])} over this period's volume).")
        lines.append("Action: use these figures to ask current suppliers for a price match before switching.")
        return "\n".join(lines)

    def _menu(self, c):
        d = c["dishes"]
        stars = [x for x in d if x["menu_class"] == "star"]
        dogs = [x for x in d if x["menu_class"] == "dog"]
        crit = sorted([x for x in d if x["status"] != "healthy"], key=lambda x: -x["food_cost_pct"])
        top = d[0]
        lines = [f"Your biggest profit earner is {top['name']}: {_gbp(top['gross_profit_contribution'])} gross profit this period "
                 f"({top['units_sold']} sold, {top['gross_margin_pct']}% margin)."]
        if stars:
            lines.append("Promote (popular and profitable): " + ", ".join(x["name"] for x in stars[:3]) + ".")
        if crit:
            lines.append("Reprice or re-portion: " + "; ".join(
                f"{x['name']} at {x['food_cost_pct']}% food cost (target price {_gbp(x['suggested_price_for_target'])})" for x in crit[:3]) + ".")
        if dogs:
            lines.append("Review (low sales, low profit): " + ", ".join(x["name"] for x in dogs[:3]) + ".")
        dec = [x for x in d if x["margin_change_pp"] < 0]
        if dec:
            w = min(dec, key=lambda x: x["margin_change_pp"])
            lines.append(f"Fastest-declining margin: {w['name']} ({w['margin_change_pp']} pts this period).")
        return "\n".join(lines)

    def _waste(self, c):
        w = c["waste"]
        if not w["top_ingredients"]:
            return "No waste recorded in this period. Ask the kitchen team to log waste so its cost can be tracked."
        lines = [f"Recorded waste cost {_gbp(w['total_cost'])} this period"
                 + (f" ({w['change_pct']:+}% vs previous period)." if w["change_pct"] is not None else ".")]
        for t in w["top_ingredients"][:3]:
            lines.append(f"- {t['name']}: {t['quantity']} {t['unit']} ({_gbp(t['cost'])}). {t['suggestion']}")
        if w["by_reason"]:
            lines.append(f"Main reason: {w['by_reason'][0]['reason'].replace('_', ' ')} ({_gbp(w['by_reason'][0]['cost'])}).")
        return "\n".join(lines)

    def _forecast(self, c):
        f = c["forecast_4_weeks"]
        p = f["projection"][-1]
        lines = [f"Projection (not actuals) for week starting {p['week_start']}: revenue ≈{_gbp(p['revenue'])}, "
                 f"ingredient spend ≈{_gbp(p['ingredient_expenditure'])}, food cost ≈{p['food_cost_pct']}%."]
        if f["ingredient_prices"]:
            lines.append("Ingredients trending up: " + ", ".join(
                f"{i['name']} (→{_gbp(i['projected_price'])}/{i['unit']})" for i in f["ingredient_prices"][:3]) + ".")
        if f["margin_warnings"]:
            lines.append("Margin warnings if trends continue: " + ", ".join(f["margin_warnings"]) + ".")
        lines.append(f"Method: {f['method']}")
        return "\n".join(lines)

    def _scenario(self, c):
        s = c["scenario"]
        r = s["result"]
        lines = [f"Scenario: {s['description']} (simulation, {r['basis']})."]
        lines.append(f"Weekly gross profit {_gbp(r['baseline']['weekly_gross_profit'])} → {_gbp(r['scenario']['weekly_gross_profit'])} "
                     f"({'+' if r['weekly_gross_profit_change'] >= 0 else ''}{_gbp(r['weekly_gross_profit_change'])} a week, "
                     f"≈{_gbp(r['annualised_gross_profit_change'])}/year). Food cost {r['baseline']['food_cost_pct']}% → {r['scenario']['food_cost_pct']}%.")
        moved = [d for d in r["dishes"] if d["weekly_gross_profit_change"] != 0][:3]
        for d in moved:
            lines.append(f"- {d['name']}: margin {d['baseline']['gross_margin_pct']}% → {d['scenario']['gross_margin_pct']}%.")
        lines.append("Assumes unchanged sales volumes" + ("; a menu price rise may reduce demand." if s["kind"] == "menu_price" else "."))
        return "\n".join(lines)
