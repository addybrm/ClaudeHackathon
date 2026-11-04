"""API contract tests for API_CONTRACT.md (v2). Runs against an isolated temporary database."""
import io

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.seed import init_db


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def fresh(client):
    init_db(reset=True)
    yield client
    init_db(reset=True)


def test_dashboard_menu_alerts_and_health_contract(client):
    health = client.get("/api/health").json()
    assert health["status"] == "ok" and "advisor_mode" in health
    dashboard = client.get("/api/dashboard")
    assert dashboard.status_code == 200
    body = dashboard.json()
    assert {"restaurant", "period", "kpis", "trend", "top_dishes", "bottom_dishes", "alerts"} <= body.keys()
    assert body["restaurant"]["currency"] == "GBP" and body["restaurant"]["is_demo_data"] is True
    menu = client.get("/api/menu").json()
    assert menu["dishes"]
    assert {"ingredient_cost", "gross_profit", "gross_margin_pct", "food_cost_pct", "status", "ingredients"} <= menu["dishes"][0].keys()
    alerts = client.get("/api/alerts").json()
    assert alerts["count"] == len(alerts["alerts"])


def test_advisor_validates_input_and_is_honestly_labelled(client):
    assert client.post("/api/advisor", json={"question": ""}).status_code == 422
    r = client.post("/api/advisor", json={"question": "How can I improve margins?"}).json()
    assert {"live_ai", "answer", "question", "label", "provider"} <= r.keys()
    assert r["live_ai"] is False and "not live AI" in r["label"] and r["notice"]


def test_invoice_post_saves_and_validates(fresh):
    ok = {"supplier_name": "Tyneside Meats", "invoice_date": "2026-11-02", "invoice_number": "CT-1", "source": "manual",
          "lines": [{"ingredient_id": "chicken_breast", "quantity": 10, "unit": "kg", "unit_price": 7.0}]}
    r = fresh.post("/api/invoices", json=ok)
    assert r.status_code == 201 and r.json()["saved"] is True
    assert fresh.post("/api/invoices", json=ok).status_code == 422  # duplicate invoice number
    unknown = {"supplier_name": "x", "lines": [{"ingredient_id": "missing", "quantity": 1, "unit_price": 1}]}
    assert fresh.post("/api/invoices", json=unknown).status_code == 422
    negative = {"supplier_name": "x", "lines": [{"ingredient_id": "chicken_breast", "quantity": 1, "unit_price": -1}]}
    assert fresh.post("/api/invoices", json=negative).status_code == 422


def test_invoice_upload_returns_draft_and_rejects_bad_files(fresh):
    csv = b"ingredient,unit_price,quantity\nLamb shoulder,19.90,10\nMystery,1,1\n"
    response = fresh.post("/api/invoices/upload", files={"file": ("invoice.csv", csv, "text/csv")},
                          data={"supplier": "Tyneside Meats"})
    assert response.status_code == 200
    draft = response.json()
    assert draft["saved"] is False and draft["unmatched_lines"] == ["Mystery"] and draft["matched_supplier"] == "Tyneside Meats"
    assert fresh.post("/api/invoices/upload", files={"file": ("invoice.txt", b"not supported", "text/plain")}).status_code == 415
    assert fresh.post("/api/invoices/upload", files={"file": ("empty.csv", io.BytesIO(b""), "text/csv")}).status_code == 422
