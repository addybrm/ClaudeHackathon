"""Pure, deterministic financial formulas. No I/O, no AI. Decimal arithmetic throughout.

    ingredient cost   = sum(quantity x unit cost)
    gross profit      = selling price - ingredient cost
    gross margin %    = gross profit / selling price x 100        (share of the PRICE kept)
    food cost %       = ingredient cost / selling price x 100     (= 100 - gross margin %)
    markup %          = gross profit / ingredient cost x 100      (reported separately; never used as margin)
    price variation % = (new - old) / old x 100
"""
from decimal import Decimal, ROUND_HALF_UP
from typing import Callable, Iterable

ZERO = Decimal("0")
HUNDRED = Decimal("100")


def D(x) -> Decimal:
    if isinstance(x, Decimal):
        return x
    return Decimal(str(x))


def money(x) -> float:
    """Round to pence for output."""
    return float(D(x).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def pct(x) -> float:
    return float(D(x).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def recipe_cost(lines: Iterable[tuple[str, Decimal]], price_of: Callable[[str], Decimal]) -> Decimal:
    return sum((D(q) * D(price_of(i)) for i, q in lines), ZERO)


def dish_metrics(selling_price, ingredient_cost) -> dict:
    price, cost = D(selling_price), D(ingredient_cost)
    if price <= 0:
        raise ValueError("selling price must be greater than zero")
    profit = price - cost
    return {
        "ingredient_cost": money(cost),
        "gross_profit": money(profit),
        "gross_margin_pct": pct(profit / price * HUNDRED),
        "food_cost_pct": pct(cost / price * HUNDRED),
        "markup_pct": pct(profit / cost * HUNDRED) if cost > 0 else None,
    }


def ratio_pct(part, whole) -> float | None:
    whole = D(whole)
    return pct(D(part) / whole * HUNDRED) if whole != 0 else None


def change_pct(old, new) -> float | None:
    old = D(old)
    return pct((D(new) - old) / old * HUNDRED) if old != 0 else None


def price_for_target_food_cost(cost, target_pct) -> float:
    """Selling price at which cost / price = target%."""
    return money(D(cost) / (D(target_pct) / HUNDRED))


def linear_fit(ys: list) -> tuple[Decimal, Decimal]:
    """Least-squares line through (0, y0), (1, y1)...; returns (slope, intercept) as Decimal."""
    n = len(ys)
    if n == 0:
        return ZERO, ZERO
    if n == 1:
        return ZERO, D(ys[0])
    xs = [D(i) for i in range(n)]
    ys = [D(y) for y in ys]
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    return slope, my - slope * mx
