"""Invoices (FR2-FR4), waste (FR15), auth (FR1), admin."""
from datetime import date, timedelta
from decimal import Decimal
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session
from .. import ai, models as m
from ..auth import Principal, current_user, issue_token, require, verify_password
from ..db import get_db
from ..schemas import InvoiceConfirm, LoginRequest, WasteIn
from ..services import analytics as A, invoices
from ..services.invoices import UNIT_ALIASES
from ..services.finance import money
from .deps import Ctx, analysis_ctx

router = APIRouter(prefix="/api", tags=["operations"])


# ---- auth -------------------------------------------------------------------
@router.post("/auth/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    u = db.scalars(select(m.User).where(m.User.email == body.email.strip().lower())).first()
    if not u or not verify_password(body.password, u.password_hash):
        raise HTTPException(401, "Incorrect email or password")
    return {"access_token": issue_token(u.email, u.name, u.role), "token_type": "bearer",
            "user": {"email": u.email, "name": u.name, "role": u.role}}


@router.get("/auth/me")
def me(user: Principal = Depends(current_user)):
    return {"email": user.email, "name": user.name, "role": user.role, "demo_session": user.demo}


# ---- invoices -----------------------------------------------------------------
@router.post("/invoices/upload")
async def upload(file: UploadFile = File(...), supplier: str | None = Form(None), db: Session = Depends(get_db),
                 _: Principal = Depends(require("invoice:write"))):
    """Extract a DRAFT from a CSV / PDF / image. Nothing is saved; confirm with POST /api/invoices.
    Optional form field `supplier` is used when the file itself names no supplier."""
    content = await file.read()
    return invoices.build_draft(file.filename or "", content, db, ai.get_provider(), supplier)


@router.post("/invoices", status_code=201)
def confirm(body: InvoiceConfirm, db: Session = Depends(get_db), user: Principal = Depends(require("invoice:write"))):
    return invoices.confirm(body, db, user.email)


@router.get("/invoices")
def list_invoices(limit: int = Query(50, ge=1, le=500), db: Session = Depends(get_db), _: Principal = Depends(require("read"))):
    return {"invoices": invoices.list_invoices(db, limit)}


# ---- waste ----------------------------------------------------------------------
@router.get("/waste")
def waste(c: Ctx = Depends(analysis_ctx)):
    recs = sorted((w for w in c.snap.waste if c.period.contains(w.recorded_on)), key=lambda w: (w.recorded_on, w.id), reverse=True)
    return {"summary": A.waste_summary(c.snap, c.period),
            "records": [{"id": w.id, "date": w.recorded_on.isoformat(), "location_id": w.location_id, "ingredient_id": w.ingredient_id,
                         "ingredient": c.snap.ingredients[w.ingredient_id].name, "quantity": float(w.quantity), "unit": w.unit,
                         "reason": w.reason, "unit_cost": money(w.unit_cost), "cost": money(w.cost)} for w in recs]}


@router.post("/waste", status_code=201)
def record_waste(body: WasteIn, db: Session = Depends(get_db), user: Principal = Depends(require("waste:write"))):
    snap = A.Snapshot(db)
    ing = snap.ingredients.get(body.ingredient_id)
    if not ing:
        raise HTTPException(422, f"Unknown ingredient_id '{body.ingredient_id}'")
    if body.location_id not in snap.locations:
        raise HTTPException(422, f"Unknown location_id {body.location_id}")
    on = body.recorded_on or date.today()
    if on > date.today() or on < date.today() - timedelta(days=365):
        raise HTTPException(422, "recorded_on must be within the last 365 days and not in the future")
    unit, factor = UNIT_ALIASES.get((body.unit or ing.unit).lower(), (None, None))
    if unit != ing.unit:
        raise HTTPException(422, f"Unit '{body.unit}' does not match ingredient unit '{ing.unit}'")
    qty = Decimal(str(body.quantity)) * Decimal(str(factor))
    unit_cost = snap.price_on(ing.id, on)
    rec = m.WasteRecord(location_id=body.location_id, ingredient_id=ing.id, recorded_on=on, quantity=qty, unit=ing.unit,
                        reason=body.reason, unit_cost=unit_cost, cost=(qty * unit_cost).quantize(Decimal("0.0001")),
                        recorded_by=user.email)
    db.add(rec)
    db.commit()
    return {"id": rec.id, "ingredient": ing.name, "quantity": float(qty), "unit": ing.unit, "reason": rec.reason,
            "date": on.isoformat(), "unit_cost": money(unit_cost), "estimated_cost": money(rec.cost)}


# ---- admin ------------------------------------------------------------------------
@router.post("/admin/reset-demo")
def reset_demo(_: Principal = Depends(require("admin"))):
    from ..seed import init_db
    init_db(reset=True)
    return {"reset": True}
