import json
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import pytest


DATA = json.loads((Path(__file__).parent / "demo_restaurant.json").read_text())
INGREDIENTS = {item["id"]: item for item in DATA["ingredients"]}


def calculate_cost(dish):
    return sum(
        Decimal(str(line["quantity"]))
        * Decimal(str(INGREDIENTS[line["ingredient_id"]]["unit_cost"]))
        for line in dish["ingredients"]
    )


def metrics(selling_price, ingredient_cost):
    price = Decimal(str(selling_price))
    cost = Decimal(str(ingredient_cost))
    if price == 0:
        return {"gross_profit": price - cost, "gross_margin_pct": None, "food_cost_pct": None}
    profit = price - cost
    return {
        "gross_profit": profit,
        "gross_margin_pct": profit / price * 100,
        "food_cost_pct": cost / price * 100,
    }


def test_dataset_has_ten_costable_dishes_and_valid_references():
    assert len(DATA["dishes"]) >= 10
    supplier_ids = {item["id"] for item in DATA["suppliers"]}
    assert all(item["supplier_id"] in supplier_ids for item in DATA["ingredients"])
    assert all(line["ingredient_id"] in INGREDIENTS for dish in DATA["dishes"] for line in dish["ingredients"])


@pytest.mark.parametrize("dish", DATA["dishes"], ids=lambda dish: dish["name"])
def test_dish_cost_and_percentages_are_mathematically_consistent(dish):
    cost = calculate_cost(dish)
    result = metrics(dish["selling_price"], cost)
    assert cost > 0
    assert result["gross_profit"] == Decimal(str(dish["selling_price"])) - cost
    assert result["gross_margin_pct"] + result["food_cost_pct"] == pytest.approx(Decimal("100"))


def test_olive_oil_increase_is_fourteen_percent_and_affects_dishes():
    history = [item for item in DATA["price_history"] if item["ingredient_id"] == "olive_oil"]
    increase = (Decimal(str(history[1]["unit_cost"])) / Decimal(str(history[0]["unit_cost"])) - 1) * 100
    assert increase == Decimal("14")
    assert sum(any(line["ingredient_id"] == "olive_oil" for line in dish["ingredients"]) for dish in DATA["dishes"]) >= 6


def test_waste_cost_matches_quantity_times_current_unit_cost():
    for record in DATA["waste_records"]:
        expected = Decimal(str(record["quantity"])) * Decimal(str(INGREDIENTS[record["ingredient_id"]]["unit_cost"]))
        assert expected.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) == Decimal(str(record["cost"]))


def test_zero_selling_price_does_not_divide_by_zero():
    result = metrics(0, Decimal("4.25"))
    assert result == {"gross_profit": Decimal("-4.25"), "gross_margin_pct": None, "food_cost_pct": None}


def test_missing_ingredient_is_explicitly_rejected():
    dish = {"selling_price": 10, "ingredients": [{"ingredient_id": "not-in-catalog", "quantity": 1}]}
    with pytest.raises(KeyError):
        calculate_cost(dish)
