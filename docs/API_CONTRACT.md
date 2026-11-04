# MARGIN OS: API Contract (v2)

This is the single source of truth shared by Claude (backend), Codex (frontend) and Copilot (QA). Field lists here were taken from live responses. The interactive schema is at `http://localhost:8000/docs` (OpenAPI at `/openapi.json`).

## Conventions

- **Base URL:** `http://localhost:8000` (dev). Use HTTPS in production.
- **Format:** JSON throughout. Money is GBP as a float rounded to pence, and percentages are floats to 2 decimal places (`25.22` means 25.22%).
- **Dates:** ISO `YYYY-MM-DD`.
- **Auth:** `Authorization: Bearer <access_token>`. In demo mode (`AUTH_REQUIRED=false`) the header is optional and anonymous requests act as the demo owner. Check `GET /api/health → auth_mode`.
- **Errors:**

| Status | Meaning |
|---|---|
| `401` | Not logged in or invalid token |
| `403` | Role not allowed |
| `404` | Unknown id |
| `409` | Duplicate |
| `413` | File too large |
| `415` | Unsupported file type |
| `422` | Validation. `detail` is a string, a pydantic list, or `{message, errors[]}` on invoice confirm |
| `500` | `{"detail":"Internal server error"}` |

### Analysis query parameters

`GET` analysis endpoints accept these query parameters:

| Param | Default | Notes |
|---|---|---|
| `start` | `end − 27 days` | |
| `end` | last day with sales data (`2026-11-01` in the demo) | |
| `location_id` | omitted = all locations | |

`start > end` returns 422 and an unknown location returns 404.

Every such response includes:

```json
"period": {"start","end","days","weeks_of_sales","data_available":{"start","end"},"location"}
```

### Roles

| Permission | Roles |
|---|---|
| read | owner, manager, kitchen, finance |
| menu:write | owner, manager |
| invoice:write | owner, manager, finance |
| waste:write | owner, manager, kitchen |
| report:read | owner, manager, finance |
| admin | owner |

---

## Meta & auth

| Method | Path | Body / params | Returns |
|---|---|---|---|
| GET | `/api/health` | | `{status, version, advisor:{provider:"demo"\|"anthropic", live_ai}, auth_mode:"demo-open"\|"required", currency}` |
| POST | `/api/auth/login` | `{email, password}` | `{access_token, token_type:"bearer", user:{email,name,role}}`; wrong credentials return 401 |
| GET | `/api/auth/me` | | `{email, name, role, demo_session}` |
| GET | `/api/locations` | | `[{id, name, city}]` |

**Demo users** (fictional, demo only): `owner@`, `manager@`, `kitchen@` and `finance@marginos.demo`, all with password `demo-password`.

## A. Dashboard: `GET /api/dashboard`

```text
restaurant {name, currency:"GBP", region, is_demo_data}
period {...}
kpis {revenue, ingredient_expenditure, gross_profit, gross_margin_pct, food_cost_pct,
      theoretical_food_cost, theoretical_food_cost_pct, waste_cost, unexplained_variance, covers_sold,
      target_food_cost_pct,
      changes_vs_previous_period_pct {revenue, ingredient_expenditure, gross_profit, waste_cost}  // may be null
      weekly_revenue, weekly_food_cost, weekly_gross_profit}       // weekly averages (v1-compatible)
trend [{week_start, revenue, ingredient_expenditure, gross_profit, gross_margin_pct, food_cost_pct,
        theoretical_food_cost_pct, waste_cost, type:"actual"}]   // all weeks, ignores the period filter
top_dishes [Dish] (3)        bottom_dishes [Dish] (3)          // by gross_margin_pct
supplier_price_changes [PriceChange] (5)
profit_leakage {total, annualised, by_category [{category, label, amount}]}
waste {total_cost, by_reason [{reason, cost}], top_ingredients [WasteItem]}
alerts [Alert] (5)           alert_count
```

## B. Menu

| Method | Path | Notes |
|---|---|---|
| GET | `/api/menu` | `{period, currency, target_food_cost_pct, menu_engineering:{popularity_threshold_units, average_unit_gross_profit}, dishes:[Dish]}`, sorted by `profitability_rank` |
| GET | `/api/menu/{dish_id}` | `Dish` |
| POST | `/api/menu` | menu:write. Body `DishIn`. Returns 201 `Dish`; duplicate id returns 409; unknown ingredient returns 422 |
| PUT | `/api/menu/{dish_id}` | menu:write. Replaces name, category, price and recipe |
| DELETE | `/api/menu/{dish_id}` | menu:write. Soft archive (sales history kept). Returns `{id, archived:true}` |

```text
DishIn  {id?: "^[a-z0-9_]{2,40}$" (default: slug of name), name (2–120), category, selling_price (0 < p ≤ 1000),
         recipe: [{ingredient_id, quantity (0 < q ≤ 100, in the ingredient's unit)}] (1–40, unique ingredients)}

Dish    {id, name, category, selling_price, ingredient_cost, production_cost (= ingredient cost in MVP),
         gross_profit, gross_margin_pct, food_cost_pct, markup_pct,
         units_sold, revenue, gross_profit_contribution, profitability_rank,
         gross_margin_pct_at_period_start, margin_change_pp, cost_change_pct,
         cost_trend [{week_start | "current", ingredient_cost}],
         suggested_price_for_target, status: "healthy"|"watch"|"critical",
         menu_class: "star"|"plowhorse"|"puzzle"|"dog",
         ingredients [{ingredient_id, name, quantity, unit, unit_cost, line_cost, unit_cost_change_pct}],
         menu_price, weekly_units_sold}               // v1-compatible aliases
```

Status thresholds: `healthy` is food cost ≤ 30%, `watch` is ≤ 35%, and `critical` is above 35%.

## C. Suppliers & ingredients

| Method | Path | Returns |
|---|---|---|
| GET | `/api/suppliers` | `{period, suppliers:[{id, name, category, contact_email, invoices_in_period, spend_in_period, share_of_spend_pct, ingredients_supplied[], is_current_supplier}]}` |
| GET | `/api/suppliers/price-changes` | `{period, changes:[PriceChange]}`, biggest % first |
| GET | `/api/suppliers/comparison` | `{period, comparisons:[{ingredient_id, name, unit, current_supplier, current_price, offers:[{supplier, unit_price, as_of, source:"invoice"\|"quote"}], cheapest_supplier, potential_saving_in_period, quantity_purchased_in_period}]}` |
| GET | `/api/ingredients` | `[{id, name, unit, category, current_price, current_supplier}]` |
| GET | `/api/ingredients/{id}/price-history` | `{ingredient_id, name, unit, history:[{date, unit_price, supplier}], quotes:[...]}` |

```text
PriceChange {ingredient_id, name, unit, supplier, price_at_period_start, current_price, change_pct,
             weekly_cost_impact, affected_dishes [{dish_id, name, cost_change_per_portion, weekly_impact}],
             previous_price, id}            // v1 aliases
```

## D. Invoices (two-step: extract, then confirm)

### 1. `POST /api/invoices/upload` (invoice:write)

- **Request:** `multipart/form-data` with field `file`.
- **Accepted files:**

| Type | How it is read |
|---|---|
| `.csv` | Columns: `ingredient` (or `item`/`description`/`ingredient_id`), `quantity`, `unit`, `unit_price` and/or `total`. Optional `supplier`, `invoice_date`, `invoice_number` |
| `.pdf` | Text-based only. Lines like `Lamb shoulder 12 kg 15.20 182.40`, plus headers `Supplier:`, `Date:`, `Invoice No:` |
| `.png` / `.jpg` / `.jpeg` / `.webp` | Read by Claude only when a live key is configured. Otherwise `extraction_method:"manual_required"` with `lines: []` |

- **Limits:** 5 MB maximum (413). Other types return 415.
- **Nothing is saved at this step.**

```text
{status:"draft", saved:false, extraction_method:"csv"|"pdf_text"|"claude_vision"|"manual_required", notice,
 filename, supplier_name, supplier_id|null, matched_supplier|null, invoice_date|null, invoice_number|null,
 header_issues [str], ready_to_confirm: bool, total,
 lines [{raw, description, ingredient_id|null, ingredient_name, quantity, unit, unit_price, line_total,
         issues [str], previous_price, change_pct, flagged}],
 unmatched_lines [str], total_overspend}                       // v1-compatible
```

**The UI must show `issues`, let the user fix every field, and only enable Confirm when there are no issues left.**

### 2. `POST /api/invoices` (invoice:write)

Re-validates everything, then saves and updates price history.

```text
{supplier_id? | supplier_name?, location_id? (default 1), invoice_number?, invoice_date (default today),
 source: "manual"|"csv"|"pdf"|"image",
 lines: [{ingredient_id, quantity, unit?, unit_price, line_total?, description?}]}
```

**Rules:**
- The unit must match or convert to the ingredient's unit (g→kg, ml→l).
- `line_total` must equal quantity × price within 1%.
- The date must not be in the future or more than 2 years old.
- An invoice number may not be reused for the same supplier.
- An unknown `supplier_name` creates a new supplier.

**Responses:**
- `201` returns `{status:"saved", invoice_id, supplier, invoice_date, invoice_number, total, lines:[{..., previous_price, change_pct, flagged}], price_increase_alerts:[...], saved_by}`.
- `422` returns `{detail:{message, errors:[str]}}`.

### 3. `GET /api/invoices?limit=50`

Returns `{invoices:[{id, invoice_number, invoice_date, supplier, location_id, source, line_count, total}]}`.

## E. Profit leakage: `GET /api/leakage`

```text
{period, total_estimated_leakage, annualised_estimate, annualisation,
 categories [{category:"supplier_price_increases"|"unexplained_purchasing_variance"|"food_waste", label, amount, formula, items[]}],
 declining_margin_dishes [{dish_id, name, margin_change_pp, gross_margin_pct, lost_gross_profit}],
 high_food_cost_dishes [{dish_id, name, food_cost_pct, excess_cost_vs_target}],
 invoice_price_anomalies [{invoice_number, date, supplier, ingredient, previous_price, invoiced_price, change_pct}],
 note}
```

## Alerts: `GET /api/alerts`

Returns `{period, count, alerts:[Alert]}`, with `high` first, then `medium`, then `info`.

```text
Alert {id, type: "supplier_price_increase"|"declining_margin"|"high_food_cost"|"purchasing_variance"|"waste_increase"|"cheaper_supplier",
       severity: "high"|"medium"|"info", title, message, entity:{ingredient_id|dish_id},
       impact_gbp_weekly? | impact_gbp_period? | suggested_price?, detail (= message, v1 alias)}
```

## F. Waste

| Method | Path | Notes |
|---|---|---|
| GET | `/api/waste` | `{summary:{period, total_cost, previous_period_cost, change_pct, waste_pct_of_revenue, by_reason[], top_ingredients:[WasteItem], frequently_wasted[], record_count}, records:[{id, date, location_id, ingredient_id, ingredient, quantity, unit, reason, unit_cost, cost}]}` |
| POST | `/api/waste` | waste:write. `{ingredient_id, quantity (>0), unit?, reason: expired\|spoiled\|overproduction\|prep_error\|returned\|other, recorded_on? (≤ today, ≥ 365 days ago), location_id (default 1)}`. Returns 201 `{id, ingredient, quantity, unit, reason, date, unit_cost, estimated_cost}` |

`WasteItem` is `{ingredient_id, name, unit, records, quantity, cost, avg_weekly_quantity, suggestion}`.

## G. Advisor: `POST /api/advisor`

**Request:** `{question (3–1000 chars) | message (v1 alias), start?, end?, location_id?}`

**Response:**

```text
{provider: "demo"|"anthropic", live_ai: bool, model|null,
 label: "Demo advisor: rule-based answer from your data, not live AI" | "Live Claude API (<model>)",
 notice|null, question, answer (plain text with \n), intent: overview|menu|suppliers|waste|forecast|simulation|llm,
 scenario: Simulation|null, period, mode: "demo"|"live"}
```

**The UI must always display `label`, and must also display `notice` when it is present.**

**What-if questions are detected automatically.** Examples:
- "What if cod goes up 10%?"
- "What if I raise fish and chips to £17.50?"

## H. Forecast & simulation

| Method | Path | Notes |
|---|---|---|
| GET | `/api/forecast?weeks=4&location_id=` | `{horizon_weeks, method, history:[... type:"actual"], projection:[{week_start, revenue, ingredient_expenditure, gross_profit, food_cost_pct, type:"projection"}], ingredient_prices:[{..., current_price, projected_price, projected_change_pct}], dishes:[{dish_id, name, current_gross_margin_pct, projected_gross_margin_pct, projected_food_cost_pct, projected_ingredient_cost, margin_warning}], warnings:[dish names]}` |
| POST | `/api/simulate` | `{ingredient_price_changes_pct:{id: -90..500}, menu_prices:{dish_id: price}, volume_changes_pct:{dish_id: pct}, basis_weeks:1..12 (default 4), location_id?}` |

`POST /api/simulate` returns a `Simulation`:

```text
{type:"simulation", basis, baseline{weekly_revenue, weekly_ingredient_cost, weekly_gross_profit, gross_margin_pct, food_cost_pct}, scenario{...},
 weekly_gross_profit_change, annualised_gross_profit_change, dishes:[{dish_id, name, baseline{...}, scenario{...}, weekly_gross_profit_change}]}
```

**Charts must style `type:"projection"` differently from `type:"actual"`.**

## I. Reports

| Method | Path | Notes |
|---|---|---|
| GET | `/api/reports` | report:read. `{title, generated_at, period, is_demo_data, summary (=kpis), menu_performance:{top, bottom, table}, supplier_changes, supplier_spend, waste, profit_leakage, recommendations:[{area, action, estimated_impact, basis}]}` |
| GET | `/api/reports/download` | report:read. `text/markdown` attachment, ready to print or convert to PDF |

## Admin

`POST /api/admin/reset-demo` (admin) reseeds the fictional demo database.

## Changes from v1 (backward compatible)

- **Kept:** every v1 field the current frontend reads: `kpis.weekly_*`, `menu_price`, `weekly_units_sold`, `status`, alert `title`/`message`/`severity`/`type`, advisor `answer`/`notice`/`live_ai`, upload `unmatched_lines`/`total_overspend`.
- **Changed:** currency moved from EUR to **GBP**, and the demo restaurant changed.
- **Changed:** `POST /api/invoices` now **saves** the invoice. Upload is draft-only.
