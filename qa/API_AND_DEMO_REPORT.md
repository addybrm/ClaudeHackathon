# QA and demo handoff

## Repository inspection (2026-11-04)

- The backend directory contains only `requirements.txt`, `.env.example`, and `.gitignore`; no FastAPI app, routes, or tests were present to execute.
- The frontend API client in [`src/api.ts`](../src/api.ts) references:
  - `GET /api/dashboard`
  - `GET /api/menu`
  - `GET /api/alerts`
  - `POST /api/advisor` with `{ "message": string }`
  - `POST /api/invoices` as multipart form data with field `file`
- No endpoint responses were fabricated. Live API testing is pending the backend implementation/service URL.
- The frontend source currently imports `./App` from [`src/main.tsx`](../src/main.tsx), but no `src/App` file was present during inspection; a frontend build cannot be claimed as passing until Codex supplies it.

## Financial QA

Run `python -m pytest qa\test_financials.py -q`. The tests verify all requested formulas, zero-price behavior, missing-ingredient rejection, supplier references, price history, waste arithmetic, and ten dishes.

## Demo scenario

1. The owner opens Cedar & Saffron Kitchen's dashboard and sees food costs rising faster than revenue.
2. MarginMate flags extra virgin olive oil: Cascade/Rose City Pantry's recorded price moved from `$8.00/L` to `$9.12/L` (+14%).
3. The affected-dish view identifies every recipe containing olive oil, with Sea Bass and Heritage Chicken receiving the largest absolute cost impact per serving among the affected recipes.
4. The owner reviews the monthly exposure: compare current recipe costs with the prior price-history snapshot and multiply the per-serving increase by monthly orders. The olive-oil increase alone creates `$13.30` in monthly gross-profit pressure across seven recipes; including the other recorded increases, Sea Bass and Heritage Chicken have the largest per-serving impacts (`$0.38` and `$0.17`). This isolates lost gross profit rather than confusing revenue with profit.
5. Recommended actions:
   - request a volume quote or alternate olive-oil supplier;
   - re-cost the affected recipes before changing prices;
   - consider a targeted price adjustment on the lowest-margin affected dish;
   - reduce avoidable waste, especially the recorded tomato and lettuce losses;
   - upload the next invoice and confirm extracted prices before applying them.

## Frontend QA checklist for Codex handoff

- Navigation: dashboard, menu, alerts/advisor, and invoice upload routes or panels are reachable.
- Responsive layout: verify narrow mobile width, tablet width, and desktop width without clipped cards or charts.
- Charts: labels, tooltip values, and empty/error states render; currency and percentages are formatted consistently.
- Financial values: displayed cost, gross profit, gross margin, and food-cost percentage agree with the formulas in `test_financials.py`.
- API integration: loading, non-2xx responses, malformed payloads, and unavailable backend are visible to the user.
- Invoice upload: reject unsupported type/oversized files client-side, show upload progress/result, and handle server errors.
