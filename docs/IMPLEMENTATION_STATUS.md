# MARGIN OS: Implementation Status & Technical Audit

*Updated 2026-11-04 by Claude (tech lead). Status values: **Implemented** (works end to end in the backend and is tested), **Partial** (some parts missing or frontend not yet wired), **Roadmap** (not in the MVP).*

## 1. Audit of the existing application

The audit was run before the v2 work.

| Area | Finding | Action taken |
|---|---|---|
| Repository | One git repo with no commits. Ownership: root `src/` (Codex, React/Vite), `backend/` (Claude), `qa/`, `tests/`, `demo-data/` (Copilot) | Ownership table added in ARCHITECTURE.md |
| Backend v1 | FastAPI with an in-memory EUR dataset ("Le Petit Atlas"). No database, auth, history, date filter, waste, forecast or reports. Invoice upload compared prices but had no review step | Rebuilt as v2: SQLAlchemy + SQLite, modular services. **All v1 response fields kept** so the frontend did not break |
| Data | **Four inconsistent fictional datasets**: backend EUR (Morocco-themed), frontend hardcoded USD, `qa/` USD (Portland, OR), `demo-data/` GBP ("The North Star Kitchen") | **Canonical dataset = backend seed** ("Tyne & Table", GBP, Newcastle & Durham). Copilot to align (AGENT_TASKS.md) |
| Frontend | Builds (`npm run build` passes at the time of writing; Copilot earlier saw a TS error that Codex has since fixed). `VITE_USE_API=false` by default, so **the UI shows hardcoded figures**, and the hardcoded advisor answers were not labelled as demo | Codex tasks C1–C3 |
| Calculations | v1 formulas were correct (Decimal) | Moved to `services/finance.py`; markup now reported separately from margin |
| AI | v1 had a labelled demo fallback | v2 provider abstraction: demo provider plus optional Anthropic provider (`claude-opus-5-5`, configurable) |
| Dependencies | Backend: fastapi, uvicorn, pydantic, python-multipart, anthropic, pandas, pypdf, pytest, httpx, reportlab (tests only), **+ sqlalchemy**. Frontend: React, Vite, Tailwind 4, Recharts, Lucide, Framer Motion, React Router, Sonner, React Dropzone. Several frontend deps are pinned to `"latest"` | Codex should pin versions (C9) |
| Environment | `backend/.env.example` and root `.env.example` (frontend). No secrets in the repo | `.env` is gitignored |

## 2. Functional requirements

| ID | Requirement | Status | Where / notes |
|---|---|---|---|
| FR1 | User login | **Partial** | Backend login, tokens and 4 roles are implemented and tested. Demo mode allows anonymous access as the owner. **No login screen in the UI yet** (C7) |
| FR2 | Upload invoices as PDF, CSV or image | **Partial** | CSV and text PDFs: implemented. Images: read by Claude **only with an API key**; otherwise the user enters lines manually. Scanned PDFs: not supported |
| FR3 | Extract names, quantities and unit prices | **Implemented** (CSV/PDF) | Also extracts supplier, date, invoice number, unit and total. Ingredient matching is by name |
| FR4 | Review and correct before saving | **Partial** | Backend draft → confirm flow with per-line issues: implemented and tested. **Review UI not built** (C4) |
| FR5 | Store historical prices and supplier info | **Implemented** | `price_records` written on every confirmed invoice; supplier table |
| FR6 | Compare prices across invoices and suppliers | **Implemented** | `/suppliers/price-changes`, `/suppliers/comparison` (invoices and quotes) |
| FR7 | Notify on significant price increases | **Implemented** (in-app) | Alerts at ≥5%, plus confirm-time `price_increase_alerts`. Email/push notifications: Roadmap |
| FR8 | Create and manage menu items and recipes | **Partial** | `POST/PUT/DELETE /api/menu` with validation and roles. **UI not built** (C5) |
| FR9 | Ingredient cost per menu item | **Implemented** | |
| FR10 | Gross profit and margin per item | **Implemented** | |
| FR11 | Identify declining profitability | **Implemented** | `margin_change_pp`, declining-margin alerts, cost trend |
| FR12 | Interactive dashboard | **Partial** | API complete with date and location filters and trend. The frontend dashboard exists but **uses demo data unless `VITE_USE_API=true`** (C1) |
| FR13 | Claude explains issues and recommends | **Partial** | Provider and prompt implemented. **Live Claude not exercised: no API key available.** Demo provider gives deterministic explanations, labelled as such |
| FR14 | Ask questions about performance | **Implemented** | `/api/advisor`, including what-if questions |
| FR15 | Record waste and estimate its impact | **Implemented** (API) | UI not built (C6) |
| FR16 | Reports for selected periods | **Implemented** (API) | JSON and Markdown download. PDF export: Roadmap. UI button (C8) |
| FR17 | Simulate ingredient-cost and menu-price changes | **Implemented** (API) | `/api/simulate`, plus what-if questions through the advisor |
| FR18 | Multiple locations | **Partial** | Locations model and `location_id` filter on all analytics. Invoices and waste are tagged by location. No location management UI; single tenant |

## 3. Non-functional requirements

| ID | Requirement | Status | Notes |
|---|---|---|---|
| NFR01 | Dashboard < 3 s | **Implemented** | About 0.1–0.2 s on demo data (local TestClient) |
| NFR02 | Invoice processing time and status | **Partial** | CSV/PDF are processed synchronously in under 1 s. The UI needs an upload/processing indicator (C4) |
| NFR03 | Secure auth, protected credentials | **Partial** | PBKDF2 hashing and signed expiring tokens. Demo mode is open by default. No rate limiting or reset flow |
| NFR04 | Only authorised users see data | **Partial** | Roles enforced when a token is used or `AUTH_REQUIRED=true`. No tenant isolation |
| NFR05 | HTTPS/TLS | **Roadmap** | Local HTTP only. Deploy behind TLS |
| NFR06 | Understandable to non-accountants | **Partial** | Plain-English advisor and alert messages. Depends on the UI |
| NFR07 | Minimal interaction for common tasks | **Partial** | Depends on the UI |
| NFR08 | Validate uploads, block invalid records | **Implemented** | Type and size checks, PDF magic bytes, per-line validation, units, totals, dates, duplicates |
| NFR09 | Deterministic calculations | **Implemented** | Decimal formulas with invariant tests (margin + food cost = 100; GP = revenue − spend; locations sum to the total) |
| NFR10 | Scalability | **Partial** | Modular services. SQLite and per-request in-memory snapshots are fine for one restaurant group; Postgres and SQL aggregation needed at scale |
| NFR11 | Availability out of hours | **Roadmap** | Needs hosting |
| NFR12 | Modern desktop and mobile browsers | **Partial** | Responsive CSS present. QA viewport pass pending |
| NFR13 | Modular architecture | **Implemented** | Routers, services, AI providers and models are separate |
| NFR14 | UK data protection | **Roadmap** | Fictional data only. Before real data: DPA with Anthropic/hosting, privacy notice, retention policy, DSAR process |

## 4. Modules A–I

| Module | Backend | Frontend (Codex) |
|---|---|---|
| A Dashboard | Implemented | Exists; wire to v2 (C1) |
| B Menu profitability | Implemented incl. CRUD | Table exists; CRUD UI (C5) |
| C Supplier intelligence | Implemented | Partial; comparison and history charts (C3) |
| D Invoice intelligence | Implemented (image needs key) | Upload exists; review step (C4) |
| E Profit leakage | Implemented | Needed (C3) |
| F Food waste | Implemented | Needed (C6) |
| G AI advisor | Implemented (demo); live untested | Exists; must show `label` (C2) |
| H Forecasting | Implemented | Needed (C8) |
| I Reporting | Implemented | Needed (C8) |

## 5. Test evidence (2026-11-04)

| Suite | Owner | Result |
|---|---|---|
| `backend/tests` (22 tests: formulas, invariants, determinism, filters, alerts, simulation, forecast, advisor honesty, provider failure fallback, invoice draft/confirm/validation/units, PDF, image, waste, menu CRUD, roles) | Claude | **22 passed** |
| `qa/test_financials.py` | Copilot | 15 passed (own dataset) |
| `tests/` (root) | Copilot | 21 passed, **2 failed**: they assert v1 invoice behaviour (compare-only `POST /api/invoices`, id `chicken`, `.txt` returning 422 where v2 returns 415). Update per contract v2 (task Q1) |
| `npm run build` | Codex | Passes |

## 6. Known limitations (say these out loud in the demo)

- All data is fictional, and the AI advisor runs in demo (rule-based) mode unless an API key is configured.
- Cost of goods uses ingredient cost only: no labour or energy.
- Purchases are not adjusted for stock on hand, so period food cost is approximate.
- Forecasts are linear trends over 8 weeks. They are indicative only.
- Demo auth is open by default and there is no HTTPS locally.

## 7. Roadmap

POS integration for sales; scanned-PDF OCR; e-mail alerts (e.g. Resend); Sentry; Supabase or Postgres with auth and tenant isolation; stock counts and inventory valuation; labour costing; PDF reports; supplier e-mail price-match requests; mobile waste-logging PWA.
