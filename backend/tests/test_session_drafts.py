from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app


@pytest.fixture
def client(database, authorize):
    with TestClient(create_app(database.path)) as client:
        authorize(client)
        yield client


def start(client):
    assignment = client.post("/api/learning/quick-start", json={
        "prompt": "Hãy giải thích vai trò của việc đọc sách trong cuộc sống.", "materials": "",
    }).json()
    return client.post("/api/sessions", json={"assignment_id": assignment["id"]}).json()


def save(client, session, revision=0, **fields):
    return client.put(f"/api/sessions/{session['id']}/draft", json={
        "answer": "  Bản nháp\nchưa gửi  ", "essay": "Bài tổng hợp đang viết",
        "revision": revision, "expected_version": session["version"], **fields,
    })


def test_draft_persists_without_changing_conversation_or_counting_support(client, database, authorize):
    session = start(client)
    response = save(client, session)
    assert response.status_code == 200
    assert response.json()["answer"] == "  Bản nháp\nchưa gửi  "
    assert client.get(f"/api/sessions/{session['id']}").json() == session
    with TestClient(create_app(database.path)) as restarted:
        authorize(restarted)
        draft = restarted.get(f"/api/sessions/{session['id']}/draft").json()
        assert draft["essay"] == "Bài tổng hợp đang viết"
        assert draft["revision"] == 1


def test_draft_revision_prevents_cross_tab_overwrite_and_session_version_prevents_late_writes(client):
    session = start(client)
    assert save(client, session).status_code == 200
    assert save(client, session, answer="Bản ghi đè cũ").status_code == 409
    hinted = client.post(f"/api/sessions/{session['id']}/hints", json={
        "expected_version": session["version"], "client_message_id": str(uuid4()),
    }).json()
    assert save(client, session, revision=1).status_code == 409
    assert client.get(f"/api/sessions/{session['id']}/draft").json()["answer"].startswith("  Bản nháp")
    assert save(client, hinted, revision=1).status_code == 200


def test_sent_answer_does_not_reappear_as_draft_and_submitted_essay_is_not_a_draft(client):
    session = start(client)
    assert save(client, session).status_code == 200
    while not session["done"]:
        session = client.post(f"/api/sessions/{session['id']}/messages", json={
            "expected_version": session["version"], "client_message_id": str(uuid4()),
            "text": "Em chọn một dẫn chứng và giải thích ý nghĩa của chi tiết này.",
        }).json()
    draft = client.get(f"/api/sessions/{session['id']}/draft").json()
    assert draft["answer"] == ""
    assert draft["essay"] == "Bài tổng hợp đang viết"
    session = client.post(f"/api/sessions/{session['id']}/submit", json={
        "expected_version": session["version"], "client_message_id": str(uuid4()),
        "essay": "Bài viết có luận điểm, dẫn chứng và giải thích do học sinh tự tổng hợp.",
    }).json()
    draft = client.get(f"/api/sessions/{session['id']}/draft").json()
    assert draft["answer"] == draft["essay"] == ""
    assert save(client, session, revision=draft["revision"]).status_code == 409


def test_drafts_are_owner_scoped_and_validated(client, database, authorize):
    session = start(client)
    assert save(client, session, answer="x" * 10001).status_code == 422
    assert save(client, session, essay="x" * 50001).status_code == 422
    with TestClient(create_app(database.path)) as other:
        authorize(other, email="another@example.com")
        assert other.get(f"/api/sessions/{session['id']}/draft").status_code == 404
        assert save(other, session).status_code == 404
    assert client.get(f"/api/sessions/{session['id']}/draft").json()["revision"] == 0


def test_saved_task_is_listed_before_start_and_second_item_does_not_start_first(client):
    assignment = client.post("/api/learning/assignments", json={
        "title": "Đề hai câu chưa học", "items": [
            {"label": "Câu 1", "prompt": "Giải thích ý nghĩa của việc đọc sách."},
            {"label": "Câu 2", "prompt": "Nêu một góc nhìn khác về việc đọc sách."},
        ],
    }).json()
    listed = client.get("/api/assignments").json()
    assert listed[0]["id"] == assignment["id"]
    assert listed[0]["status"] == "Chưa bắt đầu"
    assert len(listed[0]["items"]) == 2
    assert client.get("/api/sessions").json() == []
    response = client.post("/api/sessions", json={
        "assignment_id": assignment["id"], "item_id": assignment["items"][1]["id"],
    })
    assert response.status_code == 200
    assert response.json()["assignment"]["active_item_id"] == assignment["items"][1]["id"]
    assert len(client.get("/api/sessions").json()) == 1
    assert len(client.get("/api/assignments").json()) == 1
    assert client.post("/api/sessions", json={
        "assignment_id": assignment["id"], "item_id": "missing",
    }).status_code == 404
