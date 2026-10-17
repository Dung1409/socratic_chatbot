import time
from concurrent.futures import ThreadPoolExecutor

import jwt
import pytest
from fastapi.testclient import TestClient

from backend.app.auth import ACCESS_COOKIE, REFRESH_COOKIE, AUDIENCE, ISSUER
from backend.app.db import Database
from backend.app.main import create_app

PASSWORD = "Long password with spaces 123"


@pytest.fixture
def app(database, tmp_path):
    return create_app(database.path, storage_path=tmp_path / "uploads")


@pytest.fixture
def browser(app):
    with TestClient(app) as client:
        yield client


def register(client, email="student@example.com", name="Minh An", password=PASSWORD):
    return client.post("/api/auth/register", json={"email": email, "password": password, "display_name": name})


def csrf(client, response):
    client.headers["X-CSRF-Token"] = response.json()["csrf_token"]


def token_cookie(client, name, value):
    client.cookies.set(name, value, domain="testserver.local", path="/api" if name == ACCESS_COOKIE else "/api/auth")


def test_register_hashes_password_and_only_sends_tokens_in_httponly_cookies(browser, database):
    response = register(browser, email="Student@Example.COM", password="  meaningful spaces 123  ")
    assert response.status_code == 201
    assert set(response.json()) == {"user", "csrf_token"}
    assert response.json()["user"]["email"] == "student@example.com"
    assert "password" not in response.text and "access_token" not in response.json()
    cookies = response.headers.get_list("set-cookie")
    assert len(cookies) == 2
    assert all("HttpOnly" in cookie and "SameSite=lax" in cookie for cookie in cookies)
    assert any("Path=/api/auth" in cookie for cookie in cookies)
    assert "no-store" in response.headers["cache-control"]
    with database.connect() as conn:
        user = database.execute(conn, "SELECT password_hash FROM users WHERE email=?", ("student@example.com",)).fetchone()
    assert user["password_hash"].startswith("$argon2id$")
    assert browser.app.state.auth.passwords.verify("  meaningful spaces 123  ", user["password_hash"])
    assert browser.get("/api/auth/me").json()["user"]["id"] == response.json()["user"]["id"]


def test_duplicate_email_is_case_insensitive(browser):
    assert register(browser).status_code == 201
    assert register(browser, email="STUDENT@EXAMPLE.COM").status_code == 409


def test_registration_accepts_eight_characters_but_rejects_seven(browser):
    assert register(browser, password="Abc123!").status_code == 422
    response = register(browser, password="Abc123!x")
    assert response.status_code == 201
    csrf(browser, response)
    assert browser.post("/api/auth/logout").status_code == 200
    assert browser.post("/api/auth/login", json={
        "email": "student@example.com", "password": "Abc123!x",
    }).status_code == 200


@pytest.mark.parametrize("payload", [
    {"email": "not-email", "display_name": "An", "password": PASSWORD},
    {"email": "student@example.com", "display_name": "An", "password": "short"},
    {"email": "student@example.com", "display_name": "   ", "password": PASSWORD},
    {"email": "student@example.com", "display_name": "An", "password": PASSWORD, "role": "teacher"},
])
def test_invalid_registration(browser, payload):
    assert browser.post("/api/auth/register", json=payload).status_code == 422


def test_login_has_generic_error_and_logout_revokes_copied_access_token(browser):
    registration = register(browser)
    csrf(browser, registration)
    copied_access = browser.cookies.get(ACCESS_COOKIE)
    assert browser.post("/api/auth/logout").status_code == 200
    assert browser.get("/api/auth/me").status_code == 401
    token_cookie(browser, ACCESS_COOKIE, copied_access)
    assert browser.get("/api/assignments").status_code == 401
    browser.cookies.clear()
    wrong = browser.post("/api/auth/login", json={"email": "student@example.com", "password": "incorrect"})
    missing = browser.post("/api/auth/login", json={"email": "missing@example.com", "password": "incorrect"})
    assert wrong.status_code == missing.status_code == 401
    assert wrong.json() == missing.json()
    login = browser.post("/api/auth/login", json={"email": "STUDENT@example.com", "password": PASSWORD})
    assert login.status_code == 200
    assert browser.get("/api/auth/me").status_code == 200


@pytest.mark.parametrize("path", ["/api/assignments", "/api/sessions", "/api/dashboard", "/api/progress", "/api/documents/missing"])
def test_learning_data_requires_authentication(browser, path):
    assert browser.get(path).status_code == 401
    assert browser.get("/api/health").status_code == 200
    assert browser.get("/api/ready").status_code == 200


def test_csrf_and_origin_checks(browser):
    registration = register(browser)
    body = {"title": "Đề của học sinh", "prompt": "Nội dung đề bài cần luyện tập và phân tích."}
    assert browser.post("/api/assignments", json=body).status_code == 403
    browser.headers["X-CSRF-Token"] = "wrong"
    assert browser.post("/api/assignments", json=body).status_code == 403
    csrf(browser, registration)
    assert browser.post("/api/assignments", json=body, headers={"Origin": "https://attacker.example"}).status_code == 403
    assert browser.post("/api/assignments", json=body, headers={"Origin": "http://testserver"}).status_code == 201
    assert browser.post("/api/auth/login", json={"email": "student@example.com", "password": PASSWORD},
                        headers={"Origin": "https://attacker.example"}).status_code == 403
    browser.headers.pop("X-CSRF-Token")
    assert browser.post("/api/auth/logout").status_code == 403
    assert browser.post("/api/auth/refresh").status_code == 403


def test_refresh_rotates_token_and_replay_revokes_session(browser):
    registration = register(browser)
    csrf(browser, registration)
    old_refresh = browser.cookies.get(REFRESH_COOKIE)
    old_access = browser.cookies.get(ACCESS_COOKIE)
    assert browser.post("/api/auth/refresh").status_code == 200
    assert browser.cookies.get(REFRESH_COOKIE) != old_refresh
    token_cookie(browser, REFRESH_COOKIE, old_refresh)
    assert browser.post("/api/auth/refresh").status_code == 401
    token_cookie(browser, ACCESS_COOKIE, old_access)
    assert browser.get("/api/auth/me").status_code == 401


def test_expired_access_can_be_refreshed_and_wrong_token_type_is_rejected(browser):
    registration = register(browser)
    csrf(browser, registration)
    access = browser.cookies.get(ACCESS_COOKIE)
    auth = browser.app.state.auth
    claims = jwt.decode(access, auth.secret, algorithms=["HS256"], audience=AUDIENCE, issuer=ISSUER)
    claims["exp"] = int(time.time()) - 1
    token_cookie(browser, ACCESS_COOKIE, jwt.encode(claims, auth.secret, algorithm="HS256"))
    assert browser.get("/api/auth/me").status_code == 401
    assert browser.get("/api/auth/csrf").json()["csrf_token"] == registration.json()["csrf_token"]
    assert browser.post("/api/auth/refresh").status_code == 200
    assert browser.get("/api/auth/me").status_code == 200
    token_cookie(browser, ACCESS_COOKIE, browser.cookies.get(REFRESH_COOKIE))
    assert browser.get("/api/auth/me").status_code == 401


def test_tampered_token_and_expired_database_session(browser, database):
    response = register(browser)
    original = browser.cookies.get(ACCESS_COOKIE)
    header, payload, signature = original.split(".")
    token_cookie(browser, ACCESS_COOKIE, f"{header}.{payload}.{('A' if signature[0] != 'A' else 'B') + signature[1:]}")
    assert browser.get("/api/assignments").status_code == 401
    token_cookie(browser, ACCESS_COOKIE, original)
    with database.connect(write=True) as conn:
        database.execute(conn, "UPDATE auth_sessions SET expires_at=0 WHERE user_id=?", (response.json()["user"]["id"],))
    assert browser.get("/api/assignments").status_code == 401


def test_accounts_cannot_read_or_mutate_each_others_data(app, authorize):
    with TestClient(app) as first, TestClient(app) as second:
        authorize(first, "first@example.com")
        authorize(second, "second@example.com")
        created = first.post("/api/assignments", json={"title": "Đề riêng của bạn thứ nhất", "prompt": "Nội dung đề cần lập luận và đưa ra dẫn chứng."}).json()
        session = first.post("/api/sessions", json={"assignment_id": created["id"]}).json()
        document = first.post("/api/documents", files={"file": ("private.txt", "Nội dung riêng tư đủ dài để trích xuất.".encode(), "text/plain")}).json()
        assert second.get("/api/assignments").json() == []
        assert second.get("/api/sessions").json() == []
        assert second.get("/api/dashboard").json()["answers"] == 0
        assert second.get("/api/progress").json()["sessions"] == []
        assert second.get(f"/api/sessions/{session['id']}").status_code == 404
        assert second.post("/api/sessions", json={"assignment_id": created["id"]}).status_code == 404
        assert second.get(f"/api/documents/{document['document_id']}").status_code == 404
        assert second.post("/api/assignments", json={"title": "Lấy tệp của tài khoản khác", "prompt": "Nội dung đề bài cần luyện tập và phân tích.", "document_id": document["document_id"]}).status_code == 404
        for endpoint, extra in [("messages", {"text": "Ghi đè"}), ("hints", {}), ("submit", {"essay": "Bài viết không thuộc tài khoản này."})]:
            assert second.post(f"/api/sessions/{session['id']}/{endpoint}", json={
                "client_message_id": "attack", "expected_version": 0, **extra,
            }).status_code == 404
        assert first.get(f"/api/sessions/{session['id']}").json()["version"] == 0


def test_unowned_legacy_data_is_not_assigned_to_first_registered_user(browser, database):
    with database.connect(write=True) as conn:
        Database.put(conn, "assignments", "legacy", {"id": "legacy", "title": "Đề cũ", "source": "student"})
    register(browser)
    assert browser.get("/api/assignments").json() == []
    with database.connect() as conn:
        assert Database.get(conn, "assignments", "legacy") is not None


def test_login_rate_limit_is_persisted(browser):
    for _ in range(10):
        assert browser.post("/api/auth/login", json={"email": "missing@example.com", "password": "incorrect"}).status_code == 401
    limited = browser.post("/api/auth/login", json={"email": "missing@example.com", "password": "incorrect"})
    assert limited.status_code == 429
    assert int(limited.headers["retry-after"]) > 0


def test_secure_cookie_configuration(database, monkeypatch):
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "true")
    with TestClient(create_app(database.path), base_url="https://testserver") as client:
        response = register(client)
        assert response.status_code == 201
        assert all("Secure" in cookie for cookie in response.headers.get_list("set-cookie"))
        assert client.get("/api/auth/me").status_code == 200


def test_api_refuses_to_start_without_a_private_signing_key(database, monkeypatch):
    monkeypatch.delenv("JWT_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        with TestClient(create_app(database.path)):
            pass
