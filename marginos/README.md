# MarginOS — restaurant profit intelligence

> Understand where your restaurant's money is going, discover why profitability is changing and know what to do next.

MarginOS connects the files an independent restaurant already has: POS exports, supplier invoices and receipts, supplier order emails, recipes, delivery-platform statements, waste logs and rotas. It then investigates changes in **contribution**. Its centrepiece is the **Profit Leak Investigation**: Claude calls deterministic financial tools, and the app shows every tool call, the evidence behind each finding, confidence levels, data gaps and practical actions.

## Quick start

```bash
npm install
cp .env.example .env.local      # add ANTHROPIC_API_KEY for live AI (optional)
npm run dev                      # http://localhost:3000
```

1. Open the app and click **Load demo restaurant**. This generates The Copper Table, a fictional Newcastle restaurant: about 5,300 orders, 37 supplier invoices, waste logs and rotas for September–October 2026.
2. **Overview**: October net revenue is up while contribution is down, and the contribution bridge shows why.
3. **Data centre → Demo sample files**: upload the held-back 31 October POS export, review the staged rows, and confirm. Then do the same for the late platform settlement, the menu export (it adds the missing recipe for the seasonal special), the waste log and the rota.
   - Upload the **PDF invoice**: it is checked against its supplier order and flagged, because oil is charged above the agreed price and one line wasn't ordered.
   - Upload the **photographed delivery receipt**: Claude reads abbreviations like "CHKN BRST FILLET 5KG", picks up the printed use-by dates and spots a 5 kg short delivery.
   - Without an API key, these two bundled documents use stored "pre-read" results, labelled as such.
4. **Cost intelligence**: £64 of October invoice charges don't match supplier orders (an overcharge and an extra drum of oil), and one invoice has no order on file.
5. **Stock & expiry**: weekly chicken deliveries cover 7.7 days of use but keep 6 days. The model puts the resulting expiry at about £338 a month, which matches the recorded spoilage.
6. **Menu analysis**: the high-volume Buttermilk Fried Chicken Burger lost about £2 of contribution per unit. Open it to see the recipe re-costed from invoices and run price scenarios.
7. **Investigator**: ask *"My revenue increased this month, but my profitability declined. What happened?"* or *"What are my biggest identifiable profit leaks?"*

No database server is needed. MarginOS runs an embedded PostgreSQL (PGlite) stored in `~/.marginos`; set `MARGINOS_DATA_DIR` to change the location. The same SQL migrations work on Supabase.

### AI modes

| | With `ANTHROPIC_API_KEY` | Without |
|---|---|---|
| Investigator | **Live**: Claude (`claude-opus-5-5`, override with `CLAUDE_MODEL`) plans the investigation and calls 10 backend tools in a tool-use loop, then submits a structured report | **Demo mode**: keyword rules pick the same tools and fill a fixed template. It is labelled "Demo mode · not AI" everywhere. |
| Invoice PDF/image extraction | Claude structured extraction → staged review | Bundled sample documents use a stored **pre-read** result, labelled "pre-read sample (not live AI)". Any other file fails with a clear message. Set `MARGINOS_PREREAD=1` to force pre-read for the samples even with a key (a backup for bad wifi at a pitch). |

If a live call fails, the UI says so and shows no result. It never falls back silently to a fabricated answer. Live requests enable server-side refusal fallback (`fallbacks: "default"`).

## How Claude is used, and kept honest

- **Tools, not data dumps.** Claude sees only the tool results it asks for: `get_sales_comparison`, `get_menu_item_profitability`, `get_supplier_price_changes`, `get_delivery_channel_costs`, `get_food_waste_analysis`, `get_labour_cost_analysis`, `investigate_profit_change`, `calculate_price_scenario`, `get_invoice_order_checks`, `get_stock_expiry_forecast` (`src/lib/ai/tools.ts`). Every input is validated with Zod.
- **No AI arithmetic.** All figures come from `src/lib/finance`. The system prompt forbids Claude from calculating.
- **Figure verification.** After the report arrives, every £ and % figure in it is matched against the numbers in the tool results (or differences between them). The report header shows "N figures traced to tool output" or lists the figures that couldn't be traced.
- **Evidence links.** Each finding cites the `tool_use` ids it rests on, and clicking `#n` opens that call's raw JSON in the trace.
- **Structured report.** Main finding, evidence table (previous, current, difference, £ impact, confidence, and attribution as measured, estimated or correlation), recommended actions and data gaps. Investigations, findings and recommendations are saved in the database.

## Financial definitions

All reported figures are GBP **ex VAT**. Formulas live in `src/lib/finance/formulas.ts` and are unit-tested.

| Term | Formula |
|---|---|
| Gross sales `G` | Σ line price × qty ÷ (1 + VAT) |
| Net revenue `N` | G − restaurant-funded discounts − refunds (each ex VAT) |
| Recipe cost / portion | Σ ingredient qty (converted to base unit) × unit cost ÷ portions |
| Unit cost for a month | quantity-weighted average invoice price in the month, else the last earlier invoice, else the standard cost (**estimated**), else **missing** |
| Food cost `F` | Σ units sold × recipe cost (theoretical) |
| Platform commission `C` | settlement commission + fees, allocated to dishes by share of order value. Without a settlement: contract rate × (gross − discount), flagged **estimated** |
| Contribution | N − F − packaging − C |
| Contribution margin | contribution ÷ N × 100 |
| Waste cost | qty (base unit) × unit cost; prepared dishes: portions × recipe cost |
| Wage cost | hours × hourly rate (excludes employer NI and pension) |
| Billed above the order | Σ (charged − agreed price) × qty, plus quantity billed above the order × price, plus lines not on the order |
| Stock forecast | per ingredient, daily use = recipe usage over the last 28 days of sales ÷ 28. Each day is consumed first-expiry-first-out from delivered, unexpired batches. What is left at a batch's use-by date (printed, or delivery + shelf life) is modelled waste |

Contribution is **not net profit**. Rent, utilities and other overheads are not modelled. Revenue from items without a complete recipe cost is reported separately and excluded from contribution and margin. Missing costs are never treated as zero.

### Profit change decomposition

Writing contribution as `C = m × G`, where `m = 1 − d − r − f − p − c` (each cost as a share of gross sales):

```
ΔC = m_prev × (G_cur − G_prev)          sales volume effect
   − Σ_k (k_cur − k_prev) × G_cur       rate effect of each cost line
```

This identity is exact, so the effects add up to the total change with no double counting (a test asserts this). The food-cost effect splits into **ingredient price changes** (current usage × invoice price change, measured) and a **menu mix & pricing** remainder (estimated). The commission effect splits into **shift towards delivery** and **effective commission rate**. Waste and wages are reported below contribution.

## Data centre

| Source | Format | Parser |
|---|---|---|
| POS sales | `order_id,date,time,channel,item,quantity,unit_price,line_discount,line_refund` | deterministic CSV |
| Menu & recipes | `menu_item,category,price,delivery_price,packaging_cost,ingredient,quantity,unit` | deterministic CSV |
| Delivery settlement | `platform,order_id,order_date,order_value,commission,other_fees,restaurant_funded_discount,payout,settlement_ref` | deterministic CSV |
| Waste | `date,item,item_type,quantity,unit,reason,notes` | deterministic CSV |
| Labour | `date,role,staff_ref,hours,hourly_rate` | deterministic CSV |
| Supplier orders | `order_ref,supplier,ordered_on,delivery_date,status,item,quantity,unit,unit_price,note` | deterministic CSV |
| Supplier invoice / receipt | PDF, PNG, JPEG, WebP | Claude structured output, including order ref, per-line confidence and printed use-by dates |

Every upload is staged with a preview and row-level validation. It reaches the financial tables only after the owner confirms. Safeguards:

- Rows with errors are skipped, and an order is never imported partially.
- Duplicates are caught by file hash, order reference, invoice number, settlement and shift.
- Invoice lines are checked: quantity × price against the line total, line sum against the subtotal, and subtotal + VAT against the total.
- Each invoice is matched to its supplier order (by order reference, then by supplier and a delivery date within 2 days). Overcharges, over-billing, short deliveries and unordered lines are flagged before import.
- The owner can remap lines to ingredients, correct pack sizes, or leave non-food lines unmapped.
- The original file is kept and linked from the invoice page.

## Architecture

```
src/
  app/                    Next.js App Router pages + API routes
    api/investigate         NDJSON stream of investigation events
    api/uploads             stage / confirm / discard / original file
  lib/
    finance/formulas.ts     pure formulas (tested)
    finance/engine.ts       DB-backed analyses composing the formulas
    finance/reconcile.ts    invoice ↔ supplier order matching (from LarderCheck)
    finance/stock.ts        first-expiry-first-out stock forecast (from LarderCheck)
    finance/operations.ts   DB-backed order checks and stock forecast
    ai/tools.ts             tool schemas, validation, figure verification
    ai/investigator.ts      Claude tool-use loop, persistence
    ai/demo-investigator.ts labelled deterministic fallback
    imports/                CSV parser, staging pipeline, Claude invoice extraction
    demo/                   seeded generator for The Copper Table + sample files
  components/             UI primitives, charts (hand-rolled SVG), shell
supabase/migrations/      0001_init.sql, 0002_stock_and_orders.sql, 0090_rls.sql (Supabase RLS only)
tests/                    formulas, engine, imports, storyline
```

**Stack:** Next.js 16, React 19, TypeScript, Tailwind 4, `@anthropic-ai/sdk`, PGlite and Zod. There are no chart or UI libraries.

**Supabase:** apply `0001_init.sql`, `0002_stock_and_orders.sql`, then `0090_rls.sql`. Every table carries `business_id`, and RLS restricts rows to members of the business. To switch drivers, change `src/lib/db.ts` (`query` / `tx`) to a Postgres pool that uses the service-role key **server-side only**.

## Tests

```bash
npm test          # formulas, decomposition additivity, engine, import pipeline, order checks, stock forecast, demo storyline
npm run typecheck
```

## Business case (Track 2: Small Business, Big Tools)

- **User and payer:** the owner of an independent restaurant or takeaway in the North East with one to three sites, selling dine-in and through delivery apps. Two-thirds of North East jobs are in small firms.
- **Why next month:** delivery commissions, supplier price rises and promotions change margins every month, and owners usually find out at the year-end accounts. MarginOS turns the files they already export into a monthly answer to "why did profit fall?".
- **Versus today:** spreadsheets, or the accountant's view months later. Inventory and costing tools track stock but don't connect it to channel economics, billing errors and the reasons a margin moved.
- **Cost to serve (estimate):** one investigation is roughly 10–30k input tokens and 2–4k output tokens, about 6–16p on Claude Opus 5.5 ($4 / $20 per million tokens). One receipt read is 4–6p (LarderCheck's estimate). A restaurant running 20 investigations and 60 receipts a month costs about £4–7 a month in AI.
- **Where it can be wrong:** see Assumptions and Known limitations below. Every AI claim is traced to a tool result, uncertain extractions are flagged rather than imported, and modelled figures (stock, packaging, estimated commission) are labelled.

## Credits

The supplier order checks, the stock & expiry forecast, the receipt-reading prompt rules and the pre-read sample approach were adapted from **LarderCheck**, built by addybrm in [ClaudeHackathon](https://github.com/addybrm/ClaudeHackathon). In MarginOS the forecast is driven by recipe usage from real sales instead of a manually entered daily average, and the order checks price every discrepancy so it can be claimed back.

## Assumptions

- All sales are standard-rated at 20% VAT, with VAT-inclusive menu prices. Supplier prices are ex VAT.
- Platforms charge commission on (order value − restaurant-funded discount). Platform-funded promotions are not restaurant costs.
- Packaging per dish is an owner estimate and is labelled as one.
- Food cost is theoretical (recipe × sales). Purchase-vs-usage variance is only captured through recorded waste, and through the stock model's expiry estimate.
- The stock forecast uses one average usage rate for the last 28 days and typical shelf lives. Recorded waste is not subtracted from it.
- MVP tenancy is one local workspace; the most recently created business is active. There is no login, but the schema and RLS are ready for it.

## Known limitations

- The live Claude investigator and invoice extraction need an API key. They were **not exercised end-to-end in this build environment** (no key was available). The demo-mode path, all tools, the pre-read samples and the extraction validation logic are tested.
- Supplier order confirmations come from a CSV (or the demo seed). Reading order emails directly with Claude is the natural next step.
- Reporting periods are calendar months only.
- No live POS or platform integrations (CSV only). No multi-location analytics or forecasting.
