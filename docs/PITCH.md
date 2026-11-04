# MARGIN OS: Pitch (six slides, matches hackathon-pitch-template.pptx)

> **Honesty rules for this deck.**
> - Figures marked **[DEMO]** come from the fictional demo dataset and the live app.
> - Figures marked **[ASSUMPTION]** are our estimates and need validating.
> - Anything marked **[TEAM TO FILL]** must come from the team; we have not invented it.
> - No market statistics are quoted without a source.

---

## Slide 1: Product and team introduction

| Field | Content |
|---|---|
| Team name | **[TEAM TO FILL]** |
| One line | **MARGIN OS: an AI-powered financial operating system that shows independent restaurants what every dish really earns, which supplier prices are eating their margin, and what to do about it.** |
| Tagline | *Know your costs. Protect your margins.* |
| Who it's for | Independent restaurants in North East England running 1–3 sites |
| Track | **Small Business, Big Tools** (delete the other two tracks from the template) |

---

## Slide 2: The problem and who has it

**Who has it.** *Sam, owner of a two-site bistro in Newcastle*. Sam is a **hypothetical interview persona** built from the PACT stakeholder analysis (owner, manager, kitchen manager, finance admin).
**[TEAM TO FILL]** If the team has spoken to a real North East operator, replace Sam with their name and role (with permission) or their role and organisation.

**The pain (one sentence).** Supplier prices change invoice by invoice, but owners only see the damage at month-end, if at all. In our two-site demo restaurant that adds up to **£1,401 of profit leakage in four weeks, about £18k a year if it continues [DEMO, fictional data]**.

**Why now.** Food, energy and labour costs are all under pressure at once (PACT "Economic" context), so margins that used to absorb price rises no longer do. AI can now explain the numbers to an owner in plain English, which was not affordable for a two-site business before.
**[TEAM TO FILL]** Add one sourced statistic, such as the latest ONS CPI "food and non-alcoholic beverages" figure or a UKHospitality cost survey, with its source and date.

---

## Slide 3: What we built

| In | MARGIN OS | Out |
|---|---|---|
| Supplier invoices (CSV, PDF, photo), recipes, weekly sales and a kitchen waste log, data the owner already has | Deterministic finance engine costs every dish at today's prices, tracks every supplier price, and reconciles purchases against what recipes should have used. **The AI advisor (Claude) explains the findings in plain English and runs what-if scenarios** | A 30-second dashboard, ranked dishes, £-quantified alerts and a short action list, each with the figures behind it |

**Example output [DEMO].**
- "Cod is up 22% over 12 weeks; Cod & Chips food cost is now 33% against a 30% target."
- "£272 of cod was bought in four weeks beyond what recipes and recorded waste explain: check portioning."
- "Coast Road Fisheries quoted £17.60/kg against £18.90 today."
- "Raising Cod & Chips to £17.50 adds about £244 a week if sales hold" (simulation).

**Why it beats the alternatives.**
- **Doing nothing or using the accountant:** a monthly look back, with no dish-level view.
- **Spreadsheets:** break when prices change, never reconcile invoices against recipes, and nobody has time to update them during service.
- **Enterprise BI and restaurant suites:** priced and sized for chains.
- **MARGIN OS:** updates with every invoice, puts a £ figure on each problem, and tells the owner what to do first.

**The AI's role (and its limit).** Every number is calculated deterministically. The AI explains those figures and never invents them. In the demo the advisor runs in labelled **demo mode** (rule-based), and live Claude switches on with an API key.

---

## Slide 4: Who pays, and does it make money?

**Who pays.** The owner-operator, who is also the main user. Managers, the kitchen and finance staff are invited free, so there is no conflict between payer and user.
**How many of them.** **[TEAM TO FILL]** Size the market from the Food Standards Agency food hygiene ratings open data by counting "Restaurant/Cafe/Canteen" establishments across the 12 North East local authorities, then filtering out chains. We have not done this count yet and will not quote a number until we have.

| Figure | Value | Basis |
|---|---|---|
| **Our price** | **£79 per site per month** | [ASSUMPTION] Below the cost of a few hours of bookkeeping. Validate in pilots |
| **Cost to serve one customer, including AI** | **≈ £15 per month** | [ASSUMPTION] Breakdown below |
| **Customers to break even** | **≈ 32** | [ASSUMPTION] £2,000/month fixed costs ÷ £64 contribution per customer |

| Cost to serve (per customer per month) | £ |
|---|---|
| AI (Claude Opus 5.5 at $4 / $20 per million input / output tokens): 150 advisor questions × (~6k input + ~1.4k output incl. thinking) + 20 invoice photos × (~2k in + ~1.5k out) ≈ $8.60 | ≈ 7.00 |
| Hosting, database, backups, monitoring (shared infrastructure, amortised) | ≈ 5.00 |
| Card payment fees (~2.5% + 20p) | ≈ 2.20 |
| Email and other | ≈ 0.80 |
| **Total** | **≈ 15.00** |

AI pricing is from Anthropic's published API rates. Switching the advisor to Claude Sonnet 5.5 ($2/$10) roughly halves the AI line. The exchange rate is assumed at about $1.25 to £1.

**At 100 customers (same price) [ASSUMPTION].**
- Revenue: £7,900 a month.
- Variable cost: about £1,500.
- Contribution: about £6,400.
- After £2,000 fixed costs: **about £4,400 a month profit**, before founder salaries.

---

## Slide 5: Our first 100 customers

**Who and the offer.**
- **Who:** independent, owner-run restaurants and gastropubs with 1–3 sites in Newcastle, Gateshead, Durham and Sunderland, especially fish, grill and gastropub menus, where protein price swings hit hardest.
- **Offer:** a free 30-day pilot. We load their last 8 weeks of invoices and recipes and show them their leakage figure, then they move to £79 per site per month.

**Route in.**
1. Walk-ins and introductions in the team's own networks **[TEAM TO FILL: real contacts only]**.
2. Local hospitality groups and business networks, such as North East chambers of commerce and the hospitality associations active in the region **[TEAM TO FILL: confirm which]**.
3. Partnerships with independent accountants and bookkeepers who serve restaurants.
4. Supplier-neutral positioning: we help owners negotiate, and we take no supplier commissions.

**Target numbers [ASSUMPTION, plan].**

| By | Conversations | Pilots | Paying customers |
|---|---|---|---|
| Month 1 | 40 | 10 | 0 |
| Month 3 | 150 | 35 | 20 |
| Month 6 | 350 | 80 | 50 |
| Month 12 | | | 100 |

**Biggest risk.** Owners will not upload invoices or keep recipes up to date, so the data goes stale and the insight disappears.
**Test:** in the first 10 pilots, measure how many invoices each site uploads per week without prompting. Success means 8 of 10 sites stay current for 4 weeks. Mitigations if not: photo upload from the phone, then accountant or bookkeeper upload on the owner's behalf.

---

## Slide 6: The team

| Name | Role | Actual contribution |
|---|---|---|
| **[TEAM TO FILL]** | Product / project lead | Product decisions, PACT analysis, presentation |
| **[TEAM TO FILL]** | … | … |

**Why this team.** **[TEAM TO FILL]** Use real skills, experience and motivation only.

**How we built it (optional, for transparency).** The team directed three AI coding agents:
- **Claude:** architecture, backend, financial engine and AI advisor.
- **Codex:** frontend and design.
- **GitHub Copilot:** QA and test data.

All agent output was reviewed against a shared API contract and an automated test suite.

---

## Live demo script (3 minutes)

Use the live app with the backend running. All figures are [DEMO].

**1. Dashboard (default: last 4 weeks, all sites).**

| Figure | Value |
|---|---|
| Revenue | £74,056 |
| Ingredient spend | £18,680 |
| Food cost | 25.2% against a 30% target |
| Gross margin | 74.8% |
| Ingredient spend vs revenue | up 17.6% against revenue up 10.4% |
| Leakage | £1,401 (about £18.2k a year) |

**2. Change the date range to 10 Aug – 1 Nov.** The price-change list now shows the full story: **cod +21.9%, lamb +23.7%**.

**3. Menu.**
- Cod & Chips is the #1 profit earner but sits at 33.2% food cost (target price £18.24).
- Slow-braised Lamb is 32.4%, with its margin down 3.4 points.
- Roast Vegetable Tart is the only "dog".

**4. Leakage.** Cod bought beyond recipe usage: **£272 in 4 weeks**.

**5. Suppliers.** Coast Road Fisheries quoted £17.60 against £18.90, worth about £306 at this period's volume.

**6. Advisor.** Ask "Why is my profit falling?", then "What if I raise fish and chips to £17.50?". The answer is **+£244 a week**, assuming volumes hold. **Point at the "Demo advisor: not live AI" label.**

**7. Invoice.** Upload a CSV in which cod is at £20.10.
- The draft flags +6.35% and one unrecognised line.
- Fix or remove that line, confirm, and the price history updates.

**8. Close.** "Know your costs. Protect your margins."
