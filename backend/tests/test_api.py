"""API behaviour: advisor honesty, invoice review flow, waste, menu management, auth."""
import io


def test_core_endpoints_ok(client):
    for p in ("/api/health", "/api/dashboard", "/api/menu", "/api/alerts", "/api/leakage", "/api/forecast",
              "/api/suppliers", "/api/suppliers/comparison", "/api/suppliers/price-changes", "/api/waste",
              "/api/reports", "/api/reports/download", "/api/locations", "/api/ingredients", "/api/invoices",
              "/api/menu/fish_chips", "/api/ingredients/cod_fillet/price-history", "/api/auth/me"):
        assert client.get(p).status_code == 200, p


def test_advisor_is_honestly_labelled_demo(client):
    r = client.post("/api/advisor", json={"question": "Why is my profit falling?"}).json()
    assert r["live_ai"] is False and r["provider"] == "demo" and "not live AI" in r["label"]
    assert "DEMO MODE" in r["notice"]
    assert client.post("/api/advisor", json={"question": " "}).status_code == 422
    assert client.post("/api/advisor", json={"message": "How is the menu doing?"}).status_code == 200  # v1 alias


def test_live_provider_failure_falls_back_honestly(client, monkeypatch):
    class Broken:
        name, live = "anthropic", True

        def answer(self, q, ctx):
            raise ConnectionError("no network")

        def extract_invoice_image(self, *a):
            raise ConnectionError("no network")

    from app import ai
    monkeypatch.setattr(ai, "get_provider", lambda: Broken())
    r = client.post("/api/advisor", json={"question": "Why is my profit falling?"}).json()
    assert r["live_ai"] is False and r["provider"] == "demo" and "ConnectionError" in r["notice"]
    img = client.post("/api/invoices/upload", files={"file": ("x.jpg", b"\xff\xd8..", "image/jpeg")}).json()
    assert img["extraction_method"] == "manual_required" and "ConnectionError" in img["notice"]


def test_advisor_scenarios(client):
    r = client.post("/api/advisor", json={"question": "What if cod goes up 10%?"}).json()
    assert r["intent"] == "simulation" and r["scenario"]["weekly_gross_profit_change"] < 0
    r = client.post("/api/advisor", json={"question": "what if lamb prices drop 5%"}).json()
    assert r["intent"] == "simulation" and r["scenario"]["weekly_gross_profit_change"] > 0
    r = client.post("/api/advisor", json={"question": "What if I raise fish and chips to £17.50?"}).json()
    assert r["intent"] == "simulation" and r["scenario"]["weekly_gross_profit_change"] > 0


CSV = (b"supplier,invoice_date,invoice_number,ingredient,quantity,unit,unit_price,total\n"
       b"North Sea Catch,2026-11-03,NSC-555,Cod fillet,20,kg,20.10,402.00\n"
       b"North Sea Catch,2026-11-03,NSC-555,Mystery prawns,2,kg,12,24\n")


def test_invoice_upload_is_draft_then_confirm(fresh):
    before = len(fresh.get("/api/invoices?limit=500").json()["invoices"])
    d = fresh.post("/api/invoices/upload", files={"file": ("inv.csv", CSV, "text/csv")}).json()
    assert d["saved"] is False and d["ready_to_confirm"] is False
    assert d["matched_supplier"] == "North Sea Catch" and len(d["unmatched_lines"]) == 1
    cod = d["lines"][0]
    assert cod["ingredient_id"] == "cod_fillet" and cod["flagged"] is True
    assert len(fresh.get("/api/invoices?limit=500").json()["invoices"]) == before  # nothing saved by upload

    body = {"supplier_id": d["supplier_id"], "invoice_date": "2026-11-03", "invoice_number": "NSC-555", "source": "csv",
            "lines": [{k: cod[k] for k in ("ingredient_id", "quantity", "unit", "unit_price", "line_total")}]}
    r = fresh.post("/api/invoices", json=body)
    assert r.status_code == 201 and r.json()["price_increase_alerts"][0]["change_pct"] == 6.35
    assert next(i for i in fresh.get("/api/ingredients").json() if i["id"] == "cod_fillet")["current_price"] == 20.10
    assert fresh.post("/api/invoices", json=body).status_code == 422  # duplicate invoice number


def test_invoice_validation_and_unit_conversion(fresh):
    bad = {"supplier_id": 2, "invoice_date": "2030-01-01",
           "lines": [{"ingredient_id": "cod_fillet", "quantity": 1, "unit": "l", "unit_price": 5, "line_total": 9}]}
    errs = fresh.post("/api/invoices", json=bad).json()["detail"]["errors"]
    assert any("future" in e for e in errs) and any("Unit" in e for e in errs) and any("total" in e for e in errs)
    ok = {"supplier_id": 4, "invoice_date": "2026-11-02",
          "lines": [{"ingredient_id": "butter", "quantity": 2500, "unit": "g", "unit_price": 0.0086}]}
    line = fresh.post("/api/invoices", json=ok).json()["lines"][0]
    assert line["quantity"] == 2.5 and line["unit_price"] == 8.6


def test_invoice_pdf_and_image(client):
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    cv = canvas.Canvas(buf)
    for n, t in enumerate(["Supplier: Tyneside Meats", "Invoice No: TM-9001", "Date: 02/11/2026",
                           "Lamb shoulder 12 kg 15.20 182.40", "Beef mince 10 kg 9.10 91.00"]):
        cv.drawString(72, 780 - 18 * n, t)
    cv.save()
    d = client.post("/api/invoices/upload", files={"file": ("inv.pdf", buf.getvalue(), "application/pdf")}).json()
    assert d["matched_supplier"] == "Tyneside Meats" and d["invoice_date"] == "2026-11-02" and d["ready_to_confirm"]
    assert [l["ingredient_id"] for l in d["lines"]] == ["lamb_shoulder", "beef_mince"]
    img = client.post("/api/invoices/upload", files={"file": ("x.png", b"\x89PNG..", "image/png")}).json()
    assert img["extraction_method"] == "manual_required" and img["lines"] == []
    assert client.post("/api/invoices/upload", files={"file": ("x.txt", b"hi", "text/plain")}).status_code == 415
    assert client.post("/api/invoices/upload", files={"file": ("x.pdf", b"not a pdf", "application/pdf")}).status_code == 422


def test_waste_recording(fresh):
    r = fresh.post("/api/waste", json={"ingredient_id": "cod_fillet", "quantity": 500, "unit": "g", "reason": "prep_error",
                                       "recorded_on": "2026-10-30"}).json()
    assert r["quantity"] == 0.5 and r["estimated_cost"] == round(0.5 * r["unit_cost"], 2)
    assert fresh.post("/api/waste", json={"ingredient_id": "cod_fillet", "quantity": 1, "unit": "l", "reason": "spoiled"}).status_code == 422
    assert fresh.post("/api/waste", json={"ingredient_id": "cod_fillet", "quantity": 1, "reason": "dropped"}).status_code == 422


def test_menu_management(fresh):
    body = {"name": "Seafood Chowder", "category": "Starters", "selling_price": 8.5,
            "recipe": [{"ingredient_id": "cod_fillet", "quantity": 0.08}, {"ingredient_id": "cream", "quantity": 0.05}]}
    d = fresh.post("/api/menu", json=body).json()
    assert d["id"] == "seafood_chowder" and d["ingredient_cost"] == round(0.08 * 18.9 + 0.05 * 3.4, 2)
    assert fresh.post("/api/menu", json=body).status_code == 409
    body["selling_price"] = 9.5
    assert fresh.put("/api/menu/seafood_chowder", json=body).json()["selling_price"] == 9.5
    assert fresh.delete("/api/menu/seafood_chowder").json()["archived"] is True
    assert fresh.get("/api/menu/seafood_chowder").status_code == 404
    bad = {"name": "X dish", "selling_price": 5, "recipe": [{"ingredient_id": "unobtainium", "quantity": 1}]}
    assert fresh.post("/api/menu", json=bad).status_code == 422


def test_auth_and_roles(client):
    assert client.post("/api/auth/login", json={"email": "kitchen@marginos.demo", "password": "wrong"}).status_code == 401
    tok = client.post("/api/auth/login", json={"email": "kitchen@marginos.demo", "password": "demo-password"}).json()["access_token"]
    h = {"Authorization": f"Bearer {tok}"}
    assert client.get("/api/auth/me", headers=h).json()["role"] == "kitchen"
    assert client.get("/api/dashboard", headers=h).status_code == 200
    assert client.get("/api/reports", headers=h).status_code == 403
    assert client.post("/api/menu", headers=h, json={"name": "Zz dish", "selling_price": 5,
                                                     "recipe": [{"ingredient_id": "cream", "quantity": 0.05}]}).status_code == 403
    assert client.get("/api/dashboard", headers={"Authorization": "Bearer forged.token"}).status_code == 401
