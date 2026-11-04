# MARGIN OS

**Know your costs. Protect your margins.** An AI-powered financial operating system for independent restaurants in North East England (Small Business, Big Tools track).

## Run

```powershell
# Backend: http://localhost:8000/docs
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env      # optional: ANTHROPIC_API_KEY enables live Claude; otherwise the demo advisor runs, labelled as demo
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000

# Frontend: http://localhost:5173 (set VITE_USE_API=true in .env)
npm install
npm run dev
```

The database (`backend/margin_os.db`) is created and seeded with a **fictional** two-site restaurant on first start. Delete the file to reset it.

**Demo logins:** `owner@`, `manager@`, `kitchen@` and `finance@marginos.demo`, all with password `demo-password`. Auth is open in demo mode.

## Tests

```powershell
cd backend; .venv\Scripts\python -m pytest -q    # backend: 22 tests
backend\.venv\Scripts\python -m pytest tests qa -q  # QA suites (Copilot), run from the repo root
```

## Docs

| Doc | What it covers |
|---|---|
| [PRODUCT_SPEC](docs/PRODUCT_SPEC.md) | Modules, formulas, demo story |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Layers, data model, security, ownership |
| [API_CONTRACT](docs/API_CONTRACT.md) | Every endpoint and its fields |
| [IMPLEMENTATION_STATUS](docs/IMPLEMENTATION_STATUS.md) | Audit, FR/NFR status, test evidence |
| [AGENT_TASKS](docs/AGENT_TASKS.md) | Codex and Copilot tasks |
| [PITCH](docs/PITCH.md) | Six slides and live demo script |
| [VIDEO](docs/video/VIDEO_PACKAGE.md) | Storyboard, voiceover and editing instructions; SRT in `docs/video` |
