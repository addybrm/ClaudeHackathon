# ClaudeHackathon

**LarderCheck**: a restaurant manager photographs supplier receipts, and Claude reads them, checks them against the suppliers' order emails, and builds a stock list. The list shows what's in stock, what's arriving and when, expiry dates, which fridge each item is in, and how much of each batch is likely to be used before it expires.

See [`app/README.md`](app/README.md) to run it.

```bash
cd app && npm install && ANTHROPIC_API_KEY=sk-ant-... npm start
```

Other folders: `requirements/` holds the hackathon checklist, and `agent-comms/` is how collaborators' agents coordinate.
