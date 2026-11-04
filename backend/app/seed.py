"""Deterministic demo dataset: a FICTIONAL independent restaurant group in North East England.

All names (restaurant, suppliers, users) are invented for demonstration. Prices are illustrative
GBP wholesale prices, not sourced market data. The generator is seeded, so every run produces
identical data (and identical financial results).

Story baked into the data (12 weeks, Mon 10 Aug - Sun 1 Nov 2026):
  * Lamb shoulder +23.7% and cod fillet +21.9% over the period -> lamb & fish dishes lose margin.
  * Cod is over-purchased ~7% vs recipe usage (over-portioning) -> unexplained purchasing variance.
  * Cheaper quotes exist from alternative suppliers for cod, lamb and potatoes.
  * Cod prep-error waste rises in the last four weeks.
"""
import random
from datetime import date, timedelta
from decimal import Decimal
from sqlalchemy import select
from sqlalchemy.orm import Session
from . import models as m
from .auth import hash_password
from .db import Base, engine

FIRST_WEEK = date(2026, 8, 10)  # Monday
WEEKS = 12
WEEK_STARTS = [FIRST_WEEK + timedelta(weeks=i) for i in range(WEEKS)]

SUPPLIERS = [  # (name, category, primary?)
    ("Tyneside Meats", "Meat"),
    ("North Sea Catch", "Fish"),
    ("Northumbria Fresh Produce", "Produce"),
    ("Wear Valley Dairy", "Dairy"),
    ("Northern Dry Goods", "Dry goods"),
    ("Coast Road Fisheries", "Fish"),        # alternative (quotes only)
    ("Dales Farm Butchers", "Meat"),         # alternative (quotes only)
    ("Gateshead Wholesale Produce", "Produce"),  # alternative (quotes only)
]

# id: (name, unit, category, primary supplier index, {week_index: price})
INGREDIENTS = {
    "beef_mince":   ("Beef mince", "kg", "Meat", 0, {0: "8.40", 7: "9.10"}),
    "lamb_shoulder": ("Lamb shoulder", "kg", "Meat", 0, {0: "11.80", 5: "12.90", 9: "14.60"}),
    "chicken_breast": ("Chicken breast", "kg", "Meat", 0, {0: "6.20", 9: "6.45"}),
    "pork_belly":   ("Pork belly", "kg", "Meat", 0, {0: "6.90"}),
    "cod_fillet":   ("Cod fillet", "kg", "Fish", 1, {0: "15.50", 6: "17.20", 10: "18.90"}),
    "haddock_fillet": ("Haddock fillet", "kg", "Fish", 1, {0: "13.20", 8: "14.10"}),
    "potatoes":     ("Maris Piper potatoes", "kg", "Produce", 2, {0: "0.85", 4: "0.95", 10: "1.10"}),
    "onions":       ("Onions", "kg", "Produce", 2, {0: "0.90"}),
    "tomatoes":     ("Tomatoes", "kg", "Produce", 2, {0: "2.40", 8: "2.95"}),
    "mixed_veg":    ("Seasonal vegetables", "kg", "Produce", 2, {0: "2.20", 9: "2.35"}),
    "garden_peas":  ("Garden peas", "kg", "Produce", 2, {0: "1.60"}),
    "butter":       ("Butter", "kg", "Dairy", 3, {0: "7.80", 6: "8.60"}),
    "milk":         ("Whole milk", "l", "Dairy", 3, {0: "0.95"}),
    "cream":        ("Double cream", "l", "Dairy", 3, {0: "3.40"}),
    "cheddar":      ("Mature cheddar", "kg", "Dairy", 3, {0: "9.50", 10: "9.90"}),
    "eggs":         ("Free-range eggs", "each", "Dairy", 3, {0: "0.24", 7: "0.28"}),
    "flour":        ("Plain flour", "kg", "Dry goods", 4, {0: "0.75"}),
    "rapeseed_oil": ("Rapeseed frying oil", "l", "Dry goods", 4, {0: "2.10", 5: "2.60"}),
    "brioche_bun":  ("Brioche bun", "each", "Dry goods", 4, {0: "0.42"}),
    "dates":        ("Medjool dates", "kg", "Dry goods", 4, {0: "4.80"}),
    "sugar":        ("Muscovado sugar", "kg", "Dry goods", 4, {0: "1.10"}),
    "pantry":       ("Seasoning, sauces & garnish allowance", "portion", "Dry goods", 4, {0: "0.45"}),
}

# Alternative-supplier quotes: (supplier index, ingredient, week index, price)
QUOTES = [
    (5, "cod_fillet", 11, "17.60"), (5, "haddock_fillet", 11, "14.40"),
    (6, "lamb_shoulder", 11, "13.40"), (6, "beef_mince", 11, "9.30"),
    (7, "potatoes", 11, "0.98"), (7, "tomatoes", 11, "3.05"),
]

# id: (name, category, price, base weekly units at main site, recipe {ingredient: qty})
DISHES = {
    "fish_chips":  ("Beer-battered Cod & Chips", "Mains", "16.50", 140,
                    {"cod_fillet": "0.22", "potatoes": "0.35", "flour": "0.05", "rapeseed_oil": "0.12",
                     "garden_peas": "0.08", "pantry": "1"}),
    "lamb_shoulder": ("Slow-braised Lamb Shoulder", "Mains", "21.00", 55,
                      {"lamb_shoulder": "0.38", "potatoes": "0.25", "mixed_veg": "0.15", "butter": "0.02", "pantry": "1"}),
    "steak_burger": ("Northumbrian Steak Burger", "Mains", "15.50", 95,
                     {"beef_mince": "0.20", "brioche_bun": "1", "cheddar": "0.03", "potatoes": "0.25",
                      "rapeseed_oil": "0.06", "tomatoes": "0.03", "pantry": "1"}),
    "chicken_parmo": ("Chicken Parmo", "Mains", "15.00", 110,
                      {"chicken_breast": "0.25", "flour": "0.04", "eggs": "1", "cheddar": "0.06", "milk": "0.10",
                       "butter": "0.02", "rapeseed_oil": "0.10", "potatoes": "0.25", "pantry": "1"}),
    "pork_belly":  ("Crispy Pork Belly", "Mains", "18.50", 45,
                    {"pork_belly": "0.30", "potatoes": "0.20", "mixed_veg": "0.15", "pantry": "1"}),
    "haddock":     ("Pan-fried Haddock", "Mains", "19.00", 40,
                    {"haddock_fillet": "0.20", "potatoes": "0.20", "butter": "0.03", "mixed_veg": "0.10", "pantry": "1"}),
    "beef_pie":    ("Beef & Stout Pie", "Mains", "14.50", 70,
                    {"beef_mince": "0.18", "flour": "0.08", "butter": "0.04", "onions": "0.05", "potatoes": "0.25",
                     "pantry": "1"}),
    "tomato_soup": ("Roast Tomato Soup", "Starters", "6.50", 60,
                    {"tomatoes": "0.25", "onions": "0.05", "cream": "0.03", "pantry": "0.5"}),
    "veg_tart":    ("Roast Vegetable & Cheddar Tart", "Mains", "12.50", 35,
                    {"flour": "0.06", "butter": "0.03", "mixed_veg": "0.15", "cheddar": "0.05", "eggs": "2",
                     "pantry": "0.8"}),
    "sticky_toffee": ("Sticky Toffee Pudding", "Desserts", "7.50", 80,
                      {"dates": "0.05", "flour": "0.04", "butter": "0.04", "sugar": "0.05", "eggs": "1",
                       "cream": "0.05", "pantry": "0.4"}),
}

LOCATIONS = [("Quayside", "Newcastle upon Tyne", Decimal("1.0")), ("Elvet", "Durham", Decimal("0.65"))]
SEASON = ["0.92", "0.95", "1.00", "0.97", "0.90", "0.93", "0.98", "1.02", "1.00", "1.05", "1.08", "1.10"]
# purchases above theoretical recipe usage (unexplained variance: portioning, unrecorded waste)
OVER_PURCHASE = {"cod_fillet": "0.07", "rapeseed_oil": "0.04", "lamb_shoulder": "0.02", "beef_mince": "0.02"}
DEFAULT_OVER = "0.015"

DEMO_USERS = [  # demo credentials, documented; NOT for production
    ("owner@marginos.demo", "Demo Owner", "owner"),
    ("manager@marginos.demo", "Demo Manager", "manager"),
    ("kitchen@marginos.demo", "Demo Kitchen Manager", "kitchen"),
    ("finance@marginos.demo", "Demo Finance Admin", "finance"),
]
DEMO_PASSWORD = "demo-password"


def price_at(ing: str, week: int) -> Decimal:
    sched = INGREDIENTS[ing][4]
    return Decimal(sched[max(w for w in sched if w <= week)])


def seed(db: Session) -> None:
    rng = random.Random(2026)
    q2 = Decimal("0.01")

    db.add(m.Restaurant(id=1, name="Tyne & Table (fictional demo)", currency="GBP",
                        region="North East England", is_demo=True))
    db.flush()
    locs = [m.Location(id=i + 1, restaurant_id=1, name=n, city=c) for i, (n, c, _) in enumerate(LOCATIONS)]
    db.add_all(locs)
    sups = [m.Supplier(id=i + 1, name=n, category=c, contact_email=f"orders@{n.lower().replace(' ', '')}.example")
            for i, (n, c) in enumerate(SUPPLIERS)]
    db.add_all(sups)
    db.flush()  # parents first: there are no ORM relationships to order the inserts
    for email, name, role in DEMO_USERS:
        db.add(m.User(email=email, name=name, role=role, password_hash=hash_password(DEMO_PASSWORD)))
    for iid, (name, unit, cat, sup, _) in INGREDIENTS.items():
        db.add(m.Ingredient(id=iid, name=name, unit=unit, category=cat, primary_supplier_id=sup + 1))
    db.flush()
    for did, (name, cat, price, _, recipe) in DISHES.items():
        db.add(m.Dish(id=did, name=name, category=cat, selling_price=Decimal(price),
                      recipe=[m.RecipeLine(ingredient_id=i, quantity=Decimal(q)) for i, q in recipe.items()]))
    db.flush()

    inv_no = 1000
    for w, ws in enumerate(WEEK_STARTS):
        for li, (_, _, loc_factor) in enumerate(LOCATIONS):
            loc_id = li + 1
            usage: dict[str, Decimal] = {}
            for did, (_, _, price, base, recipe) in DISHES.items():
                jitter = Decimal(str(round(rng.uniform(0.95, 1.05), 3)))
                qty = int((Decimal(base) * loc_factor * Decimal(SEASON[w]) * jitter).to_integral_value())
                db.add(m.Sale(location_id=loc_id, dish_id=did, week_start=ws, quantity=qty, unit_price=Decimal(price)))
                for ing, q in recipe.items():
                    usage[ing] = usage.get(ing, Decimal(0)) + Decimal(q) * qty

            # waste (recorded by kitchen) -> also purchased
            waste_plan = [
                ("potatoes", rng.uniform(2.0, 4.0) * float(loc_factor), "overproduction"),
                ("mixed_veg", rng.uniform(0.8, 2.0) * float(loc_factor), "spoiled"),
                ("tomatoes", rng.uniform(0.5, 1.5) * float(loc_factor), "spoiled"),
                ("brioche_bun", round(rng.uniform(4, 10) * float(loc_factor)), "expired"),
                ("cod_fillet", rng.uniform(0.3, 0.7) * (1.8 if w >= 8 else 1.0) * float(loc_factor), "prep_error"),
            ]
            if w % 2 == 0:
                waste_plan.append(("cream", rng.uniform(0.5, 1.5) * float(loc_factor), "expired"))
            waste_qty: dict[str, Decimal] = {}
            for ing, q, reason in waste_plan:
                qd = Decimal(str(q)).quantize(q2) if INGREDIENTS[ing][1] != "each" else Decimal(int(q))
                if qd <= 0:
                    continue
                unit_cost = price_at(ing, w)
                db.add(m.WasteRecord(location_id=loc_id, ingredient_id=ing, recorded_on=ws + timedelta(days=rng.randint(0, 6)),
                                     quantity=qd, unit=INGREDIENTS[ing][1], reason=reason, unit_cost=unit_cost,
                                     cost=(qd * unit_cost).quantize(Decimal("0.0001")), recorded_by="kitchen@marginos.demo"))
                waste_qty[ing] = waste_qty.get(ing, Decimal(0)) + qd

            # one invoice per primary supplier per location per week (Tuesday delivery)
            by_sup: dict[int, list] = {}
            for ing, used in usage.items():
                over = Decimal(OVER_PURCHASE.get(ing, DEFAULT_OVER))
                bought = used * (1 + over) + waste_qty.get(ing, Decimal(0))
                bought = bought.quantize(q2) if INGREDIENTS[ing][1] not in ("each", "portion") else bought.to_integral_value()
                by_sup.setdefault(INGREDIENTS[ing][3] + 1, []).append((ing, bought))
            for sup_id, lines in sorted(by_sup.items()):
                inv_no += 1
                inv = m.Invoice(supplier_id=sup_id, location_id=loc_id, invoice_number=f"INV-{inv_no}",
                                invoice_date=ws + timedelta(days=1), source="seed")
                for ing, qty in lines:
                    up = price_at(ing, w)
                    inv.lines.append(m.InvoiceLine(ingredient_id=ing, quantity=qty, unit_price=up,
                                                   line_total=(qty * up).quantize(Decimal("0.0001"))))
                db.add(inv)
                db.flush()
                for ln in inv.lines:
                    db.add(m.PriceRecord(ingredient_id=ln.ingredient_id, supplier_id=sup_id, observed_on=inv.invoice_date,
                                         unit_price=ln.unit_price, source="invoice", invoice_id=inv.id))
    for sup, ing, w, price in QUOTES:
        db.add(m.PriceRecord(ingredient_id=ing, supplier_id=sup + 1, observed_on=WEEK_STARTS[w] + timedelta(days=2),
                             unit_price=Decimal(price), source="quote"))
    db.commit()


def init_db(reset: bool = False) -> None:
    if reset:
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    from .db import SessionLocal
    with SessionLocal() as db:
        if db.scalar(select(m.Restaurant.id).limit(1)) is None:
            seed(db)
