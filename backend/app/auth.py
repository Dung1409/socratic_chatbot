import hashlib
import hmac
import math
import os
import time
from dataclasses import dataclass
from uuid import uuid4

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pwdlib import PasswordHash
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from .db import Database
from . import config

ACCESS_COOKIE = "socratic_access"
REFRESH_COOKIE = "socratic_refresh"
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
ISSUER = "socratic-chatbot"
AUDIENCE = "socratic-web"


class Credentials(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr
    password: str = Field(min_length=1, max_length=128, repr=False)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value):
        return value.lower()


class Registration(Credentials):
    display_name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=128, repr=False)

    @field_validator("display_name", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value


@dataclass(frozen=True)
class Principal:
    user: dict
    session_id: str
    expires_at: float
    refresh_hash: str

    @property
    def id(self):
        return self.user["id"]


class AuthService:
    def __init__(self, db: Database):
        self.db = db
        self.passwords = PasswordHash.recommended()

    def configure(self):
        self.secret = os.getenv("JWT_SECRET", "")
        if len(self.secret.encode()) < 32:
            raise RuntimeError("JWT_SECRET must contain at least 32 random bytes; configure it before starting the API")
        if config.production() and (len(set(self.secret)) < 8 or any(
                marker in self.secret.lower() for marker in ("placeholder", "replace", "change-me", "test-only"))):
            raise RuntimeError("JWT_SECRET must be a private random signing key, not an example value")
        self.secure = config.boolean("AUTH_COOKIE_SECURE", config.production())
        if config.production() and not self.secure:
            raise RuntimeError("AUTH_COOKIE_SECURE must be true in production")
        self.access_seconds = config.positive_integer("AUTH_ACCESS_SECONDS", 900)
        self.refresh_seconds = config.positive_integer("AUTH_REFRESH_SECONDS", 604800)
        if self.access_seconds < 1 or self.refresh_seconds <= self.access_seconds:
            raise RuntimeError("Auth token lifetimes are invalid")
        self.dummy_hash = self.passwords.hash("not-a-real-account-password")

    def csrf(self, session_id):
        return hmac.new(self.secret.encode(), f"csrf:{session_id}".encode(), hashlib.sha256).hexdigest()

    def check_csrf(self, request, session_id):
        token = request.headers.get("X-CSRF-Token", "")
        if not hmac.compare_digest(token.encode(), self.csrf(session_id).encode()):
            raise HTTPException(403, "Yêu cầu không hợp lệ. Vui lòng tải lại trang.")

    def token(self, user_id, session_id, kind, expiry):
        timestamp = int(time.time())
        return jwt.encode({"sub": user_id, "sid": session_id, "typ": kind, "jti": str(uuid4()),
                           "iat": timestamp, "nbf": timestamp, "exp": int(expiry),
                           "iss": ISSUER, "aud": AUDIENCE}, self.secret, algorithm="HS256")

    def cookies(self, response, user_id, session_id, expires_at):
        timestamp = time.time()
        access = self.token(user_id, session_id, "access", min(timestamp + self.access_seconds, expires_at))
        refresh = self.token(user_id, session_id, "refresh", expires_at)
        options = {"httponly": True, "secure": self.secure, "samesite": "lax"}
        response.set_cookie(ACCESS_COOKIE, access, max_age=min(self.access_seconds, max(0, int(expires_at - timestamp))), path="/api", **options)
        response.set_cookie(REFRESH_COOKIE, refresh, max_age=max(0, int(expires_at - timestamp)), path="/api/auth", **options)
        return hashlib.sha256(refresh.encode()).hexdigest()

    def clear_cookies(self, response):
        options = {"httponly": True, "secure": self.secure, "samesite": "lax"}
        response.delete_cookie(ACCESS_COOKIE, path="/api", **options)
        response.delete_cookie(REFRESH_COOKIE, path="/api/auth", **options)

    def authenticate(self, request, kind="access", check_refresh=True):
        cookie = request.cookies.get(ACCESS_COOKIE if kind == "access" else REFRESH_COOKIE)
        try:
            claims = jwt.decode(cookie or "", self.secret, algorithms=["HS256"], issuer=ISSUER, audience=AUDIENCE,
                                options={"require": ["sub", "sid", "typ", "jti", "iat", "nbf", "exp"]})
            if claims["typ"] != kind or not isinstance(claims["sid"], str):
                raise jwt.InvalidTokenError()
        except jwt.InvalidTokenError as exc:
            raise HTTPException(401, "Vui lòng đăng nhập để tiếp tục.") from exc
        with self.db.connect() as conn:
            row = self.db.execute(conn, """
                SELECT u.id, u.email, u.display_name, s.id AS session_id, s.expires_at, s.refresh_hash
                FROM auth_sessions s JOIN users u ON u.id=s.user_id
                WHERE s.id=? AND s.user_id=? AND s.revoked_at IS NULL AND s.expires_at>?
            """, (claims["sid"], claims["sub"], time.time())).fetchone()
        if row is None or (kind == "refresh" and check_refresh and not hmac.compare_digest(
                row["refresh_hash"], hashlib.sha256(cookie.encode()).hexdigest())):
            raise HTTPException(401, "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")
        return Principal({key: row[key] for key in ("id", "email", "display_name")},
                         row["session_id"], row["expires_at"], row["refresh_hash"])

    def current_user(self, request: Request):
        principal = self.authenticate(request)
        if request.method in UNSAFE_METHODS:
            self.check_csrf(request, principal.session_id)
        return principal

    def session_result(self, principal):
        return {"user": principal.user, "csrf_token": self.csrf(principal.session_id)}

    def open_session(self, conn, response, user):
        session_id = str(uuid4())
        timestamp = time.time()
        expires_at = timestamp + self.refresh_seconds
        refresh_hash = self.cookies(response, user["id"], session_id, expires_at)
        self.db.execute(conn, """INSERT INTO auth_sessions
            (id, user_id, refresh_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)""",
            (session_id, user["id"], refresh_hash, timestamp, expires_at))
        return {"user": {key: user[key] for key in ("id", "email", "display_name")},
                "csrf_token": self.csrf(session_id)}

    def rate_limit(self, request, email, action):
        ip = request.client.host if request.client else "unknown"
        buckets = [(f"{action}-ip:{ip}", 100 if action == "login" else 20, 900)]
        if action == "login":
            buckets.append((f"login-email:{email}", 10, 900))
        self.consume_limits(buckets)

    def resource_limit(self, user_id, resource):
        setting, default = (("AI_REQUESTS_PER_HOUR", 60) if resource == "ai" else ("UPLOADS_PER_HOUR", 20))
        self.consume_limits([(f"{resource}-user:{user_id}", config.positive_integer(setting, default), 3600)])

    def consume_limits(self, buckets):
        timestamp = time.time()
        with self.db.connect(write=True) as conn:
            for key, limit, window in buckets:
                key = hashlib.sha256(key.encode()).hexdigest()
                row = self.db.execute(conn, "SELECT window_start, attempts FROM auth_rate_limits WHERE id=?", (key,)).fetchone()
                if row and timestamp - row["window_start"] < window:
                    if row["attempts"] >= limit:
                        retry_after = max(1, math.ceil(window - (timestamp - row["window_start"])))
                        raise HTTPException(429, "Quá nhiều lần thử. Vui lòng thử lại sau.", headers={"Retry-After": str(retry_after)})
                    self.db.execute(conn, "UPDATE auth_rate_limits SET attempts=attempts+1 WHERE id=?", (key,))
                else:
                    self.db.execute(conn, """INSERT INTO auth_rate_limits (id, window_start, attempts)
                        VALUES (?, ?, 1) ON CONFLICT(id) DO UPDATE SET window_start=excluded.window_start, attempts=1""", (key, timestamp))
            self.db.execute(conn, "DELETE FROM auth_rate_limits WHERE window_start<?", (timestamp - 86400,))


def auth_router(auth: AuthService):
    router = APIRouter(prefix="/api/auth", tags=["Authentication"])

    @router.post("/register", status_code=201)
    def register(body: Registration, request: Request, response: Response):
        auth.rate_limit(request, body.email, "register")
        # Expensive hashing happens before acquiring a write transaction.
        password_hash = auth.passwords.hash(body.password)
        user = {"id": str(uuid4()), "email": body.email, "display_name": body.display_name}
        with auth.db.connect(write=True) as conn:
            inserted = auth.db.execute(conn, """INSERT INTO users (id, email, display_name, password_hash, created_at)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING""",
                (user["id"], user["email"], user["display_name"], password_hash, time.time()))
            if inserted.rowcount != 1:
                raise HTTPException(409, "Email này đã được đăng ký.")
            return auth.open_session(conn, response, user)

    @router.post("/login")
    def login(body: Credentials, request: Request, response: Response):
        auth.rate_limit(request, body.email, "login")
        with auth.db.connect() as conn:
            row = auth.db.execute(conn, "SELECT * FROM users WHERE email=?", (body.email,)).fetchone()
        valid = auth.passwords.verify(body.password, row["password_hash"] if row else auth.dummy_hash)
        if row is None or not valid:
            raise HTTPException(401, "Email hoặc mật khẩu không đúng.")
        with auth.db.connect(write=True) as conn:
            return auth.open_session(conn, response, dict(row))

    @router.get("/me")
    def me(user: Principal = Depends(auth.current_user)):
        return auth.session_result(user)

    @router.get("/csrf")
    def csrf(request: Request):
        user = auth.authenticate(request, "refresh")
        return {"csrf_token": auth.csrf(user.session_id)}

    @router.post("/refresh")
    def refresh(request: Request, response: Response):
        user = auth.authenticate(request, "refresh", check_refresh=False)
        auth.check_csrf(request, user.session_id)
        token_hash = hashlib.sha256(request.cookies[REFRESH_COOKIE].encode()).hexdigest()
        replay = False
        with auth.db.connect(write=True) as conn:
            row = auth.db.execute(conn, "SELECT refresh_hash, revoked_at FROM auth_sessions WHERE id=?", (user.session_id,)).fetchone()
            if row["revoked_at"] is not None:
                raise HTTPException(401, "Phiên đăng nhập đã kết thúc.")
            if not hmac.compare_digest(row["refresh_hash"], token_hash):
                auth.db.execute(conn, "UPDATE auth_sessions SET revoked_at=? WHERE id=?", (time.time(), user.session_id))
                replay = True
            else:
                rotated_hash = auth.cookies(response, user.id, user.session_id, user.expires_at)
                auth.db.execute(conn, "UPDATE auth_sessions SET refresh_hash=? WHERE id=?", (rotated_hash, user.session_id))
        if replay:
            raise HTTPException(401, "Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.")
        return auth.session_result(user)

    @router.post("/logout")
    def logout(request: Request, response: Response):
        try:
            user = auth.authenticate(request, "refresh")
        except HTTPException:
            try:
                user = auth.authenticate(request)
            except HTTPException:
                user = None
        if user is not None:
            auth.check_csrf(request, user.session_id)
            with auth.db.connect(write=True) as conn:
                auth.db.execute(conn, "UPDATE auth_sessions SET revoked_at=? WHERE id=?", (time.time(), user.session_id))
        auth.clear_cookies(response)
        return {"status": "logged_out"}

    return router
