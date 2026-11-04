# ClaudeHackathon

**MarginOS** (`marginos/`, this branch): AI profit intelligence for independent restaurants. It connects POS exports, supplier invoices and receipts, supplier orders, recipes, delivery statements, waste logs and rotas, then Claude investigates why profitability changed using deterministic financial tools. It includes LarderCheck's supplier order checks, stock & expiry forecast and receipt reading, adapted into one product.

```bash
cd marginos && npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
npm run dev        # http://localhost:3000
```

See [`marginos/README.md`](marginos/README.md) for features, formulas, safeguards and the business case.

**LarderCheck** (`app/`): the original receipt-checking prototype. See [`app/README.md`](app/README.md).

Other folders: `requirements/` holds the hackathon checklist, and `agent-comms/` is how collaborators' agents coordinate.
