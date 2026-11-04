# Agent coordination board

Agents cannot message each other directly, so this file is the hand-off point. Each agent edits only its own paths (see [ARCHITECTURE.md](ARCHITECTURE.md#ownership-agent-coordination)) and records progress here by ticking boxes and adding a short note.

- **Contract:** [API_CONTRACT.md](API_CONTRACT.md) (v2). **Product rules:** [PRODUCT_SPEC.md](PRODUCT_SPEC.md).
- **Backend:** run with `cd backend; .venv\Scripts\python -m uvicorn app.main:app --reload --port 8000`.

## Shared decisions (binding)

1. **One dataset.** The backend seed is canonical: "Tyne & Table (fictional demo)", GBP, Quayside (Newcastle) and Elvet (Durham), 12 weeks ending 2026-11-01. The frontend shows only what the API returns.
2. **Currency is GBP everywhere.** Format with `Intl.NumberFormat('en-GB', {style:'currency', currency:'GBP'})`.
3. **Honesty labels.** Show the advisor's `label` on every answer and `notice` when it is present. Show a "Fictional demo data" badge when `restaurant.is_demo_data` is true. Style `type:"projection"` series and simulations differently from actuals (for example dashed lines with a "Projection" legend).
4. **No API keys in the frontend.** Ever.
5. **Gross margin ≠ markup.** Display `gross_margin_pct`. Show `markup_pct` only when it is clearly labelled.

## CODEX: frontend (`/src`, root config)

- [x] **C1 Live data by default** *(done by Claude in the 2026-11-04 UI redesign: `.env.example` now sets `VITE_USE_API=true`, GBP formatting, v2 field mapping, real trend chart, real restaurant name; offline sample data remains as the fallback when the API is unreachable).*
- [ ] ~~C1 original wording:~~ Set `VITE_USE_API=true` in `.env.example` and `.env`. Remove the hardcoded USD/EUR datasets, or show them only behind an explicit offline mode labelled "offline sample". Read the currency from `restaurant.currency`.
- [x] **C2 Advisor.** Render `label` as a badge ("Demo advisor: not live AI" / "Live Claude API"), and `notice` when present. Render `answer` line breaks. When `scenario` is present, show a small before/after card (`baseline` vs `scenario`, `weekly_gross_profit_change`). Suggested prompt chips: "Why is my profit falling?", "Which dishes should I promote?", "What if cod goes up 10%?", "What if I raise Cod & Chips to £17.50?", "Where is food being wasted?".
- [x] **C3 Dashboard v2.** KPI cards from `kpis` (revenue, ingredient spend, gross profit, gross margin, food cost % vs target, waste, leakage) with `changes_vs_previous_period_pct`. Add a `trend` chart (revenue vs ingredient spend; margin line), a date-range picker (`start`/`end`) and a location selector (`/api/locations`). Add a leakage card from `profit_leakage.by_category`, with drill-down to `/api/leakage`. Add a supplier price changes list showing affected dishes, and a comparison table from `/api/suppliers/comparison`.
- [x] **C4 Invoice review step (FR4, required).** After upload, show the draft as an editable table: ingredient dropdown (`/api/ingredients`), quantity, unit, unit price and total. Show per-line `issues` in red, `header_issues`, and `flagged` price rises. Show `notice` for images. Enable **Confirm** only when every issue is resolved, then `POST /api/invoices` and show the returned `price_increase_alerts`. Show a processing spinner (NFR02). Reject anything other than `.csv/.pdf/.png/.jpg/.jpeg/.webp` or over 5 MB client-side.
- [x] **C5 Menu management.** Dish detail drawer (ingredients, `cost_trend` sparkline, `suggested_price_for_target`, `menu_class` badge). Add/edit/archive forms using `POST/PUT/DELETE /api/menu`.
- [x] **C6 Waste.** A quick log form for kitchen staff (`POST /api/waste`, with a reason dropdown), plus a list and summary from `GET /api/waste`.
- [x] **C7 Login.** Login screen (`POST /api/auth/login`); keep the token in memory or sessionStorage and send it as a Bearer header. Show the role. List the demo accounts on the login page.
- [x] **C8 Forecast, simulator and reports.** Forecast chart with actual vs projection, and margin warnings. Simulator form (`POST /api/simulate`): sliders for ingredient %, menu price inputs. Report page from `/api/reports`, with a "Download report" button for `/api/reports/download`.
- [x] **C9 Hygiene.** Pin the `"latest"` dependency versions in `package.json`. Make sure there are loading, empty and error states for every call.

## COPILOT: QA & data (`/qa`, `/tests`, `/demo-data`)

- [ ] **Q1 Update `tests/test_api_contract.py` to contract v2.**
  - `POST /api/invoices` now **saves** (201) and needs valid ids (`chicken_breast`, not `chicken`). Use the upload draft for compare-only checks.
  - Unsupported upload types now return **415**.
  - Use a temporary database (`os.environ["DATABASE_URL"]="sqlite:///<tmp>"` before importing `app`), as `backend/tests/conftest.py` does, so tests never write to the dev DB.
- [ ] **Q2 Align data.** Either regenerate `demo-data/restaurant.json` from the API (`GET /api/menu`, `/api/ingredients`, `/api/suppliers`, `/api/waste`) or clearly mark it as an independent formula fixture. The *demo story* in the pitch must use backend figures only.
- [ ] **Q3 Independent recomputation.** From raw API data (`/api/ingredients`, `/api/menu/{id}`, `/api/invoices`), recompute revenue, ingredient expenditure, food cost % and leakage for the default period, and assert they match `/api/dashboard` and `/api/leakage` to the penny.
- [ ] **Q4 Frontend QA** once C1–C4 land: check mobile (375 px), tablet and desktop. Check that the labels from decision 3 are visible, and that the backend-down error state works. Update `docs/QA_REPORT.md`, replacing its references to `docs/API.md` (removed) with `API_CONTRACT.md`.
- [ ] **Q5 Demo rehearsal.** Run the script in [PITCH.md](PITCH.md#live-demo-script-3-minutes) against the live app and record any figure that differs.

## CLAUDE: backend, docs, integration

- [x] Audit, v2 backend, contract, spec, architecture, status, pitch, video package
- [x] Backward-compatible fields for the v1 frontend (`advisor_mode`, `weekly_*`, `menu_price`, `unmatched_lines`, ...)
- [ ] Review Codex and Copilot changes against this board before the final demo
- [ ] Capture real screenshots for the video once C1–C3 are done

## UI redesign (2026-11-04, Claude, at the user's request)

New visual system in `src/styles.css` and the MarginOS logo in `src/Logo.tsx` and `public/`. Menu "Add item" uses an accessible dialog instead of `window.prompt`; page is kept in the URL hash. **Codex: please build on these tokens and components rather than re-skinning.** C2–C9 above are still open.

*2026-11-04: C2 to C8 were built by Claude in the second redesign pass (see IMPLEMENTATION_STATUS.md section 8), still needing browser QA (task Q4). C9 is only partly done: dependency versions are still `latest`. Codex should review `src/` before further changes.*
