# MARGIN OS QA report

**Date:** 2026-11-04  
**Scope:** fictional demonstration data, deterministic financial validation, API
contract testing, frontend integration/build validation  
**Data status:** every record in [`demo-data/restaurant.json`](../demo-data/restaurant.json)
is fictional demonstration data. No restaurant interview, testimonial, or actual
savings claim is used.

## Executive result

| Area | Result | Evidence |
|---|---|---|
| Owned demo-data and financial tests | PASS | `23 passed` |
| Existing backend tests | PASS | `7 passed` |
| Demo JSON syntax | PASS | `python -m json.tool` |
| API contract tests | PASS | dashboard, menu, alerts, advisor, invoices, upload and validation |
| Frontend production build | BLOCKED | TypeScript error in `src/App.tsx:16` |

Commands executed from the repository root unless noted:

```powershell
backend\.venv\Scripts\python -m pytest tests -q
# 23 passed
Push-Location backend
.\.venv\Scripts\python -m pytest -q
# 7 passed
Pop-Location
npm run build
# failed: invoice upload state type mismatch in src/App.tsx
```

## Owned QA assets

- [`demo-data/restaurant.json`](../demo-data/restaurant.json): North East restaurant
  with 12 dishes, 21 ingredients, 3 suppliers, recipe quantities, current and
  previous prices, five waste records, four months of revenue/cost history, and
  profitability alerts.
- [`tests/test_demo_data.py`](../tests/test_demo_data.py): formula, scenario,
  simulation, forecast, reference-integrity, and edge-case checks.
- [`tests/test_api_contract.py`](../tests/test_api_contract.py): executable
  FastAPI contract checks.
- [`tests/conftest.py`](../tests/conftest.py): test-only backend import path setup.

## Financial validation

The tests calculate, rather than copy, these values:

- ingredient cost: `sum(quantity × unit price)`;
- gross profit: `selling price − ingredient cost`;
- gross margin: `gross profit / selling price × 100`;
- food cost: `ingredient cost / selling price × 100`;
- target-price simulation at 30% food cost;
- forward revenue forecast from the latest observed growth ratio;
- supplier variation and currency-rounded waste cost.

Invalid cases covered: zero selling price (percentages become `None` instead of
dividing by zero), negative quantity, missing ingredient, missing supplier price,
invalid invoice line, unsupported invoice extension, and empty invoice file.

## Supplier scenario: chicken +18%

The fictional sample changes chicken from **£10.00/kg** to **£11.80/kg**:

| Affected dish | Previous cost | Current cost | Chicken-only weekly extra spend |
|---|---:|---:|---:|
| Tyne Chicken Roast | £2.72 | £3.17 | £32.47 |
| Chicken & Leek Pie | £2.25 | £2.60 | £20.74 |
| Warm Chicken Salad | £1.97 | £2.27 | £9.72 |
| **Total chicken-only effect** |  |  | **£62.93/week** |

The exact unrounded total used by the test is `£62.928`. The full recipe costs
also include other supplier changes, so total current-versus-previous recipe
cost movement is not presented as chicken-only savings or loss.

For the chicken-affected dishes, current food-cost percentages rise to:

- Tyne Chicken Roast: **12.95% → 15.10%** for the full recipe;
- Chicken & Leek Pie: **12.49% → 14.47%**;
- Warm Chicken Salad: **13.16% → 15.12%**.

These are sample-data calculations, not a claim about a real restaurant. A
responsible menu recommendation is to first request a volume quote or alternate
chicken supplier, then re-cost portions; only after that should the owner
consider a targeted price change toward the validated 30% food-cost target.

## API testing

The tests exercised the contract in [`docs/API.md`](./API.md):

- `GET /api/health`: 200 and health shape;
- `GET /api/dashboard`: 200 and KPI/top/bottom dish shape;
- `GET /api/menu`: 200 and dish financial fields;
- `GET /api/alerts`: 200 and count matches alert list;
- `POST /api/advisor`: 422 for too-short input and 200 with answer/live-mode shape;
- `POST /api/invoices`: 200 for a valid line, 422 for unknown ingredient and
  negative price;
- `POST /api/invoices/upload`: 200 for CSV with unmatched-line reporting and
  422 for unsupported and empty files.

No live external Claude request was required; advisor tests force demo mode and
verify the response shape.

## Frontend QA and integration blocker

Static inspection found the expected navigation areas (Overview, Menu
profitability, AI business advisor, Supplier monitoring, Invoices), chart
components, API loading calls, advisor error text, and invoice file filtering.

The production build was executed and failed before a browser-level QA pass:

```text
src/App.tsx(16,307): TS2345
Record<string, string> cannot accept the invoice upload response object
```

This is owned by the frontend implementation and was not changed per directive.
Until Codex resolves it, responsive/browser behavior and a deployable frontend
cannot be certified. After the fix, rerun `npm run build` and perform viewport
checks at mobile, tablet, and desktop widths; specifically verify API loading,
non-2xx errors, chart empty states, currency formatting, and invoice rejection
for unsupported/oversized files.

## PACT analysis

- **Problem:** independent restaurant owners see supplier invoices but cannot
  connect price movement to dish-level profit.
- **Audience:** owner-operators and small kitchen teams without a finance analyst.
- **Context:** high-volume, low-margin service with recipes, supplier invoices,
  waste, and changing prices in separate places.
- **Transformation:** MARGIN OS deterministically costs every dish, surfaces
  leakage and alerts, then lets the AI advisor explain validated numbers in
  plain language.

## Six-slide hackathon demo script

1. **The problem:** introduce The North Star Kitchen and show the owner’s
   concern that food costs are rising faster than revenue.
2. **The signal:** open supplier monitoring and show the fictional chicken
   increase from £10.00/kg to £11.80/kg (+18%).
3. **The impact:** open menu profitability; highlight the three affected
   chicken dishes and the calculated £62.93 weekly chicken-only pressure.
4. **The explanation:** ask the advisor, “Which dishes should I review first?”
   Clarify that deterministic calculations supply the facts and demo/live AI
   only explains them.
5. **The decision:** request a supplier quote, re-check portions and waste,
   then simulate a targeted price change before publishing it.
6. **The close:** upload the next invoice, verify extracted lines, and repeat
   the price-to-dish analysis. Say explicitly that all figures shown are
   fictional demo data.

## Likely judge questions

**Is the AI doing the financial math?**  
No. The backend performs deterministic Decimal-based calculations; AI explains
the resulting facts.

**Are these savings proven?**  
No. The £62.93 figure is calculated sample-data exposure, not realized savings.
Savings require a supplier change or validated menu decision after the demo.

**Does invoice upload support scanned PDFs?**  
The documented contract supports CSV and text-based PDFs only; scanned-image OCR
is not claimed.

**What happens with bad data?**  
Validation returns 422 for invalid invoice payloads, unsupported/empty uploads,
unknown ingredients, and non-positive invoice values. Dish tests cover missing
ingredients, missing prices, negative quantities, and zero selling price.

**How would this scale beyond the demo?**  
Persist recipes, price histories, invoices, and waste events behind the same
contract; retain deterministic calculation tests as regression gates and add
authenticated, tenant-isolated storage.


---

## Update 2026-11-04 (redesign and integration pass)

| Check | Result |
|---|---|
| `npm run build` | PASS |
| `backend/tests` | 22 passed |
| `tests/` (API contract v2, previously 2 failing on stale v1 assumptions; rewritten, isolated temp DB) | 23 passed |
| `qa/` financial tests | 15 passed |
| Visual check, desktop 1360 px (headless Edge, live backend): Overview, Menu, Suppliers, Leakage, Waste, Advisor | rendered correctly |
| Visual check, 500 px: Overview | rendered correctly |
| Forecasting, Reports, Settings, Invoices screenshots | captured but **not reviewed** |
| Click-through of buttons, forms, filters, dialogs, login, roles | **NOT DONE** |
| Tablet and mobile on pages other than Overview | **NOT DONE** |

Defects found and fixed during this pass: an infinite data-refresh loop (a new object was stored on every load), desktop showing the mobile menu and close buttons, and unequal panel heights on the Overview.

Open items for QA (Copilot): manual walkthrough of every route and workflow at 375, 768 and 1360 px; invoice confirm with CSV, PDF and image; waste submit; recipe edit and archive; login for each role and the restrictions on writes; report download; the offline fallback (stop the backend and reload).
