"""Runtime configuration (environment variables, read once at import)."""
import os
import secrets
from pathlib import Path
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")

# --- AI provider -----------------------------------------------------------
# A Claude Pro subscription is NOT an API credential. Live Claude is used only
# when an Anthropic API key is supplied; otherwise the deterministic demo advisor runs.
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "").strip()
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-opus-5-5")

# --- Storage -----------------------------------------------------------------
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(BACKEND_DIR / 'margin_os.db').as_posix()}")

# --- Security ----------------------------------------------------------------
# AUTH_REQUIRED=false (default, demo): requests without a token act as the demo owner.
# AUTH_REQUIRED=true: every /api route except /health and /auth/login needs a bearer token.
AUTH_REQUIRED = os.getenv("AUTH_REQUIRED", "false").lower() == "true"
SECRET_KEY = os.getenv("SECRET_KEY") or secrets.token_hex(32)  # random per process if unset
TOKEN_TTL_HOURS = int(os.getenv("TOKEN_TTL_HOURS", "12"))

CORS_ORIGINS = [o.strip() for o in os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://localhost:4173",
).split(",") if o.strip()]

# --- Business thresholds (documented in docs/PRODUCT_SPEC.md) ----------------
CURRENCY = "GBP"
TARGET_FOOD_COST_PCT = 30.0      # dish/venue target
CRITICAL_FOOD_COST_PCT = 35.0    # above this a dish is "critical"
PRICE_ALERT_PCT = 5.0            # supplier increase that raises an alert
MARGIN_DECLINE_ALERT_PP = 2.0    # dish margin drop (percentage points) that raises an alert
VARIANCE_ALERT_PCT = 3.0         # unexplained purchasing variance vs theoretical usage
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
