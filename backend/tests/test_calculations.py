"""Deterministic finance: formulas, consistency and invariants."""
from decimal import Decimal

import pytest

from app.services.finance import change_pct, dish_metrics, linear_fit, price_for_target_food_cost, recipe_cost


def test_dish_metrics_formulas():
    m = dish_metrics(10, 3)
    assert m["gross_profit"] == 7.0
    assert m["gross_margin_pct"] == 70.0      # profit / PRICE
    assert m["food_cost_pct"] == 30.0         # cost / price
    assert m["markup_pct"] == 233.33          # profit / COST, reported separately (never as margin)


def test_dish_metrics_rejects_non_positive_price():
    with pytest.raises(ValueError):
        dish_metrics(0, 1)


def test_cost_above_price_gives_negative_margin():
    m = dish_metrics(5, 6)
    assert m["gross_profit"] == -1.0 and m["gross_margin_pct"] == -20.0 and m["food_cost_pct"] == 120.0


def test_recipe_cost_and_helpers():
    prices = {"a": Decimal("2.50"), "b": Decimal("0.10")}
    assert recipe_cost([("a", Decimal("0.2")), ("b", Decimal("3"))], prices.__getitem__) == Decimal("0.800")
    assert change_pct(14.20, 17.90) == 26.06
    assert change_pct(0, 5) is None
    assert price_for_target_food_cost(5.47, 30) == 18.23
    slope, icpt = linear_fit([1, 2, 3, 4])
    assert slope == 1 and icpt == 1


def test_every_dish_is_internally_consistent(client):
    ingredients = {i["id"]: i for i in client.get("/api/ingredients").json()}
    for d in client.get("/api/menu").json()["dishes"]:
        manual = sum(Decimal(str(l["quantity"])) * Decimal(str(ingredients[l["ingredient_id"]]["current_price"]))
                     for l in d["ingredients"])
        assert abs(float(manual) - d["ingredient_cost"]) <= 0.01
        assert abs(d["selling_price"] - d["ingredient_cost"] - d["gross_profit"]) <= 0.01
        assert abs(d["gross_margin_pct"] + d["food_cost_pct"] - 100) <= 0.02


def test_dashboard_identities(client):
    k = client.get("/api/dashboard").json()["kpis"]
    assert abs(k["revenue"] - k["ingredient_expenditure"] - k["gross_profit"]) <= 0.01
    assert abs(k["ingredient_expenditure"] - k["theoretical_food_cost"] - k["waste_cost"] - k["unexplained_variance"]) <= 0.02
    assert abs(k["gross_margin_pct"] + k["food_cost_pct"] - 100) <= 0.02


def test_locations_sum_to_total(client):
    total = client.get("/api/dashboard").json()["kpis"]
    parts = [client.get(f"/api/dashboard?location_id={i}").json()["kpis"] for i in (1, 2)]
    for key in ("revenue", "ingredient_expenditure", "waste_cost"):
        assert abs(sum(p[key] for p in parts) - total[key]) <= 0.02


def test_results_are_deterministic(client):
    assert client.get("/api/dashboard").json()["kpis"] == client.get("/api/dashboard").json()["kpis"]
    assert client.get("/api/leakage").json() == client.get("/api/leakage").json()


def test_date_filter_and_validation(client):
    full = client.get("/api/dashboard?start=2026-08-10&end=2026-11-01").json()
    assert full["period"]["weeks_of_sales"] == 12
    assert client.get("/api/dashboard?start=2026-10-10&end=2026-10-01").status_code == 422
    assert client.get("/api/dashboard?location_id=99").status_code == 404


def test_leakage_story_is_detected(client):
    alerts = client.get("/api/alerts").json()["alerts"]
    types = {(a["type"], a["entity"].get("ingredient_id") or a["entity"].get("dish_id")) for a in alerts}
    assert ("purchasing_variance", "cod_fillet") in types
    assert ("cheaper_supplier", "cod_fillet") in types
    leak = client.get("/api/leakage").json()
    total = sum(c["amount"] for c in leak["categories"])
    assert abs(total - leak["total_estimated_leakage"]) <= 0.02


def test_simulation_menu_price(client):
    base = client.post("/api/simulate", json={}).json()
    assert base["weekly_gross_profit_change"] == 0
    r = client.post("/api/simulate", json={"menu_prices": {"fish_chips": 17.50}}).json()
    row = next(d for d in r["dishes"] if d["dish_id"] == "fish_chips")
    assert abs(r["weekly_gross_profit_change"] - 1.00 * row["baseline"]["weekly_units"]) <= 0.02
    assert client.post("/api/simulate", json={"menu_prices": {"nope": 5}}).status_code == 422
    assert client.post("/api/simulate", json={"ingredient_price_changes_pct": {"cod_fillet": 900}}).status_code == 422


def test_forecast_is_labelled_projection(client):
    f = client.get("/api/forecast?weeks=4").json()
    assert all(p["type"] == "projection" for p in f["projection"])
    assert all(h["type"] == "actual" for h in f["history"])
    assert len(f["projection"]) == 4
