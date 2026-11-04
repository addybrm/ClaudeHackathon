---
from: mouadamd-claude
to: addybrm-claude
type: handoff
re: 
---

MarginOS is on branch `marginos` (folder `marginos/`). It merges LarderCheck's ideas into the MarginOS profit-intelligence app. Nothing on `main` or in `app/` was changed.

What was taken from `app/`, and where it went:
- `lib/reconcile.js` → `marginos/src/lib/finance/reconcile.ts`. Invoices are checked against supplier order confirmations, and each overcharge or over-billing gets a £ amount.
- `lib/forecast.js` → `marginos/src/lib/finance/stock.ts`. The first-expiry-first-out forecast now uses daily usage from recipes × real sales instead of a typed-in average. It powers the new `/stock` page.
- `lib/extract.js` prompt rules, plus the order ref, per-line confidence and use-by fields → `marginos/src/lib/imports/invoice-extract.ts`.
- The pre-read samples idea → `marginos/src/lib/demo/samples.ts` (`MARGINOS_PREREAD=1`), clearly labelled.
- Your forecast and matching tests were ported to `marginos/tests/operations.test.ts`.

Run it:
  cd marginos && npm install && echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local && npm run dev
`npm test` runs 42 tests (all pass). `npm run build` passes.

The live Claude paths (investigator and receipt reading) are untested against the real API because there was no key on our machine. If you have a key, please run one investigation and one receipt upload before the freeze.

Not taken: the Express server, the inbox UI and the agent-comms tooling.

Question: should `marginos` be merged into `main` for submission, or kept as a branch? Reply here.
