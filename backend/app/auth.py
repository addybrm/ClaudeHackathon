"""Authentication & role-based authorisation (FR1, NFR03, NFR04).

Passwords: PBKDF2-HMAC-SHA256 (200k iterations, per-user salt).
Tokens: HMAC-SHA256 signed, expiring bearer tokens (stateless).

DEMO MODE (AUTH_REQUIRED=false, the default): a request WITHOUT a token is treated as the demo
owner so the hackathon demo works without a login screen. A request WITH a token is always
verified. This is not production security; set AUTH_REQUIRED=true and a fixed SECRET_KEY,
and serve over HTTPS, before handling real data.
"""
import base64
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass
from fastapi import Depends, Header, HTTPException
from . import config

ROLES = ("owner", "manager", "kitchen", "finance")

# permission -> roles allowed
PERMISSIONS = {
    "read": set(ROLES),
    "menu:write": {"owner", "manager"},
    "invoice:write": {"owner", "manager", "finance"},
    "waste:write": {"owner", "manager", "kitchen"},
    "report:read": {"owner", "manager", "finance"},
    "admin": {"owner"},
}


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return f"pbkdf2_sha256$200000${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iters, salt, digest = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iters))
        return hmac.compare_digest(dk.hex(), digest)
    except ValueError:
        return False


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def issue_token(email: str, name: str, role: str) -> str:
    payload = _b64(json.dumps({"sub": email, "name": name, "role": role,
                               "exp": int(time.time()) + config.TOKEN_TTL_HOURS * 3600}).encode())
    sig = _b64(hmac.new(config.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


@dataclass
class Principal:
    email: str
    name: str
    role: str
    demo: bool = False


def decode_token(token: str) -> Principal:
    try:
        payload, sig = token.split(".")
        expected = _b64(hmac.new(config.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):
            raise ValueError
        data = json.loads(_unb64(payload))
        if data["exp"] < time.time() or data["role"] not in ROLES:
            raise ValueError
        return Principal(data["sub"], data["name"], data["role"])
    except (ValueError, KeyError, json.JSONDecodeError):
        raise HTTPException(401, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"})


DEMO_PRINCIPAL = Principal("owner@marginos.demo", "Demo Owner", "owner", demo=True)


def current_user(authorization: str | None = Header(default=None)) -> Principal:
    if authorization and authorization.lower().startswith("bearer "):
        return decode_token(authorization[7:].strip())
    if config.AUTH_REQUIRED:
        raise HTTPException(401, "Authentication required", headers={"WWW-Authenticate": "Bearer"})
    return DEMO_PRINCIPAL


def require(permission: str):
    def dep(user: Principal = Depends(current_user)) -> Principal:
        if user.role not in PERMISSIONS[permission]:
            raise HTTPException(403, f"Role '{user.role}' is not allowed to perform '{permission}'")
        return user
    return dep
