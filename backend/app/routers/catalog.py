"""Menu (FR8-FR11), ingredients, suppliers (FR5-FR7), locations (FR18)."""
import re
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session
from .. import models as m
from ..auth import Principal, require
from ..db import get_db
from ..schemas import DishIn
from ..services import analytics as A
from ..services.finance import money
from .deps import Ctx, analysis_ctx

router = APIRouter(prefix="/api", tags=["catalog"])


@router.get("/locations")
def locations(db: Session = Depends(get_db), _: Principal = Depends(require("read"))):
    return [{"id": l.id, "name": l.name, "city": l.city} for l in db.scalars(select(m.Location))]


@router.get("/menu")
def menu(c: Ctx = Depends(analysis_ctx)):
    return A.menu(c.snap, c.period)


@router.get("/menu/{dish_id}")
def dish(dish_id: str, c: Ctx = Depends(analysis_ctx)):
    d = c.snap.dishes.get(dish_id)
    if not d:
        raise HTTPException(404, f"Dish '{dish_id}' not found")
    return A.dish_detail(c.snap, d, c.period)


def _apply(d: m.Dish, body: DishIn, db: Session):
    known = {i for i in db.scalars(select(m.Ingredient.id))}
    bad = [l.ingredient_id for l in body.recipe if l.ingredient_id not in known]
    if bad:
        raise HTTPException(422, f"Unknown ingredient_id(s): {', '.join(bad)}")
    d.name, d.category, d.selling_price = body.name.strip(), body.category.strip(), Decimal(str(body.selling_price))
    d.recipe.clear()
    db.flush()
    d.recipe.extend(m.RecipeLine(ingredient_id=l.ingredient_id, quantity=Decimal(str(l.quantity))) for l in body.recipe)


@router.post("/menu", status_code=201)
def create_dish(body: DishIn, db: Session = Depends(get_db), _: Principal = Depends(require("menu:write"))):
    did = body.id or re.sub(r"[^a-z0-9]+", "_", body.name.lower()).strip("_")[:40]
    if db.get(m.Dish, did):
        raise HTTPException(409, f"Dish id '{did}' already exists")
    d = m.Dish(id=did, name=body.name, category=body.category, selling_price=Decimal("1"))
    db.add(d)
    _apply(d, body, db)
    db.commit()
    snap = A.Snapshot(db)
    return A.dish_detail(snap, snap.dishes[did], snap.period(None, None))


@router.put("/menu/{dish_id}")
def update_dish(dish_id: str, body: DishIn, db: Session = Depends(get_db), _: Principal = Depends(require("menu:write"))):
    d = db.get(m.Dish, dish_id)
    if not d or not d.active:
        raise HTTPException(404, f"Dish '{dish_id}' not found")
    _apply(d, body, db)
    db.commit()
    snap = A.Snapshot(db)
    return A.dish_detail(snap, snap.dishes[dish_id], snap.period(None, None))


@router.delete("/menu/{dish_id}")
def archive_dish(dish_id: str, db: Session = Depends(get_db), _: Principal = Depends(require("menu:write"))):
    d = db.get(m.Dish, dish_id)
    if not d or not d.active:
        raise HTTPException(404, f"Dish '{dish_id}' not found")
    d.active = False  # soft delete: sales history is kept
    db.commit()
    return {"id": dish_id, "archived": True}


@router.get("/ingredients")
def ingredients(db: Session = Depends(get_db), _: Principal = Depends(require("read"))):
    snap = A.Snapshot(db)
    return [{"id": i.id, "name": i.name, "unit": i.unit, "category": i.category, "current_price": money(snap.current_price(i.id)),
             "current_supplier": snap.current_supplier(i.id)} for i in snap.ingredients.values()]


@router.get("/suppliers")
def suppliers(c: Ctx = Depends(analysis_ctx)):
    return {"period": A._period_meta(c.snap, c.period), "suppliers": A.suppliers_overview(c.snap, c.period)}


@router.get("/suppliers/price-changes")
def price_changes(c: Ctx = Depends(analysis_ctx)):
    return {"period": A._period_meta(c.snap, c.period), "changes": A.supplier_changes(c.snap, c.period)}


@router.get("/suppliers/comparison")
def comparison(c: Ctx = Depends(analysis_ctx)):
    return {"period": A._period_meta(c.snap, c.period), "comparisons": A.supplier_comparison(c.snap, c.period)}


@router.get("/ingredients/{ingredient_id}/price-history")
def price_history(ingredient_id: str, db: Session = Depends(get_db), _: Principal = Depends(require("read"))):
    snap = A.Snapshot(db)
    if ingredient_id not in snap.ingredients:
        raise HTTPException(404, f"Ingredient '{ingredient_id}' not found")
    i = snap.ingredients[ingredient_id]
    quotes = [{"date": q.observed_on.isoformat(), "unit_price": money(q.unit_price), "supplier": snap.suppliers[q.supplier_id].name}
              for q in snap.quotes if q.ingredient_id == ingredient_id]
    return {"ingredient_id": i.id, "name": i.name, "unit": i.unit, "history": snap.history(i.id), "quotes": quotes}
