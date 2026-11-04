import io

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_dashboard_menu_alerts_and_health_contract():
    assert client.get("/api/health").status_code == 200
    dashboard = client.get("/api/dashboard")
    assert dashboard.status_code == 200
    assert {"restaurant", "kpis", "top_dishes", "bottom_dishes"} <= dashboard.json().keys()
    menu = client.get("/api/menu")
    assert menu.status_code == 200
    assert menu.json()["dishes"]
    assert {"ingredient_cost", "gross_profit", "gross_margin_pct", "food_cost_pct"} <= menu.json()["dishes"][0].keys()
    alerts = client.get("/api/alerts")
    assert alerts.status_code == 200
    assert alerts.json()["count"] == len(alerts.json()["alerts"])


def test_advisor_validates_input_and_returns_demo_or_live_shape(monkeypatch):
    from app import config

    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "")
    assert client.post("/api/advisor", json={"question": ""}).status_code == 422
    response = client.post("/api/advisor", json={"question": "How can I improve margins?"})
    assert response.status_code == 200
    assert {"live_ai", "answer", "question"} <= response.json().keys()


def test_invoice_comparison_and_invalid_lines():
    response = client.post(
        "/api/invoices",
        json={"supplier": "Tyne Valley Provisions", "lines": [
            {"ingredient_id": "chicken", "unit_price": 7.00, "quantity": 10}
        ]},
    )
    assert response.status_code == 200
    assert response.json()["lines"][0]["flagged"] is False
    assert client.post("/api/invoices", json={"supplier": "x", "lines": [
        {"ingredient_id": "missing", "unit_price": 1, "quantity": 1}
    ]}).status_code == 422
    assert client.post("/api/invoices", json={"supplier": "x", "lines": [
        {"ingredient_id": "chicken", "unit_price": -1, "quantity": 1}
    ]}).status_code == 422


def test_invoice_upload_validation_and_empty_file():
    csv = b"ingredient,unit_price,quantity\nLamb shoulder,19.90,10\nMystery,1,1\n"
    response = client.post(
        "/api/invoices/upload",
        files={"file": ("invoice.csv", csv, "text/csv")},
        data={"supplier": "Tyne Valley Provisions"},
    )
    assert response.status_code == 200
    assert response.json()["unmatched_lines"] == ["Mystery"]
    assert client.post(
        "/api/invoices/upload",
        files={"file": ("invoice.txt", b"not supported", "text/plain")},
    ).status_code == 422
    assert client.post(
        "/api/invoices/upload",
        files={"file": ("empty.csv", io.BytesIO(b""), "text/csv")},
    ).status_code == 422
