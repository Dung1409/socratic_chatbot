import io
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.app.db import Database
from backend.app.main import create_app


@pytest.fixture
def client(database):
    with TestClient(create_app(database.path)) as c:
        yield c


def assignment(client, title="Đề tự học đọc sách", target=6):
    result = client.post("/api/assignments", json={
        "title": title, "prompt": "Hãy trình bày quan điểm về ý nghĩa của việc đọc sách và đưa ra dẫn chứng.",
        "target": target,
    })
    assert result.status_code == 201, result.text
    return result.json()


def start(client, assignment_id=None):
    assignment_id = assignment_id or assignment(client)["id"]
    result = client.post("/api/sessions", json={"assignment_id": assignment_id})
    assert result.status_code == 200, result.text
    return result.json()


def action(client, session, endpoint, **payload):
    return client.post(f"/api/sessions/{session['id']}/{endpoint}", json={
        "client_message_id": str(uuid4()), "expected_version": session["version"], **payload,
    })


def complete(client, session):
    while not session["done"]:
        result = action(client, session, "messages", text="Em cần tìm dẫn chứng trong văn bản để giải thích ý kiến của mình.")
        assert result.status_code == 200, result.text
        session = result.json()
    result = action(client, session, "submit", essay="Bài viết tự học với luận điểm, dẫn chứng và phần giải thích mối liên hệ giữa chúng.")
    assert result.status_code == 200, result.text
    return result.json()


def test_full_self_study_flow_without_seed_or_teacher(client):
    assert client.get("/api/health").json()["tutor_mode"] == "template"
    assert client.get("/api/assignments").json() == []
    assert client.get("/api/sessions").json() == []
    assert client.get("/api/progress").json()["sessions"] == []
    session = start(client)
    assert "requests" not in session and "rubric" not in session and "review" not in session
    assert "student_name" not in session and "class_name" not in session
    assert session["assignment"]["source"] == "student"
    assert start(client, session["assignment_id"])["id"] == session["id"]
    hinted = action(client, session, "hints")
    assert hinted.status_code == 200
    session = complete(client, hinted.json())
    dashboard = client.get("/api/dashboard").json()
    assert dashboard["submitted"] == 1 and dashboard["answers"] == 6
    assert "pending" not in dashboard and "latest_review" not in dashboard
    progress = client.get("/api/progress").json()
    assert progress["sessions"][0]["essay"] == session["essay"]
    assert sum(point["value"] for point in progress["bloom_profile"]) == 6
    assert client.get("/api/assignments").json()[0]["status"] == "Đã hoàn thành"
    assert all(turn["quality"] is None for turn in session["turns"] if turn["kind"] == "student")


def test_teacher_endpoints_are_removed(client):
    paths = client.get("/openapi.json").json()["paths"]
    assert not any("teacher" in path or "rubric" in path or "reviews" in path for path in paths)
    assert client.get("/api/teacher/overview").status_code == 404
    assert client.get("/api/rubric").status_code == 404
    assert client.put("/api/rubric", json={"criteria": []}).status_code in {404, 405}
    assert client.post("/api/sessions/missing/reviews", json={}).status_code in {404, 405}


def test_idempotency_stale_versions_and_hint_limits(client):
    session = start(client)
    body = {"expected_version": 0, "client_message_id": "retry-me"}
    path = f"/api/sessions/{session['id']}/hints"
    first = client.post(path, json=body)
    repeated = client.post(path, json=body)
    assert first.json() == repeated.json()
    assert repeated.json()["hint_tier"] == 1
    assert action(client, session, "hints").status_code == 409
    assert client.post(f"/api/sessions/{session['id']}/messages", json={**body, "text": "Khác nội dung"}).status_code == 409
    session = first.json()
    for _ in range(2):
        session = action(client, session, "hints").json()
    assert action(client, session, "hints").status_code == 409
    assert client.get(path.removesuffix("/hints")).json()["hint_tier"] == 3


def test_concurrent_messages_do_not_overwrite_turns(client):
    session = start(client)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: action(client, session, "messages", text="Em chọn một chi tiết để giải thích."), range(2)))
    assert sorted(response.status_code for response in results) == [200, 409]
    saved = client.get(f"/api/sessions/{session['id']}").json()
    assert len([turn for turn in saved["turns"] if turn["kind"] == "student"]) == 1


def test_persistence_across_restart(tmp_path):
    path = str(tmp_path / "persistent.db")
    with TestClient(create_app(path)) as first:
        session = start(first)
        session = action(first, session, "messages", text="Em đang tìm hiểu yêu cầu đề bài.").json()
    with TestClient(create_app(path)) as second:
        assert second.get(f"/api/sessions/{session['id']}").json() == session
        assert len(second.get("/api/assignments").json()) == 1
        assert start(second, session["assignment_id"])["id"] == session["id"]


def test_selected_assignment_and_bloom_target(client):
    first = assignment(client, "Trách nhiệm với cộng đồng", 3)
    second = assignment(client, "Ý nghĩa của lòng biết ơn", 5)
    session = start(client, first["id"])
    assert session["assignment"]["title"] == first["title"]
    assert len(session["steps"]) == 3
    assert len(start(client, second["id"])["steps"]) == 5


def test_validation_and_state_transitions(client):
    assert client.post("/api/assignments", json={"title": "X", "prompt": "Y"}).status_code == 422
    assert client.post("/api/assignments", json={"title": "Đề bài hợp lệ", "prompt": "Nội dung yêu cầu đủ dài.", "target": 7}).status_code == 422
    assert client.post("/api/assignments", json={"title": "Đề bài hợp lệ", "prompt": "Nội dung yêu cầu đủ dài.", "source": "teacher"}).status_code == 422
    assert client.get("/api/sessions/missing").status_code == 404
    assert client.post("/api/sessions", json={"assignment_id": "vo-nhat"}).status_code == 404
    session = start(client)
    assert action(client, session, "messages", text="   ").status_code == 422
    assert action(client, session, "submit", essay="Bài viết có đủ độ dài nhưng chưa hoàn tất câu hỏi.").status_code == 409
    completed = complete(client, session)
    assert action(client, completed, "messages", text="Muốn sửa lịch sử").status_code == 409
    assert action(client, completed, "hints").status_code == 409


def test_upgrade_hides_old_seed_preserves_personal_work(client, database):
    personal = assignment(client)
    session = start(client, personal["id"])
    with database.connect(write=True) as conn:
        Database.put(conn, "assignments", "vo-nhat", {"id": "vo-nhat", "title": "Đề mẫu cũ", "target": 4})
        database.execute(conn, "DELETE FROM schema_migrations WHERE version=?", ("002_self_study",))
    database.initialize()
    database.initialize()
    assert [item["id"] for item in client.get("/api/assignments").json()] == [personal["id"]]
    assert client.get(f"/api/sessions/{session['id']}").json()["id"] == session["id"]
    assert client.post("/api/sessions", json={"assignment_id": "vo-nhat"}).status_code == 404
    with database.connect() as conn:
        assert Database.get(conn, "assignments", "vo-nhat")["source"] == "legacy_seed"


def test_upload_extraction_requires_confirmation(client):
    result = client.post("/api/uploads/extract", files={"file": ("de-bai.txt", "Hãy phân tích vai trò của dẫn chứng trong bài nghị luận.".encode("utf-8"), "text/plain")})
    assert result.status_code == 200
    assert result.json()["needs_confirmation"] is True
    assert "dẫn chứng" in result.json()["text"]
    assert client.get("/api/assignments").json() == []
    assert client.post("/api/uploads/extract", files={"file": ("scan.png", b"image", "image/png")}).status_code == 415
    assert client.post("/api/uploads/extract", files={"file": ("broken.pdf", b"not pdf", "application/pdf")}).status_code == 422
    assert client.post("/api/uploads/extract", files={"file": ("large.txt", b"x" * (10 * 1024 * 1024 + 1), "text/plain")}).status_code == 413


def test_docx_extraction(client):
    from docx import Document
    doc = Document()
    doc.add_paragraph("Đề bài: Phân tích một vấn đề nghị luận xã hội.")
    table = doc.add_table(rows=1, cols=1)
    table.cell(0, 0).text = "Yêu cầu có dẫn chứng cụ thể."
    stream = io.BytesIO()
    doc.save(stream)
    response = client.post("/api/uploads/extract", files={"file": ("de-bai.docx", stream.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")})
    assert response.status_code == 200
    assert "dẫn chứng" in response.json()["text"]


def test_static_frontend_and_unknown_api(tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>SocraVan</html>")
    (dist / "app.js").write_text("console.log('hello')")
    with TestClient(create_app(str(tmp_path / "test.db"), frontend_dist=dist)) as c:
        assert "SocraVan" in c.get("/phien-hoc").text
        assert c.get("/app.js").status_code == 200
        assert c.get("/api/nonexistent").status_code == 404
        assert c.get("/assets/missing.js").status_code == 404
