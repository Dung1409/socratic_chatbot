import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

import pytest

from backend.app.db import Database


@pytest.fixture(autouse=True)
def auth_settings(monkeypatch):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "false")
    monkeypatch.setenv("AI_REQUESTS_PER_HOUR", "1000")
    monkeypatch.setenv("UPLOADS_PER_HOUR", "1000")
    monkeypatch.setenv("TUTOR_MODE", "template")
    monkeypatch.setenv("JWT_SECRET", "test-only-signing-key-with-more-than-thirty-two-bytes")
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "false")
    monkeypatch.setenv("AUTH_ALLOWED_ORIGINS", "http://testserver,http://127.0.0.1:8011")


@pytest.fixture
def authorize():
    def sign_in(client, email="learner@example.com", password="Strong test password 123", name="Người học"):
        response = client.post("/api/auth/register", json={
            "email": email, "password": password, "display_name": name,
        })
        if response.status_code == 409:
            response = client.post("/api/auth/login", json={"email": email, "password": password})
        assert response.status_code in {200, 201}, response.text
        session = response.json()
        client.headers["X-CSRF-Token"] = session["csrf_token"]
        client.user_id = session["user"]["id"]
        return session
    return sign_in


@pytest.fixture
def database(tmp_path):
    """Run the same behavior tests on SQLite or a disposable PostgreSQL schema."""
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        db = Database(str(tmp_path / "test.db"))
        db.initialize()
        yield db
        return

    import psycopg
    from psycopg import sql

    schema = f"test_{uuid4().hex}"
    with psycopg.connect(url, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    parts = urlsplit(url)
    params = dict(parse_qsl(parts.query))
    params["options"] = f"-csearch_path={schema}"
    db = Database(urlunsplit(parts._replace(query=urlencode(params))))
    try:
        db.initialize()
        yield db
    finally:
        with psycopg.connect(url, autocommit=True) as admin:
            admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
