import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / "backend"))

# API contract tests run against an isolated database with no live AI,
# so they never touch backend/margin_os.db. Must be set before `app` is imported.
os.environ["DATABASE_URL"] = f"sqlite:///{(Path(tempfile.mkdtemp()) / 'contract.db').as_posix()}"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["AUTH_REQUIRED"] = "false"
