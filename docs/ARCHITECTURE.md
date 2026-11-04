# MARGIN OS: Architecture

```
┌──────────────────────────┐   HTTPS (prod) / HTTP (dev)   ┌───────────────────────────────────────────────┐
│ Frontend (CODEX)         │  JSON, Bearer token (optional)│ Backend: FastAPI (CLAUDE)  /backend/app        │
│ React + TS + Vite        │ ─────────────────────────────▶│ routers/  insights · catalog · operations      │
│ Tailwind, Recharts,      │                               │    │  validation (pydantic) · auth/roles        │
│ Lucide, Framer, Sonner,  │◀───────────────────────────── │    ▼                                           │
│ React Dropzone           │                               │ services/ analytics · finance · invoices ·     │
│ /src (root of repo)      │                               │           reports       (deterministic)        │
└──────────────────────────┘                               │    │                         ▲                 │
                                                           │    ▼                         │ facts only      │
                                                           │ SQLAlchemy models ── SQLite  │                 │
                                                           │ (margin_os.db, seeded)   ai/ context → provider│
                                                           │                          ├─ DemoProvider (rules)│
                                                           │                          └─ AnthropicProvider ──┼─▶ Claude API
                                                           └───────────────────────────────────────────────┘   (only if key set)
```

## Layers (backend)

| Layer | Files | Responsibility |
|---|---|---|
| Config | `app/config.py` | Environment variables, thresholds, CORS |
| Persistence | `app/db.py`, `app/models.py`, `app/seed.py` | SQLite via SQLAlchemy 2; deterministic fictional seed on first start |
| Auth | `app/auth.py` | PBKDF2 passwords, HMAC-signed expiring tokens, role → permission map |
| Finance core | `app/services/finance.py` | Pure Decimal formulas (no I/O) |
| Analytics | `app/services/analytics.py` | Loads one `Snapshot` per request; dashboard, menu, suppliers, leakage, waste, alerts, forecast, simulate |
| Invoices | `app/services/invoices.py` | CSV (pandas), PDF text (pypdf), image (live AI only) → draft → validate → save |
| Reports | `app/services/reports.py` | Report JSON + Markdown, rule-based recommendations |
| AI | `app/ai/` | `context.py` builds facts + parses what-if questions; `demo.py`; `anthropic_provider.py`; `get_provider()` |
| API | `app/routers/*.py`, `app/main.py` | REST endpoints, CORS, error handler |

## Data model

`Restaurant 1─* Location`, `Supplier`, `Ingredient (unit, primary supplier)`, `PriceRecord (ingredient, supplier, date, price, source=invoice|quote)`, `Dish 1─* RecipeLine`, `Sale (location, dish, week, qty, price)`, `Invoice 1─* InvoiceLine`, `WasteRecord`, `User (role)`.

- **Price history:** every confirmed invoice line writes a `PriceRecord`. The current price is the latest invoice price, and the price in effect on a date is the latest record on or before it. Quotes are kept for comparison but never treated as paid prices.
- **Money:** stored as `Numeric(12,4)`, calculated as `Decimal` and rounded to pence only at output.

## Key flows

- **Dashboard:** `GET /api/dashboard?start&end&location_id` → `Snapshot` → `kpis` + `trend` + `menu` + `leakage` + `alerts`. This takes about 0.1–0.2 s on the demo data (NFR01 target: under 3 s).
- **Invoice:** `POST /api/invoices/upload` returns a **draft only** with per-line `issues`. The user corrects it, then `POST /api/invoices` re-validates everything, saves, writes price history and returns the price-increase alerts. Unverified extraction is never saved (FR4, NFR08).
- **Advisor:** `POST /api/advisor` → `ai/context.build()` (all figures plus an optional deterministic simulation) → provider. If the live provider fails, the demo answer is returned with a notice explaining why.

## Security (honest status)

| Area | MVP | Production requirement |
|---|---|---|
| Authentication | Real login and tokens exist. **Demo mode (`AUTH_REQUIRED=false`) treats anonymous requests as the demo owner** | `AUTH_REQUIRED=true`, fixed `SECRET_KEY`, a login UI and password reset; consider Supabase Auth |
| Authorisation | Role → permission checks on every write and on reports | Per-restaurant tenancy isolation (single tenant today) |
| Transport | HTTP on localhost | HTTPS/TLS behind a reverse proxy (NFR05) |
| Secrets | API key read server-side from `backend/.env`; never sent to the browser | Secret manager |
| Input | Pydantic schemas; upload size ≤5 MB, type allow-list, PDF magic bytes; unit, total, date and duplicate checks | Malware scanning; rate limiting |
| Privacy | Fictional data only; no personal customer data stored | UK GDPR: DPA with processors (Anthropic), data-retention policy, privacy notice, DSAR process (NFR14) |

## Ownership (agent coordination)

| Path | Owner |
|---|---|
| `/backend`, `/docs`, API contract, AI abstraction | Claude |
| `/src`, `index.html`, `vite.config.ts`, `package.json`, root `.env.example` | Codex |
| `/qa` (and any `/tests`, `/demo-data` they add) | Copilot |

Cross-team changes go through [AGENT_TASKS.md](AGENT_TASKS.md). Nobody edits another team's files directly.

## Running locally

```powershell
# backend (port 8000)
cd backend; python -m venv .venv; .venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
# frontend (port 5173): set VITE_USE_API=true and VITE_API_BASE_URL=http://localhost:8000 in .env
npm install; npm run dev
```
To reset the demo database, delete `backend/margin_os.db` or call `POST /api/admin/reset-demo`.
