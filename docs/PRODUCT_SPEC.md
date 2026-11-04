# MARGIN OS: Product Specification

**Tagline:** Know your costs. Protect your margins.
**Track:** Small Business, Big Tools
**Source requirements:** *PACT Analysis.docx* (stakeholders, activities, context, FR1–FR18, NFR01–NFR14) and *hackathon-pitch-template.pptx* (six-slide story).
**Status of each requirement:** see [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## 1. What it is

MARGIN OS is an AI-assisted financial operating system for independent restaurants. It turns the data an operator already has (supplier invoices, recipes, sales, waste logs) into:

- what each dish really earns,
- which supplier prices are rising and which dishes they hit,
- where profit is leaking and how much it costs,
- what to do next, explained in plain English.

**Target customer:** independent restaurants in North East England running about 1–3 locations, with no in-house finance team.

**Positioning:** analysis that usually needs a finance person or an expensive BI system, at a price a small restaurant can afford.

## 2. Users and roles (PACT "People")

| Role | Primary jobs | Permissions in MVP |
|---|---|---|
| Restaurant owner | See which dishes earn most and least; spot unexpected cost rises; get recommendations | Everything, including admin |
| Restaurant manager | Compare supplier prices; monitor ingredient costs; manage menu | Read all, manage menu, invoices, waste, reports |
| Kitchen manager | Record waste and see what it costs | Read, record waste |
| Finance administrator | Upload invoices instead of typing them; review spend; run reports | Read, invoices, reports |

## 3. Modules

| Module | Purpose | Key outputs |
|---|---|---|
| A. Executive dashboard | 30-second overview between services | Revenue, ingredient spend, gross profit, gross margin, food cost %, waste, leakage, supplier changes, weekly trend, top alerts; date and location filters |
| B. Menu profitability | Cost and rank every dish | Ingredients and quantities, cost, gross profit, margin, food cost %, rank, menu-engineering class, cost trend, target price |
| C. Supplier intelligence | Watch prices | Price history, supplier comparison and quotes, % change, affected dishes, £ weekly impact |
| D. Invoice intelligence | Get invoices in without typing | CSV/PDF/image upload, then an extracted draft, user review and correction, and validated save |
| E. Profit leakage | Put a £ figure on losses | Supplier increases, purchases above recipe usage, recorded waste, invoice anomalies, declining and high-cost dishes |
| F. Food waste | Make waste visible | Waste log, cost at the price in effect, by reason and ingredient, frequently wasted items, order-reduction hints |
| G. AI advisor | Explain and recommend | Plain-English diagnosis and actions from the figures above, honestly labelled demo vs live Claude |
| H. Forecasting | Look ahead | Spend and revenue projection, ingredient price trends, margin warnings, what-if simulator |
| I. Reporting | Share and keep | Period report (JSON and downloadable Markdown) with recommendations |

## 4. Financial definitions (deterministic, Decimal arithmetic)

| Metric | Formula |
|---|---|
| Ingredient cost (dish) | Σ (recipe quantity × current unit cost) |
| Gross profit (dish) | selling price − ingredient cost |
| Gross margin % | gross profit ÷ selling price × 100 |
| Food cost % | ingredient cost ÷ selling price × 100 (= 100 − gross margin %) |
| Markup % | gross profit ÷ ingredient cost × 100 (reported separately and **never** used as margin) |
| Price variation % | (new − old) ÷ old × 100 |
| Revenue (period) | Σ units sold × selling price |
| Ingredient expenditure (period) | Σ confirmed invoice line totals |
| Gross profit (period) | revenue − ingredient expenditure |
| Food cost % (period) | ingredient expenditure ÷ revenue × 100 |
| Theoretical food cost | Σ units sold × recipe cost at that week's prices |
| Waste cost | Σ waste quantity × unit price in effect on the waste date |
| Unexplained variance | ingredient expenditure − theoretical food cost − waste cost |
| Supplier-increase leakage | Σ over invoice lines in period of (invoiced price − price at period start) × quantity |
| Annualised estimate | period total ÷ weeks in period × 52 (labelled as a projection) |
| Target price | ingredient cost ÷ target food cost % |

**Menu engineering** uses the Kasavana & Smith classes. Popular means units ≥ 70% of an equal share. Profitable means unit gross profit ≥ the sales-weighted average. The four classes are **star** (popular and profitable), **plowhorse** (popular), **puzzle** (profitable) and **dog** (neither).

**Thresholds** (`backend/app/config.py`): target food cost 30%; critical above 35%; supplier alert at +5%; margin-decline alert at −2 percentage points; purchasing-variance alert at ≥3% of usage and ≥£50.

**Period handling:** sales are recorded weekly (Monday start). The default period is the last 28 days of available data, and it is compared with the previous period of equal length.

## 5. AI principles

1. Numbers come from deterministic code. The AI explains them and must not invent figures.
2. Two providers sit behind one interface. **Demo** is rule-based, always available and labelled "not live AI". **Anthropic** is live Claude, used only when `ANTHROPIC_API_KEY` is set on the server.
3. A Claude Pro subscription is not an application credential. The demo is the default.
4. Every response carries `provider`, `live_ai` and `label`. The UI must show the label.
5. Projections and simulations are always labelled as such.

## 6. Demo dataset (fictional)

**Restaurant:** "Tyne & Table", a fictional business with two sites (Quayside, Newcastle and Elvet, Durham). All names and prices are invented and illustrative.

**Contents:** 12 weeks of data (10 Aug – 1 Nov 2026), covering 10 dishes, 22 ingredients and 8 suppliers (3 of them alternative quotes only), with weekly invoices, sales and waste.

**Story the data tells:**
- Cod fillet is up 21.9% and lamb shoulder up 23.7% over 12 weeks, so Cod & Chips and Lamb drift above the 30% food-cost target.
- About 7% more cod is bought than recipes use, which suggests over-portioning. That alone is about £272 of unexplained cost over 4 weeks.
- Cheaper quotes exist for cod, lamb and potatoes.
- Cod prep-error waste rises in the last 4 weeks.
- Last 4 weeks, all sites: revenue £74,056; ingredient spend £18,680 (25.2%); estimated leakage £1,401, about **£18.2k a year** if it continues.

The seed is deterministic, so the same figures are produced on every run.

## 7. Out of scope for the MVP

Labour and energy costing, POS integration, stock counts and inventory valuation, OCR without an AI key, multi-tenant accounts, email notifications and payments. These are listed as roadmap items in IMPLEMENTATION_STATUS.md.
