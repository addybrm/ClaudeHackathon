"""Invoice intelligence (Module D, FR2-FR6).

Flow:  upload (CSV / PDF / image)  ->  EXTRACT a draft (nothing saved)
       ->  user reviews & corrects   ->  CONFIRM (validated, saved, price history updated).
Extraction results are never saved without the confirm step.
"""
import io
import re
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
import pandas as pd
from fastapi import HTTPException
from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.orm import Session
from .. import config, models as m
from .finance import D, change_pct, money

UNIT_ALIASES = {"kg": ("kg", 1), "kgs": ("kg", 1), "kilo": ("kg", 1), "g": ("kg", Decimal("0.001")), "gr": ("kg", Decimal("0.001")),
                "l": ("l", 1), "ltr": ("l", 1), "litre": ("l", 1), "liter": ("l", 1), "ml": ("l", Decimal("0.001")),
                "each": ("each", 1), "ea": ("each", 1), "x": ("each", 1), "unit": ("each", 1), "pcs": ("each", 1),
                "portion": ("portion", 1)}
IMAGE_TYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}


def _num(x) -> Decimal | None:
    if x is None:
        return None
    s = re.sub(r"[£$€,\s]", "", str(x))
    if s in ("", "nan", "None"):
        return None
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def _date(x) -> date | None:
    if not x or str(x).strip() in ("", "nan"):
        return None
    s = str(x).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def match_ingredient(label: str, ingredients: dict[str, m.Ingredient]) -> str | None:
    lab = (label or "").strip().lower()
    if not lab:
        return None
    for i in ingredients.values():
        if lab in (i.id, i.name.lower()):
            return i.id
    best = None
    for i in ingredients.values():
        if i.id == "pantry":
            continue
        name = i.name.lower()
        words = [w for w in re.findall(r"[a-z]+", name) if len(w) > 3]
        if name in lab or (len(lab) >= 3 and lab in name) or (words and all(w in lab for w in words)):
            if best is None or len(i.name) > len(ingredients[best].name):
                best = i.id
    return best


def match_supplier(name: str | None, db: Session) -> m.Supplier | None:
    if not name:
        return None
    n = name.strip().lower()
    for s in db.scalars(select(m.Supplier)):
        if s.name.lower() == n or s.name.lower() in n or (len(n) > 4 and n in s.name.lower()):
            return s
    return None


def _draft_line(raw: str, label: str, qty, unit, unit_price, total, ingredients) -> dict:
    iid = match_ingredient(label, ingredients)
    q, up, lt = _num(qty), _num(unit_price), _num(total)
    if up is None and q and lt is not None:
        up = (lt / q).quantize(Decimal("0.0001"))
    if lt is None and q is not None and up is not None:
        lt = (q * up).quantize(Decimal("0.01"))
    return {"raw": raw, "description": label, "ingredient_id": iid,
            "ingredient_name": ingredients[iid].name if iid else None,
            "quantity": float(q) if q is not None else None,
            "unit": (str(unit).strip().lower() if unit and str(unit) != "nan" else (ingredients[iid].unit if iid else None)),
            "unit_price": float(up) if up is not None else None, "line_total": float(lt) if lt is not None else None}


def parse_csv(content: bytes, ingredients) -> dict:
    try:
        df = pd.read_csv(io.BytesIO(content), dtype=str)
    except Exception:
        raise HTTPException(422, "Could not read CSV file")
    df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
    pick = lambda *names: next((c for c in names if c in df.columns), None)
    c_label = pick("ingredient", "ingredient_id", "item", "description", "product", "name")
    c_qty, c_unit = pick("quantity", "qty"), pick("unit", "uom")
    c_price, c_total = pick("unit_price", "price", "unit_cost"), pick("total", "line_total", "amount")
    if not c_label or not c_qty or not (c_price or c_total):
        raise HTTPException(422, "CSV needs columns: ingredient (or item/description), quantity, and unit_price or total")
    c_sup, c_date, c_no = pick("supplier"), pick("invoice_date", "date"), pick("invoice_number", "invoice_no")
    first = df.iloc[0] if len(df) else {}
    lines = [_draft_line(",".join(str(v) for v in r.values), str(r[c_label]), r[c_qty], r[c_unit] if c_unit else None,
                         r[c_price] if c_price else None, r[c_total] if c_total else None, ingredients)
             for _, r in df.iterrows()]
    return {"supplier_name": first[c_sup] if c_sup else None, "invoice_date": first[c_date] if c_date else None,
            "invoice_number": first[c_no] if c_no else None, "lines": lines}


_LINE = re.compile(r"^(?P<label>[A-Za-z][A-Za-z &'\-/()]*?)\s+(?P<qty>\d+(?:\.\d+)?)\s*(?P<unit>kg|g|l|ml|each|ea|x|pcs)?\s+"
                   r"£?(?P<price>\d+(?:\.\d+)?)(?:\s+£?(?P<total>\d+(?:\.\d+)?))?\s*$", re.I)


def parse_pdf(content: bytes, ingredients) -> dict:
    try:
        text = "\n".join((pg.extract_text() or "") for pg in PdfReader(io.BytesIO(content)).pages)
    except Exception:
        raise HTTPException(422, "Could not read PDF file")
    if not text.strip():
        raise HTTPException(422, "No text found in PDF (scanned PDFs need image extraction; upload a photo or enter lines manually)")
    sup = re.search(r"(?im)^\s*supplier\s*[:\-]\s*(.+)$", text) or re.search(r"(?im)^\s*from\s*[:\-]\s*(.+)$", text)
    dt = re.search(r"(?i)(?:invoice\s*)?date\s*[:\-]\s*([0-9]{1,4}[./\-][0-9]{1,2}[./\-][0-9]{1,4}|\d{1,2} \w+ \d{4})", text)
    no = re.search(r"(?i)invoice\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9\-]+)", text)
    lines = []
    for raw in text.splitlines():
        mm = _LINE.match(raw.strip())
        if mm and not re.match(r"(?i)^(sub)?total|vat|invoice|date", mm["label"]):
            lines.append(_draft_line(raw.strip(), mm["label"].strip(), mm["qty"], mm["unit"], mm["price"], mm["total"], ingredients))
    return {"supplier_name": sup.group(1).strip() if sup else None, "invoice_date": dt.group(1) if dt else None,
            "invoice_number": no.group(1) if no else None, "lines": lines}


def validate_line(line: dict, ingredients) -> list[str]:
    issues = []
    iid = line.get("ingredient_id")
    if not iid or iid not in ingredients:
        issues.append("Ingredient not recognised: choose one from the list")
    q, up, lt = _num(line.get("quantity")), _num(line.get("unit_price")), _num(line.get("line_total"))
    if q is None or q <= 0:
        issues.append("Quantity must be greater than 0")
    if up is None or up <= 0:
        issues.append("Unit price must be greater than 0")
    if up is not None and up > 10000:
        issues.append("Unit price looks too high")
    unit = (line.get("unit") or "").lower()
    if iid in ingredients and unit:
        conv = UNIT_ALIASES.get(unit)
        if not conv or conv[0] != ingredients[iid].unit:
            issues.append(f"Unit '{unit}' does not match ingredient unit '{ingredients[iid].unit}'")
    if q and up and lt is not None and abs(q * up - lt) > max(Decimal("0.05"), lt * Decimal("0.01")):
        issues.append("Line total does not equal quantity x unit price")
    return issues


def build_draft(filename: str, content: bytes, db: Session, ai_provider, supplier_hint: str | None = None) -> dict:
    if len(content) > config.MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large (max 5 MB)")
    if not content:
        raise HTTPException(422, "Empty file")
    ext = (filename or "").lower().rsplit(".", 1)[-1]
    ingredients = {i.id: i for i in db.scalars(select(m.Ingredient))}
    notice = None
    if ext == "csv":
        draft, method = parse_csv(content, ingredients), "csv"
    elif ext == "pdf":
        if not content.startswith(b"%PDF"):
            raise HTTPException(422, "File is not a valid PDF")
        draft, method = parse_pdf(content, ingredients), "pdf_text"
    elif ext in IMAGE_TYPES:
        try:
            extracted = ai_provider.extract_invoice_image(content, IMAGE_TYPES[ext], list(ingredients.values()))
            failure = None
        except Exception as e:  # live provider error: degrade to manual entry, never guess
            extracted, failure = None, type(e).__name__
        if extracted is None:
            draft, method = {"supplier_name": None, "invoice_date": None, "invoice_number": None, "lines": []}, "manual_required"
            notice = (f"Image received, but automatic reading failed ({failure}). Please enter the invoice lines manually."
                      if failure else
                      "Image received. Automatic image reading needs a live AI provider (ANTHROPIC_API_KEY), which is not "
                      "configured, so please enter the invoice lines manually in the review step.")
        else:
            draft = {**extracted, "lines": [_draft_line(l.get("description", ""), l.get("description", ""), l.get("quantity"),
                                                        l.get("unit"), l.get("unit_price"), l.get("line_total"), ingredients)
                                            for l in extracted.get("lines", [])]}
            method = "claude_vision"
            notice = "Extracted by Claude from an image. Check every line carefully before confirming."
    else:
        raise HTTPException(415, "Unsupported file type. Upload .csv, .pdf, .png, .jpg/.jpeg or .webp")

    if not draft.get("supplier_name") and supplier_hint:
        draft["supplier_name"] = supplier_hint.strip()[:120]
    sup = match_supplier(draft.get("supplier_name"), db)
    inv_date = _date(draft.get("invoice_date"))
    for l in draft["lines"]:
        l["issues"] = validate_line(l, ingredients)
        cur = _current_price(db, l["ingredient_id"]) if l["ingredient_id"] else None
        l["previous_price"] = money(cur) if cur else None
        l["change_pct"] = change_pct(cur, l["unit_price"]) if cur and l["unit_price"] else None
        l["flagged"] = bool(l["change_pct"] is not None and l["change_pct"] >= config.PRICE_ALERT_PCT)
    header_issues = []
    if not sup:
        header_issues.append("Supplier not recognised: choose an existing supplier or enter a new name")
    if not inv_date:
        header_issues.append("Invoice date missing or unreadable")
    valid = [l for l in draft["lines"] if not l["issues"]]
    overspend = sum(((D(l["unit_price"]) - D(l["previous_price"])) * D(l["quantity"]) for l in valid
                     if l["previous_price"] and D(l["unit_price"]) > D(l["previous_price"])), Decimal(0))
    return {"status": "draft", "saved": False, "extraction_method": method, "notice": notice,
            "filename": filename, "supplier_name": draft.get("supplier_name"), "supplier_id": sup.id if sup else None,
            "matched_supplier": sup.name if sup else None,
            "invoice_date": inv_date.isoformat() if inv_date else None, "invoice_number": draft.get("invoice_number"),
            "lines": draft["lines"], "header_issues": header_issues,
            "ready_to_confirm": bool(draft["lines"]) and not header_issues and len(valid) == len(draft["lines"]),
            "total": money(sum((D(l["line_total"]) for l in draft["lines"] if l["line_total"] is not None), Decimal(0))),
            # v1-compatible fields
            "unmatched_lines": [l["description"] for l in draft["lines"] if not l["ingredient_id"]],
            "total_overspend": money(overspend)}


def _current_price(db: Session, ing: str) -> Decimal | None:
    r = db.scalars(select(m.PriceRecord).where(m.PriceRecord.ingredient_id == ing, m.PriceRecord.source == "invoice")
                   .order_by(m.PriceRecord.observed_on.desc(), m.PriceRecord.id.desc()).limit(1)).first()
    return D(r.unit_price) if r else None


def confirm(payload, db: Session, user_email: str) -> dict:
    """Validate a reviewed invoice and save it. Raises 422 with all problems if anything is invalid."""
    ingredients = {i.id: i for i in db.scalars(select(m.Ingredient))}
    errors = []
    sup = db.get(m.Supplier, payload.supplier_id) if payload.supplier_id else match_supplier(payload.supplier_name, db)
    if not sup and payload.supplier_name:
        sup = m.Supplier(name=payload.supplier_name.strip()[:120], category="General")
        db.add(sup)
        db.flush()
    if not sup:
        errors.append("supplier: provide supplier_id or supplier_name")
    if payload.location_id and not db.get(m.Location, payload.location_id):
        errors.append(f"location_id {payload.location_id} not found")
    if payload.invoice_date > date.today():
        errors.append("invoice_date cannot be in the future")
    if payload.invoice_date < date.today() - timedelta(days=730):
        errors.append("invoice_date is more than two years old")
    if payload.invoice_number and db.scalars(select(m.Invoice).where(
            m.Invoice.invoice_number == payload.invoice_number, m.Invoice.supplier_id == (sup.id if sup else -1))).first():
        errors.append(f"invoice {payload.invoice_number} from this supplier has already been saved")
    for n, l in enumerate(payload.lines, 1):
        for issue in validate_line(l.model_dump(), ingredients):
            errors.append(f"line {n}: {issue}")
    if errors:
        db.rollback()
        raise HTTPException(422, {"message": "Invoice not saved: please correct these problems", "errors": errors})
    inv = m.Invoice(supplier_id=sup.id, location_id=payload.location_id or 1, invoice_number=payload.invoice_number,
                    invoice_date=payload.invoice_date, source=payload.source)
    comparison = []
    for l in payload.lines:
        ing = ingredients[l.ingredient_id]
        factor = Decimal(str(UNIT_ALIASES.get((l.unit or ing.unit).lower(), (ing.unit, 1))[1]))
        qty = D(l.quantity) * factor            # convert to ingredient unit (e.g. g -> kg)
        unit_price = (D(l.unit_price) / factor).quantize(Decimal("0.0001"))
        prev = _current_price(db, ing.id)
        inv.lines.append(m.InvoiceLine(ingredient_id=ing.id, quantity=qty, unit_price=unit_price,
                                       line_total=(qty * unit_price).quantize(Decimal("0.0001"))))
        cp = change_pct(prev, unit_price) if prev else None
        comparison.append({"ingredient_id": ing.id, "name": ing.name, "quantity": money(qty), "unit": ing.unit,
                           "unit_price": money(unit_price), "previous_price": money(prev) if prev else None,
                           "change_pct": cp, "flagged": bool(cp is not None and cp >= config.PRICE_ALERT_PCT)})
    db.add(inv)
    db.flush()
    for l in inv.lines:
        db.add(m.PriceRecord(ingredient_id=l.ingredient_id, supplier_id=sup.id, observed_on=inv.invoice_date,
                             unit_price=l.unit_price, source="invoice", invoice_id=inv.id))
    db.commit()
    return {"status": "saved", "saved": True, "invoice_id": inv.id, "supplier": sup.name,
            "invoice_date": inv.invoice_date.isoformat(), "invoice_number": inv.invoice_number,
            "total": money(sum((D(l.line_total) for l in inv.lines), Decimal(0))), "lines": comparison,
            "price_increase_alerts": [c for c in comparison if c["flagged"]], "saved_by": user_email}


def list_invoices(db: Session, limit: int = 50) -> list[dict]:
    rows = db.scalars(select(m.Invoice).order_by(m.Invoice.invoice_date.desc(), m.Invoice.id.desc()).limit(limit))
    sups = {s.id: s.name for s in db.scalars(select(m.Supplier))}
    return [{"id": i.id, "invoice_number": i.invoice_number, "invoice_date": i.invoice_date.isoformat(),
             "supplier": sups[i.supplier_id], "location_id": i.location_id, "source": i.source, "line_count": len(i.lines),
             "total": money(sum((D(l.line_total) for l in i.lines), Decimal(0)))} for i in rows]
