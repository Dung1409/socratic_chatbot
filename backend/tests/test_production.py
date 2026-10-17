import os
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from backend.app import config
from backend.app.auth import AuthService
from backend.app.db import Database
from backend.app.main import create_app
from backend.app import migrate, worker
from backend.app.jobs import JobQueue
from backend.tests.fake_tutor import FakeTutor
from backend.tests.test_api import start, action


@pytest.fixture
def production_settings(monkeypatch, tmp_path):
    values = {
        "APP_ENV": "production", "DATABASE_URL": "postgresql://user:private@db.invalid/socratic",
        "JWT_SECRET": "a-private-production-signing-key-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        "AUTH_COOKIE_SECURE": "true", "AUTH_ALLOWED_ORIGINS": "https://study.example.com",
        "CORS_ORIGINS": "https://study.example.com", "FORWARDED_ALLOW_IPS": "10.20.0.0/16",
        "AUTO_MIGRATE": "false", "BACKGROUND_JOBS": "true", "TUTOR_MODE": "openai",
        "OPENAI_API_KEY": "fake-key-only-for-tests", "STORAGE_PATH": str(tmp_path / "storage"),
    }
    for key, value in values.items():
        monkeypatch.setenv(key, value)
    return values


@pytest.mark.parametrize("url", ["", "sqlite:///local.db", "https://db.invalid/name", "postgresql://db.invalid"])
def test_production_requires_explicit_postgres_url(production_settings, monkeypatch, url):
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("PGHOST", "must-not-fallback.invalid")
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        Database.from_env()


def test_production_no_automatic_migration(production_settings, monkeypatch):
    assert config.auto_migrate() is False
    monkeypatch.setenv("AUTO_MIGRATE", "true")
    with pytest.raises(RuntimeError, match="AUTO_MIGRATE"):
        config.auto_migrate()


@pytest.mark.parametrize("key,value", [
    ("AUTH_COOKIE_SECURE", "false"), ("JWT_SECRET", ""),
    ("JWT_SECRET", "REPLACE_WITH_A_PRIVATE_RANDOM_SIGNING_KEY"),
])
def test_production_rejects_unsafe_auth(production_settings, monkeypatch, key, value):
    monkeypatch.setenv(key, value)
    with pytest.raises(RuntimeError, match=key):
        AuthService(Database.from_env()).configure()


@pytest.mark.parametrize("origin", ["", "*", "https://*.example.com", "http://example.com", "https://example.com/path"])
def test_production_origin_allowlist(production_settings, monkeypatch, origin):
    monkeypatch.setenv("CORS_ORIGINS", origin)
    with pytest.raises(RuntimeError, match="CORS_ORIGINS"):
        create_app()


@pytest.mark.parametrize("proxies", ["", "*", "0.0.0.0/0", "::/0", "proxy.invalid"])
def test_production_rejects_unbounded_proxy_trust(production_settings, monkeypatch, proxies):
    monkeypatch.setenv("FORWARDED_ALLOW_IPS", proxies)
    with pytest.raises(RuntimeError, match="FORWARDED_ALLOW_IPS"):
        config.validate_runtime(Database.from_env())


def test_worker_does_not_require_api_secrets(production_settings, monkeypatch):
    for name in ("JWT_SECRET", "OPENAI_API_KEY", "FORWARDED_ALLOW_IPS", "AUTH_ALLOWED_ORIGINS", "CORS_ORIGINS"):
        monkeypatch.delenv(name)
    config.validate_runtime(Database.from_env(), worker=True)


def test_production_requires_ai_key(production_settings, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "")
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        config.validate_runtime(Database.from_env())


def test_production_startup_never_migrates_and_readiness_tracks_config(production_settings, monkeypatch):
    def forbidden(*args):
        raise AssertionError("API must not run migrations")
    monkeypatch.setattr(Database, "initialize", forbidden)
    monkeypatch.setattr(Database, "check_ready", lambda self: None)
    monkeypatch.setattr(config.os.path, "ismount", lambda path: True)
    with TestClient(create_app(), base_url="https://study.example.com") as api:
        assert api.get("/api/ready").status_code == 200
        monkeypatch.setenv("OPENAI_API_KEY", "")
        assert api.get("/api/health").status_code == 200
        assert api.get("/api/ready").status_code == 503


def test_production_does_not_read_local_dotenv():
    env = {**os.environ, "APP_ENV": "production"}
    env.pop("DATABASE_URL", None)
    env.pop("PGHOST", None)
    script = "from unittest.mock import patch\nwith patch('dotenv.load_dotenv', side_effect=AssertionError('dotenv must not load')):\n from backend.app.db import Database\n Database.from_env()"
    result = subprocess.run([sys.executable, "-c", script],
                            env=env, capture_output=True, text=True)
    assert result.returncode != 0
    assert "DATABASE_URL must" in result.stderr
    assert "private" not in result.stderr


def test_no_sensitive_validation_or_error_logs(database, authorize, caplog, monkeypatch):
    with TestClient(create_app(database.path)) as api:
        bad = api.post("/api/auth/register", json={"email": "x@example.com", "display_name": "X", "password": "tiny42"})
        assert bad.status_code == 422
        assert "tiny42" not in bad.text
        authorize(api)
        def fail(*args, **kwargs):
            raise RuntimeError("secret-driver-message")
        monkeypatch.setattr(Database, "all", fail)
        response = api.get("/api/assignments?token=private-query")
        assert response.status_code == 500
        assert "secret-driver-message" not in response.text + caplog.text
        assert "private-query" not in caplog.text
        assert "no-store" in response.headers["Cache-Control"]
        assert response.headers["Vercel-CDN-Cache-Control"] == "no-store"


def test_ai_quota_persists_and_does_not_call_provider_again(database, authorize, monkeypatch):
    monkeypatch.setenv("AI_REQUESTS_PER_HOUR", "1")
    monkeypatch.setenv("TUTOR_MODE", "openai")
    with TestClient(create_app(database.path, tutor_engine=FakeTutor())) as api:
        authorize(api)
        session = start(api)
        response = action(api, session, "messages", text="Nội dung lập luận cần dẫn chứng.")
        assert response.status_code == 429
        assert int(response.headers["Retry-After"]) > 0
        saved = api.get(f"/api/sessions/{session['id']}").json()
        assert saved["version"] == 0
        assert saved["pending_action"]["status"] == "failed"


def test_upload_quota(database, authorize, monkeypatch):
    monkeypatch.setenv("UPLOADS_PER_HOUR", "1")
    with TestClient(create_app(database.path)) as api:
        authorize(api)
        data = {"file": ("test.txt", "Nội dung văn bản đủ dài để trích xuất.".encode())}
        assert api.post("/api/uploads/extract", files=data).status_code == 200
        assert api.post("/api/uploads/extract", files=data).status_code == 429


def test_proxy_only_accepts_forwarding_from_trusted_networks():
    async def reflect(scope, receive, send):
        if scope["type"] == "lifespan":
            while True:
                message = await receive()
                if message["type"] == "lifespan.startup":
                    await send({"type": "lifespan.startup.complete"})
                else:
                    await send({"type": "lifespan.shutdown.complete"})
                    return
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": scope["client"][0].encode()})
    app = ProxyHeadersMiddleware(reflect, trusted_hosts="10.20.0.0/16")
    with TestClient(app, client=("10.20.0.8", 123), backend_options={}) as api:
        assert api.get("/", headers={"X-Forwarded-For": "203.0.113.9"}).text == "203.0.113.9"
    with TestClient(app, client=("192.0.2.8", 123)) as api:
        assert api.get("/", headers={"X-Forwarded-For": "203.0.113.9"}).text == "192.0.2.8"


def test_parser_deadline_retries_job(database, tmp_path, monkeypatch):
    queue = JobQueue(database, tmp_path / "uploads")
    document = queue.submit("test.txt", b"long enough document for parsing")
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired("parser", kwargs["timeout"])
    monkeypatch.setattr(worker.subprocess, "run", timeout)
    assert worker.process_one(queue)
    saved = queue.document(document["document_id"])
    assert saved["status"] == "uploaded" and saved["attempts"] == 1


def test_migration_failure_has_nonzero_exit_and_no_secret(monkeypatch, caplog):
    def fail():
        raise RuntimeError("postgresql://secret:password@private/database")
    monkeypatch.setattr(Database, "from_env", fail)
    assert migrate.main() == 1
    assert "password" not in caplog.text


def test_readiness_probes_storage(database, tmp_path, monkeypatch):
    monkeypatch.setenv("BACKGROUND_JOBS", "true")
    with TestClient(create_app(database.path, storage_path=tmp_path / "uploads")) as api:
        assert api.get("/api/ready").status_code == 200
        def unavailable(path):
            raise OSError("storage unavailable")
        monkeypatch.setattr(config, "check_storage", unavailable)
        assert api.get("/api/health").status_code == 200
        assert api.get("/api/ready").status_code == 503
