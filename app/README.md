# LarderCheck

A stock checker for restaurant managers. Track 2: Small Business, Big Tools.

1. The manager uploads photos or PDFs of supplier receipts and delivery notes.
2. Claude reads each one into line items. It turns "CHKN BRST FILLET" into *Chicken breast*, converts "12 trays of 30 eggs" to 360 eggs, and picks up printed use-by dates.
3. Each receipt is checked against the supplier's confirmation email, shown in a separate **Supplier inbox** tab. Short deliveries, overcharges, missing lines and receipts with no matching order are flagged.
4. Every ingredient goes into one stock list showing:
   - how much is in stock and the price
   - the arrival date for orders still on their way (taken from dispatch emails)
   - the expiry date, printed or estimated
   - which fridge it's stored in
   - the predicted % that will be used before it expires, and the projected waste in £

Everything in the demo is fictional: the restaurant (The Lantern Kitchen), the suppliers, the emails and the receipts.

## Run it

```bash
cd app
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start      # http://localhost:3000
```

Open the app and click **Open supplier inbox ↗** to bring up the email tab. Then add the sample receipts, or drop in your own. The inbox tab updates live as receipts are matched.

| Setting | What it does |
|---|---|
| `ANTHROPIC_API_KEY` | Needed to read your own receipts. Without it, only the five sample receipts work, using the result Claude should give for each (stored in `samples/expected/`). The app labels these as pre-read. |
| `LARDER_DEMO=1` | Uses the stored results for the samples even when a key is set. This is a backup for a live pitch on bad wifi. |
| `CLAUDE_MODEL` | Defaults to `claude-opus-5-5`. |
| `TODAY` | The app's "today". Defaults to `2026-11-04` so the sample data stays meaningful. |
| `PORT` | Defaults to 3000. |

`npm test` runs the forecasting and matching tests. `npm run samples` regenerates the sample receipts (needs Python with Pillow).

## How it works

| Step | Where | Notes |
|---|---|---|
| Read the receipt | `lib/extract.js` | One Claude call per file: image or PDF in, JSON out. The output is forced to a fixed JSON schema, and the call gets the restaurant's ingredient list so names and units line up. Refusals fall back to another Claude model automatically. |
| Catch misreads | `lib/extract.js` `normalise()` | Doesn't trust the model: checks quantity × price against each line total and the line totals against the receipt total. Low-confidence lines are flagged for review. |
| Match to an email | `lib/reconcile.js` | By order reference first, then by supplier name plus a delivery date within 2 days. Compares quantity, unit and price line by line. |
| Forecast use | `lib/forecast.js` | Simulates each day: the kitchen uses "use per day" of each ingredient, taking the soonest-to-expire batch first. Whatever is left on a batch's expiry date is waste. The simulation starts at delivery, so "left now" also accounts for use since the goods arrived. |
| Storage and shelf life | `data/catalog.json` | Each ingredient has a fridge and a shelf life. Unknown items fall back to their category's defaults. |

## Where it fails

- **Usage is a flat daily average.** Real kitchens are busier at weekends and use varies by menu. The next step is to pull sales from the till system.
- **Estimated expiry dates** come from typical shelf life, not the actual product. Printed dates are used whenever the receipt has them.
- **Supplier emails are structured demo data.** A real version would have Claude read the emails as well, with the same schema and checks.
- **"Left now" is a prediction, not a count.** The manager can correct "use per day"; a stock-take feature would let them correct quantities too.
- Handwritten changes on delivery notes, or badly crumpled photos, give low-confidence lines. These are flagged rather than silently accepted.

## Cost to serve

This is an estimate, not a measured figure. One receipt photo is about 2–3k input tokens and 1–2k output tokens. With Claude Opus 5.5 ($4 / $20 per million tokens), that's roughly **4–6p per receipt**. A restaurant scanning about 60 receipts a month costs about £3 a month in AI.
