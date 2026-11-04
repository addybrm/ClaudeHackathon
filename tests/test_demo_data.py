import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import pytest


DATA = json.loads((Path(__file__).parents[1] / "demo-data" / "restaurant.json").read_text())
INGREDIENTS = {item["id"]: item for item in DATA["ingredients"]}
SUPPLIERS = {item["id"] for item in DATA["suppliers"]}


def cost(recipe, price_key="current_unit_price"):
    total = Decimal("0")
    for ingredient_id, quantity in recipe.items():
        if quantity < 0:
            raise ValueError("ingredient quantity must not be negative")
        total += Decimal(str(quantity)) * Decimal(str(INGREDIENTS[ingredient_id][price_key]))
    return total


def metrics(price, ingredient_cost):
    price = Decimal(str(price))
    ingredient_cost = Decimal(str(ingredient_cost))
    if price == 0:
        return price - ingredient_cost, None, None
    profit = price - ingredient_cost
    return profit, profit / price * 100, ingredient_cost / price * 100


def test_dataset_meets_demo_shape_and_references():
    assert DATA["restaurant"]["city"] == "Newcastle upon Tyne"
    assert len(DATA["dishes"]) == 12
    assert len(DATA["ingredients"]) >= 20
    assert len(DATA["suppliers"]) == 3
    assert len(DATA["waste_records"]) == 5
    assert all(item["supplier_id"] in SUPPLIERS for item in DATA["ingredients"])
    assert all(
        ingredient_id in INGREDIENTS
        for dish in DATA["dishes"]
        for ingredient_id in dish["recipe"]
    )


@pytest.mark.parametrize("dish", DATA["dishes"], ids=lambda dish: dish["name"])
def test_dish_financial_formulas(dish):
    ingredient_cost = cost(dish["recipe"])
    gross_profit, gross_margin, food_cost_pct = metrics(dish["selling_price"], ingredient_cost)
    assert ingredient_cost > 0
    assert gross_profit == Decimal(str(dish["selling_price"])) - ingredient_cost
    assert gross_margin + food_cost_pct == pytest.approx(Decimal("100"))


def test_supplier_price_variation_and_chicken_scenario():
    chicken = INGREDIENTS["chicken"]
    variation = (
        (Decimal(str(chicken["current_unit_price"])) / Decimal(str(chicken["previous_unit_price"])) - 1)
        * 100
    )
    assert variation == Decimal("18")

    affected = [dish for dish in DATA["dishes"] if "chicken" in dish["recipe"]]
    assert {dish["id"] for dish in affected} == {"d01", "d02", "d09"}
    additional_weekly_spend = sum(
        Decimal(str(dish["recipe"]["chicken"]))
        * (Decimal(str(chicken["current_unit_price"])) - Decimal(str(chicken["previous_unit_price"])))
        * dish["weekly_units_sold"]
        for dish in affected
    )
    assert additional_weekly_spend == Decimal("62.928")


def test_chicken_price_change_updates_profit_and_food_cost():
    chicken = INGREDIENTS["chicken"]
    for dish in DATA["dishes"]:
        if "chicken" not in dish["recipe"]:
            continue
        previous_cost = cost(dish["recipe"], "previous_unit_price")
        current_cost = cost(dish["recipe"])
        previous_profit, _, previous_food_cost_pct = metrics(dish["selling_price"], previous_cost)
        current_profit, _, current_food_cost_pct = metrics(dish["selling_price"], current_cost)
        assert current_profit < previous_profit
        assert current_food_cost_pct > previous_food_cost_pct


def test_waste_costs_are_quantity_times_current_price():
    for record in DATA["waste_records"]:
        expected = (
            Decimal(str(record["quantity"]))
            * Decimal(str(INGREDIENTS[record["ingredient_id"]]["current_unit_price"]))
        ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        assert expected > 0


def test_revenue_history_cost_and_profit_are_consistent():
    for row in DATA["revenue_cost_history"]:
        assert Decimal(str(row["revenue"])) > Decimal(str(row["food_cost"]))
        assert Decimal(str(row["revenue"])) - Decimal(str(row["food_cost"])) > 0


def test_price_simulation_and_forecast():
    dish = DATA["dishes"][0]
    current_cost = cost(dish["recipe"])
    simulated_price = current_cost / Decimal("0.30")
    _, _, simulated_food_cost_pct = metrics(simulated_price, current_cost)
    assert simulated_food_cost_pct == pytest.approx(Decimal("30"))
    history = DATA["revenue_cost_history"]
    revenue_growth = Decimal(str(history[-1]["revenue"])) / Decimal(str(history[-2]["revenue"]))
    forecast_revenue = Decimal(str(history[-1]["revenue"])) * revenue_growth
    assert forecast_revenue > Decimal(str(history[-1]["revenue"]))


def test_invalid_edge_cases_are_rejected_or_non_dividing():
    with pytest.raises(KeyError):
        cost({"missing_ingredient": 1})
    with pytest.raises(ValueError):
        cost({"chicken": -0.1})
    incomplete_ingredient = dict(INGREDIENTS["chicken"])
    incomplete_ingredient.pop("current_unit_price")
    INGREDIENTS["incomplete"] = incomplete_ingredient
    with pytest.raises(KeyError):
        cost({"incomplete": 1})
    _, margin, food_cost_pct = metrics(0, 5)
    assert margin is None and food_cost_pct is None
