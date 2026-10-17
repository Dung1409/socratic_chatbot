import hashlib

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from starlette.responses import Response
from uvicorn import Config
from uvicorn.middleware.proxy_headers import _TrustedHosts

from backend.app import config, entrypoint
from backend.app.auth import AuthService
from backend.app.main import create_app
from backend.tests.test_production import production_settings


def uvicorn_app(app):
    """Apply the same Uvicorn options as both supported runtime launchers."""
    command = entrypoint.api_command()
    trusted = command[command.index("--forwarded-allow-ips") + 1] if "--forwarded-allow-ips" in command else ""
    server = Config(app, proxy_headers="--proxy-headers" in command, forwarded_allow_ips=trusted)
    server.load()
    return server.loaded_app


def reflect_app():
    app = FastAPI()

    @app.get("/inspect")
    def reflect(request: Request):
        return {"client": request.client.host, "scheme": request.url.scheme,
                "url": str(request.url_for("reflect"))}

    return app


def test_disabled_proxy_never_reads_allowlist(monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "false")
    monkeypatch.delenv("FORWARDED_ALLOW_IPS", raising=False)
    assert config.validate_proxy() == []
    monkeypatch.setenv("FORWARDED_ALLOW_IPS", "invalid-unused-value")
    assert config.validate_proxy() == []
    command = entrypoint.api_command()
    assert "--no-proxy-headers" in command
    assert "--proxy-headers" not in command
    assert "--forwarded-allow-ips" not in command


@pytest.mark.parametrize("value,expected", [
    ("192.0.2.7", "192.0.2.7"),
    ("192.0.2.7/24", "192.0.2.0/24"),
    ("2001:db8::1234/64", "2001:db8::/64"),
    (" 192.0.2.7,192.0.2.7,2001:0db8::1 ", "192.0.2.7,2001:db8::1"),
])
def test_trusted_values_are_canonical_for_uvicorn(monkeypatch, value, expected):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "true")
    monkeypatch.setenv("FORWARDED_ALLOW_IPS", value)
    command = entrypoint.api_command()
    assert command[command.index("--forwarded-allow-ips") + 1] == expected
    assert "--proxy-headers" in command
    assert not _TrustedHosts(expected).trusted_literals


@pytest.mark.parametrize("value", [None, "", "*", "0.0.0.0/0", "192.0.2.7/0", "::/0", "2001:db8::1/0",
                                       "proxy.invalid", "192.0.2.1:8000", "192.0.2.1,", "fe80::1%eth0"])
def test_trust_rejects_missing_or_unsupported_values(monkeypatch, value):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "true")
    if value is None:
        monkeypatch.delenv("FORWARDED_ALLOW_IPS", raising=False)
    else:
        monkeypatch.setenv("FORWARDED_ALLOW_IPS", value)
    with pytest.raises(RuntimeError, match="FORWARDED_ALLOW_IPS"):
        entrypoint.api_command()


def test_proxy_mode_boolean_is_strict(monkeypatch):
    monkeypatch.delenv("TRUST_PROXY_HEADERS", raising=False)
    assert config.trust_proxy_headers() is False
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "yes")
    with pytest.raises(RuntimeError, match="TRUST_PROXY_HEADERS"):
        entrypoint.api_command()


def test_untrusted_headers_cannot_change_client_scheme_or_url(monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "false")
    with TestClient(uvicorn_app(reflect_app()), client=("192.0.2.7", 123)) as browser:
        baseline = browser.get("/inspect").json()
        forged = browser.get("/inspect", headers={"X-Forwarded-For": "203.0.113.5",
                             "X-Forwarded-Proto": "https", "X-Forwarded-Host": "attacker.invalid"}).json()
        assert forged == baseline
        assert forged["client"] == "192.0.2.7" and forged["scheme"] == "http"


def test_canonical_trusted_cidr_is_actually_used(monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "true")
    monkeypatch.setenv("FORWARDED_ALLOW_IPS", "192.0.2.7/24")
    with TestClient(uvicorn_app(reflect_app()), client=("192.0.2.8", 123)) as browser:
        result = browser.get("/inspect", headers={"X-Forwarded-For": "203.0.113.5", "X-Forwarded-Proto": "https"}).json()
        assert result["client"] == "203.0.113.5" and result["scheme"] == "https"


def test_production_disabled_proxy_starts_without_allowlist(production_settings, monkeypatch, caplog):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "false")
    monkeypatch.setenv("PUBLIC_API_ORIGIN", "https://study.example.com")
    monkeypatch.delenv("FORWARDED_ALLOW_IPS")
    from backend.app.db import Database
    monkeypatch.setattr(Database, "check_ready", lambda self: None)
    monkeypatch.setattr(config.os.path, "ismount", lambda path: True)
    with TestClient(uvicorn_app(create_app())) as browser:
        assert browser.get("/api/ready").status_code == 200
        assert browser.get("/api/ready").status_code == 200
    warnings = [r for r in caplog.records if "Proxy headers are disabled" in r.getMessage()]
    assert len(warnings) == 1
    assert "private" not in warnings[0].getMessage()


def test_production_disabled_proxy_requires_explicit_public_origin(production_settings, monkeypatch):
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "false")
    monkeypatch.delenv("PUBLIC_API_ORIGIN", raising=False)
    from backend.app.db import Database
    with pytest.raises(RuntimeError, match="PUBLIC_API_ORIGIN"):
        config.validate_runtime(Database.from_env())


@pytest.mark.parametrize("origin", ["http://study.example.com", "https://study.example.com/api", "https://u:p@study.example.com",
                                          "https://study.example.com,https://other.example.com", "https://study.example.com:bad"])
def test_production_public_origin_must_be_one_https_origin(production_settings, monkeypatch, origin):
    monkeypatch.setenv("PUBLIC_API_ORIGIN", origin)
    with pytest.raises(RuntimeError, match="PUBLIC_API_ORIGIN"):
        config.public_api_origin()


def test_shared_peer_email_and_global_limits(database, monkeypatch):
    service = AuthService(database)
    request = Request({"type": "http", "client": ("192.0.2.1", 123), "headers": []})
    # Login identity remains limited even across changing ingress peers.
    for n in range(10):
        service.rate_limit(Request({"type": "http", "client": (f"192.0.2.{n+1}", 123), "headers": []}), "one@example.com", "login")
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as blocked:
        service.rate_limit(request, "ONE@EXAMPLE.COM", "login")
    assert blocked.value.status_code == 429
    # A site-wide bound applies even when both peer and email change.
    monkeypatch.setenv("AUTH_REGISTER_GLOBAL_LIMIT", "2")
    for n in range(2):
        service.rate_limit(request, f"learner{n}@example.com", "register")
    with pytest.raises(HTTPException) as blocked:
        service.rate_limit(Request({"type": "http", "client": ("198.51.100.1", 123), "headers": []}), "third@example.com", "register")
    assert blocked.value.status_code == 429 and int(blocked.value.headers["Retry-After"]) > 0


@pytest.mark.parametrize("action,setting", [("login", "AUTH_LOGIN_GLOBAL_LIMIT"), ("register", "AUTH_REGISTER_GLOBAL_LIMIT")])
def test_global_limits_apply_across_peers_and_identities(database, monkeypatch, action, setting):
    monkeypatch.setenv(setting, "2")
    service = AuthService(database)
    for n in range(2):
        request = Request({"type": "http", "client": (f"192.0.2.{n+1}", 123), "headers": []})
        service.rate_limit(request, f"learner{n}@example.com", action)
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as blocked:
        service.rate_limit(Request({"type": "http", "client": ("198.51.100.1", 123), "headers": []}), "third@example.com", action)
    assert blocked.value.status_code == 429


def test_register_email_limit_applies_across_peers(database):
    service = AuthService(database)
    for n in range(3):
        service.rate_limit(Request({"type": "http", "client": (f"192.0.2.{n+1}", 123), "headers": []}), "learner@example.com", "register")
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as blocked:
        service.rate_limit(Request({"type": "http", "client": ("198.51.100.1", 123), "headers": []}), "LEARNER@EXAMPLE.COM", "register")
    assert blocked.value.status_code == 429


@pytest.mark.parametrize("action,limit", [("register", 20), ("login", 100)])
def test_existing_limits_remain_shared_per_ingress(database, action, limit):
    service = AuthService(database)
    request = Request({"type": "http", "client": ("192.0.2.1", 123), "headers": []})
    for n in range(limit):
        service.rate_limit(request, f"learner{n}@example.com", action)
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as blocked:
        service.rate_limit(request, "another@example.com", action)
    assert blocked.value.status_code == 429


def test_forged_ips_do_not_evade_auth_limiter(database, monkeypatch):
    app = create_app(database.path)
    # Hashing is irrelevant to this limiter test; avoid 100 expensive Argon2 calls.
    monkeypatch.setattr(app.state.auth.passwords, "verify", lambda *args: False)
    with TestClient(uvicorn_app(app), client=("192.0.2.1", 123)) as browser:
        for n in range(100):
            response = browser.post("/api/auth/login", json={"email": f"learner{n}@example.com", "password": "incorrect"},
                                    headers={"X-Forwarded-For": f"203.0.113.{n+1}"})
            assert response.status_code == 401
        assert browser.post("/api/auth/login", json={"email": "another@example.com", "password": "incorrect"}).status_code == 429
    key = hashlib.sha256(b"login-ip:192.0.2.1").hexdigest()
    with database.connect() as conn:
        assert database.execute(conn, "SELECT attempts FROM auth_rate_limits WHERE id=?", (key,)).fetchone()["attempts"] == 100


def test_https_rewrite_simulation_keeps_auth_cookies_csrf_and_redirects(database, tmp_path, monkeypatch):
    """Simulate the configured /api rewrite, HTTPS browser -> HTTP origin."""
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "false")
    monkeypatch.setenv("PUBLIC_API_ORIGIN", "https://study.example.com")
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "true")
    monkeypatch.setenv("AUTH_ALLOWED_ORIGINS", "https://study.example.com")
    # Match backend/Dockerfile: frontend assets are hosted on Vercel, not this image.
    app = create_app(database.path, frontend_dist=tmp_path / "no-frontend-build")
    inspection = reflect_app()
    # Exercise request.url_for under the same public-origin middleware as API routes.
    from backend.app.proxy import PublicOriginMiddleware
    with TestClient(uvicorn_app(PublicOriginMiddleware(inspection, "https://study.example.com"))) as inspector:
        assert inspector.get("/inspect", headers={"Host": "attacker.invalid", "X-Forwarded-Proto": "http"}).json()["url"] == "https://study.example.com/inspect"
        redirected = inspector.get("/inspect/", follow_redirects=False)
        assert redirected.status_code == 307 and redirected.headers["location"] == "https://study.example.com/inspect"
    with TestClient(uvicorn_app(app), base_url="http://origin.internal", client=("192.0.2.1", 123)) as origin:
        proxy = FastAPI()

        @proxy.api_route("/api/{path:path}", methods=["GET", "POST"])
        async def rewrite(path: str, request: Request):
            headers = dict(request.headers)
            headers.update({"host": "origin.internal", "x-forwarded-for": "203.0.113.100", "x-forwarded-proto": "http"})
            upstream = origin.request(request.method, request.url.path, content=await request.body(),
                                      headers=headers, follow_redirects=False)
            response = Response(upstream.content, status_code=upstream.status_code)
            response.raw_headers = list(upstream.headers.raw)
            return response

        with TestClient(proxy, base_url="https://study.example.com") as browser:
            response = browser.post("/api/auth/register", json={"email": "rewrite@example.com", "password": "Long password 123", "display_name": "Rewrite"}, headers={"Origin": "https://study.example.com"})
            assert response.status_code == 201
            cookies = response.headers.get_list("set-cookie")
            assert all("Secure" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie for cookie in cookies)
            assert browser.get("/api/auth/me").status_code == 200
            redirect = browser.get("/api/auth/me/", follow_redirects=False)
            assert redirect.status_code == 307 and redirect.headers["location"] == "https://study.example.com/api/auth/me"
            assert browser.get("/api/auth/me/").status_code == 200
            assert browser.post("/api/auth/refresh").status_code == 403
            browser.headers["X-CSRF-Token"] = response.json()["csrf_token"]
            assert browser.post("/api/auth/refresh", headers={"Origin": "https://attacker.invalid"}).status_code == 403
            assert browser.post("/api/auth/refresh", headers={"Origin": "https://study.example.com"}).status_code == 200
            assert browser.post("/api/auth/logout").status_code == 200
            assert browser.get("/api/auth/me").status_code == 401
