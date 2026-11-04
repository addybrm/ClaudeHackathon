"""MARGIN OS API. Run: uvicorn app.main:app --reload --port 8000 (from /backend)."""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from . import config
from .routers import catalog, insights, operations
from .seed import init_db

log = logging.getLogger("margin_os")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()  # creates tables and seeds the fictional demo restaurant if the DB is empty
    yield


app = FastAPI(title="MARGIN OS API", version="2.0.0", lifespan=lifespan,
              description="Know your costs. Protect your margins. Financial figures are deterministic; AI only explains them.")
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_credentials=False,
                   allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Authorization", "Content-Type"])


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception):
    log.exception("Unhandled error", exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/api/health", tags=["meta"])
def health():
    return {"status": "ok", "version": app.version,
            "advisor": {"provider": "anthropic" if config.ANTHROPIC_API_KEY else "demo", "live_ai": bool(config.ANTHROPIC_API_KEY)},
            "advisor_mode": "live" if config.ANTHROPIC_API_KEY else "demo",  # v1 alias used by the frontend
            "auth_mode": "required" if config.AUTH_REQUIRED else "demo-open",
            "currency": config.CURRENCY}


app.include_router(insights.router)
app.include_router(catalog.router)
app.include_router(operations.router)
