import os
import sys
import tempfile
from pathlib import Path

import pytest

# Isolated database + no live AI for every test run (must be set before the app is imported).
_tmp = Path(tempfile.mkdtemp()) / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp.as_posix()}"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["AUTH_REQUIRED"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import init_db  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def fresh(client):
    """Reset to the deterministic seed for tests that write data."""
    init_db(reset=True)
    yield client
    init_db(reset=True)
