from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi.testclient import TestClient

from backend.app.ai_tutor import OpenAITutor, TutorError
from backend.app.main import create_app
from backend.tests.fake_tutor import FakeTutor, reply
from backend.tests.test_api import assignment, start, action


@pytest.fixture
def tutor():
    return FakeTutor()


@pytest.fixture
def client(database, authorize, monkeypatch, tutor):
    monkeypatch.setenv("TUTOR_MODE", "openai")
    with TestClient(create_app(database.path, tutor_engine=tutor)) as client:
        authorize(client)
        yield client


def answer(client, session):
    response = action(client, session, "messages", text="Em cho rằng nhận định cần được kiểm tra bằng dẫn chứng và phản ví dụ.")
    assert response.status_code == 200, response.text
    return response.json()


def test_each_selected_question_has_its_own_opening_and_history(client, tutor):
    original_plan = tutor.plan

    def plan_for_item(assignment):
        plan = original_plan(assignment)
        plan.opening.text = f"Gợi mở: {assignment['prompt']}"
        return plan

    tutor.plan = plan_for_item
    created = client.post("/api/learning/assignments", json={
        "title": "Đề kiểm tra nhiều câu",
        "items": [
            {"item_type": "reading", "label": "Câu 1", "prompt": "Câu hỏi đọc hiểu đầu tiên?"},
            {"item_type": "reading", "label": "Câu 2", "prompt": "Câu hỏi đọc hiểu thứ hai?"},
        ],
    })
    assert created.status_code == 201, created.text
    assignment = created.json()
    first = start(client, assignment["id"])
    assert first["assignment"]["active_item_id"] == assignment["items"][0]["id"]
    assert first["turns"][0]["text"] == "Gợi mở: Câu hỏi đọc hiểu đầu tiên?"

    second_response = client.post(f"/api/sessions/{first['id']}/select-item", json={
        "item_id": assignment["items"][1]["id"],
    })
    assert second_response.status_code == 200, second_response.text
    second = second_response.json()
    assert second["id"] != first["id"]
    assert second["assignment"]["active_item_id"] == assignment["items"][1]["id"]
    assert second["turns"][0]["text"] == "Gợi mở: Câu hỏi đọc hiểu thứ hai?"
    assert second["assignment"]["items"] == first["assignment"]["items"]

    returned = client.post(f"/api/sessions/{second['id']}/select-item", json={
        "item_id": assignment["items"][0]["id"],
    })
    assert returned.status_code == 200, returned.text
    assert returned.json()["id"] == first["id"]
    assert returned.json()["turns"][0]["text"] == first["turns"][0]["text"]


def test_prepare_repairs_unanswered_session_with_previous_question_opening(client, tutor, database):
    original_plan = tutor.plan

    def plan_for_item(assignment):
        plan = original_plan(assignment)
        plan.opening.text = f"Gợi mở: {assignment['prompt']}"
        return plan

    tutor.plan = plan_for_item
    created = client.post("/api/learning/assignments", json={
        "title": "Đề đọc hiểu và văn học",
        "items": [
            {"item_type": "reading", "label": "Câu 1", "prompt": "Tìm bằng chứng trong đoạn văn?"},
            {"item_type": "literary", "label": "Câu 2", "prompt": "Phân tích hình tượng trong bài thơ?"},
        ],
    }).json()
    first = start(client, created["id"])
    second = client.post(f"/api/sessions/{first['id']}/select-item", json={
        "item_id": created["items"][1]["id"],
    }).json()
    with database.connect(write=True) as conn:
        stale = database.get(conn, "sessions", second["id"], owner_id=client.user_id)
        stale.pop("opening_item_id")
        stale["turns"] = first["turns"]
        stale["plan"] = first["plan"]
        database.put(conn, "sessions", second["id"], stale, owner_id=client.user_id)

    result = client.post(f"/api/sessions/{second['id']}/prepare")
    assert result.status_code == 200, result.text
    repaired = result.json()
    assert repaired["id"] == second["id"]
    assert repaired["assignment"]["active_item_id"] == created["items"][1]["id"]
    assert repaired["plan"]["task_type"] == "literary"
    assert repaired["turns"][0]["text"] == "Gợi mở: Phân tích hình tượng trong bài thơ?"


def test_progress_groups_questions_with_missing_results_and_source_only_document(client):
    created = client.post("/api/learning/assignments", json={
        "title": "Đề có hai câu hỏi",
        "items": [
            {"item_type": "reading", "label": "Câu 1", "prompt": "Tìm chi tiết trong văn bản?"},
            {"item_type": "reading", "label": "Câu 2", "prompt": "Nêu tác dụng của chi tiết?"},
        ],
    }).json()
    first = start(client, created["id"])
    progress = client.get("/api/progress")
    assert progress.status_code == 200, progress.text
    group = next(group for group in progress.json()["assignments"] if group["id"] == created["id"])
    assert [item["label"] for item in group["items"]] == ["Câu 1", "Câu 2"]
    assert [item["session_id"] for item in group["items"]] == [first["id"], None]

    source = client.post("/api/learning/assignments", json={
        "title": "Tài liệu không có câu hỏi",
        "items": [{"item_type": "reading", "label": "Nội dung đầu vào",
                   "prompt": "Khám phá nội dung tài liệu",
                   "metadata": {"source_only": True}}],
    }).json()
    progress = client.get("/api/progress").json()
    source_group = next(group for group in progress["assignments"] if group["id"] == source["id"])
    assert len(source_group["items"]) == 1
    assert source_group["items"][0]["source_only"] is True
    assert source_group["items"][0]["session_id"] is None


def finish_and_submit(client, session, essay="Em kết luận cần phân tích dẫn chứng và kiểm tra phản đề trước khi khẳng định."):
    if not session["done"]:
        session = action(client, session, "finish").json()
    return action(client, session, "submit", essay=essay)


def test_adaptive_full_flow_report_and_retry_idempotency(client):
    assert client.get("/api/health").json()["tutor_mode"] == "openai"
    session = start(client)
    assert not session["done"] and session["steps"] == []
    session = answer(client, session)
    assert not session["done"] and len(session["support_events"]) == 0
    body = {"expected_version": session["version"], "client_message_id": "hint-once"}
    path = f"/api/sessions/{session['id']}/hints"
    session = client.post(path, json=body).json()
    assert client.post(path, json=body).json() == session
    assert len(session["support_events"]) == 1
    session = action(client, session, "hints").json()
    session = answer(client, session)
    session = answer(client, session)
    assert session["done"]
    result = finish_and_submit(client, session)
    assert result.status_code == 200, result.text
    session = result.json()
    report = session["assessment"]
    assert (report["bloom"], report["hint_count"], report["score"]) == (90, 2, 76)
    assert report["autonomy"] == pytest.approx(.8444444444444444)
    assert report["scoring_version"] == session["scoring_version"] == "bloom-autonomy-2.0"
    assert report["classification"] == "Tư duy Khá"
    assert client.get(f"/api/sessions/{session['id']}").json() == session
    assert client.get("/api/progress").json()["sessions"][0]["assessment"] == report
    assert action(client, session, "messages", text="Thay lịch sử").status_code == 409


def test_new_scoring_applies_on_submission_but_saved_legacy_reports_are_unchanged(client, database):
    session = answer(client, start(client))
    for _ in range(2):
        session = action(client, session, "hints").json()
    session = action(client, session, "finish").json()
    with database.connect(write=True) as conn:
        saved = database.get(conn, "sessions", session["id"], owner_id=client.user_id)
        saved["scoring_version"] = "bloom-autonomy-1.0"
        database.put(conn, "sessions", session["id"], saved, owner_id=client.user_id)
    result = finish_and_submit(client, session)
    assert result.status_code == 200, result.text
    session = result.json()
    assert session["assessment"]["score"] == 76
    assert session["scoring_version"] == session["assessment"]["scoring_version"] == "bloom-autonomy-2.0"

    legacy = session["assessment"] | {
        "autonomy": .8, "score": 72, "raw_score": "72.0", "scoring_version": "bloom-autonomy-1.0",
    }
    with database.connect(write=True) as conn:
        saved = database.get(conn, "sessions", session["id"], owner_id=client.user_id)
        saved.update(assessment=legacy, scoring_version="bloom-autonomy-1.0")
        database.put(conn, "sessions", session["id"], saved, owner_id=client.user_id)
    assert client.get(f"/api/sessions/{session['id']}").json()["assessment"] == legacy
    assert client.get("/api/progress").json()["sessions"][0]["assessment"] == legacy


def test_hint_check_in_keeps_question_and_does_not_become_student_evidence(client, tutor):
    calls = []

    def support(session, action):
        calls.append(action)
        result = reply(f"Bước hỗ trợ mới {len(calls)} cho câu hỏi gốc.", "support")
        result.objective = "Mục tiêu phụ do AI tự đổi"
        return result

    tutor.reply = support
    session = start(client)
    anchor = session["turns"][0]
    for _ in range(3):
        result = action(client, session, "hints")
        assert result.status_code == 200, result.text
        session = result.json()
        assert session["current_objective"] == anchor["objective"]
        assert session["turns"][-1]["question_id"] == anchor["id"]
    assert session["support_state"]["needs_check_in"]
    assert action(client, session, "hints").status_code == 409
    assert len(calls) == 3
    reloaded = client.get(f"/api/sessions/{session['id']}").json()
    assert reloaded["support_state"] == session["support_state"]
    draft_path = f"/api/sessions/{session['id']}/draft"
    assert client.put(draft_path, json={"answer": "Ý đang viết trước khi chọn chỗ vướng", "essay": "",
        "revision": 0, "expected_version": session["version"]}).status_code == 200
    body = {"expected_version": session["version"], "client_message_id": "clarify-once", "difficulty": "ideas"}
    path = f"/api/sessions/{session['id']}/hints"
    result = client.post(path, json=body)
    assert result.status_code == 200, result.text
    session = result.json()
    assert client.post(path, json=body).json() == session
    assert len(calls) == 4 and len(session["support_events"]) == 4
    assert session["turns"][-2]["purpose"] == "clarification"
    assert client.get(draft_path).json()["answer"] == "Ý đang viết trước khi chọn chỗ vướng"
    assert session["support_state"]["difficulty"] == "ideas"
    assert session["support_state"]["consecutive_hints"] == 1
    assert not session["support_state"]["needs_check_in"]
    assert session["support_state"]["question_id"] == anchor["id"]
    assert client.get("/api/dashboard").json()["answers"] == 0
    assert action(client, session, "finish").status_code == 409
    for _ in range(2):
        session = action(client, session, "hints").json()
    assert session["support_state"]["needs_check_in"]
    session = action(client, session, "hints", difficulty="understanding").json()
    assert len(session["support_events"]) == 7
    assert session["support_state"]["question_id"] == anchor["id"]


def test_check_in_choice_survives_failure_and_retry(client, tutor):
    session = start(client)
    for _ in range(3):
        session = action(client, session, "hints").json()
    tutor.reply = lambda session, action: (_ for _ in ()).throw(TutorError("Thử lại"))
    body = {"expected_version": session["version"], "client_message_id": "failed-check-in", "difficulty": "expression"}
    path = f"/api/sessions/{session['id']}/hints"
    assert client.post(path, json=body).status_code == 502
    saved = client.get(f"/api/sessions/{session['id']}").json()
    assert saved["pending_action"]["difficulty"] == "expression"
    assert len(saved["support_events"]) == 3
    assert all(t.get("purpose") != "clarification" for t in saved["turns"])
    tutor.reply = lambda session, action: reply("Một khung diễn đạt mới bám câu hỏi gốc.", "support")
    result = client.post(path, json=body)
    assert result.status_code == 200, result.text
    assert len(result.json()["support_events"]) == 4
    assert sum(t.get("purpose") == "clarification" for t in result.json()["turns"]) == 1


def test_new_student_answer_resets_hint_check_in(client, tutor):
    session = start(client)
    for _ in range(3):
        session = action(client, session, "hints").json()
    session = answer(client, session)
    assert not session["support_state"]["needs_check_in"]
    assert session["support_state"]["question_id"] == session["turns"][-1]["id"]
    tutor.reply = lambda session, action: reply("Gợi ý cho câu hỏi tiếp theo.", "support")
    assert action(client, session, "hints").status_code == 200


def test_quick_entry_can_start_adaptive_session(client):
    created = client.post("/api/learning/quick-start", json={
        "prompt": "Trình bày suy nghĩ về vai trò của đọc sách", "materials": "",
    })
    assert created.status_code == 201, created.text
    session = start(client, created.json()["id"])
    assert session["support_state"]["consecutive_hints"] == 0


def test_proactive_support_counts_but_source_request_does_not(client, tutor):
    session = start(client)
    tutor.reply = lambda session, action: reply("Em hãy bổ sung đoạn trích cần đọc.", "source_request")
    session = answer(client, session)
    assert len(session["support_events"]) == 0
    tutor.reply = lambda session, action: reply("Hãy thử tách vấn đề thành hai phần. Em thấy phần nào trước?", "support", 2)
    session = action(client, session, "messages", text="Đây là đoạn trích học sinh bổ sung để đọc hiểu.").json()
    assert session["turns"][-2]["purpose"] == "source"
    assert len(session["support_events"]) == 1
    assert session["support_events"][0]["origin"] == "adaptive"
    assert client.get("/api/dashboard").json()["answers"] == 1


def test_failed_request_survives_restart_and_retries_once(client, tutor, database, authorize):
    session = start(client)
    body = {"expected_version": 0, "client_message_id": "durable", "text": "[fail] Câu trả lời phải được giữ lại."}
    path = f"/api/sessions/{session['id']}/messages"
    assert client.post(path, json=body).status_code == 502
    saved = client.get(f"/api/sessions/{session['id']}").json()
    assert saved["pending_action"]["text"] == body["text"]
    assert saved["pending_action"]["status"] == "failed"
    assert "token" not in saved["pending_action"] and "fingerprint" not in saved["pending_action"]
    tutor.reply = lambda session, action: reply()
    with TestClient(create_app(database.path, tutor_engine=tutor)) as restarted:
        authorize(restarted)
        result = restarted.post(path, json=body)
        assert result.status_code == 200, result.text
        assert result.json()["pending_action"] is None
        assert sum(t["kind"] == "student" for t in result.json()["turns"]) == 1
        assert restarted.post(path, json=body).json() == result.json()


def test_no_db_transaction_during_provider_and_concurrent_actions_are_serialized(client, tutor):
    entered, release = Event(), Event()
    def blocked_reply(session, action):
        entered.set()
        assert release.wait(10)
        return reply("Essaie une piste.", "support")
    tutor.reply = blocked_reply
    session = start(client)
    body = {"expected_version": 0, "client_message_id": "blocked"}
    path = f"/api/sessions/{session['id']}/hints"
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(lambda: client.post(path, json=body))
        try:
            assert entered.wait(5)
            saved = client.get(f"/api/sessions/{session['id']}").json()
            assert saved["pending_action"]["status"] == "processing"
            assert client.post(path, json=body).status_code == 409
            assert action(client, session, "messages", text="Yêu cầu song song").status_code == 409
        finally:
            release.set()
        result = future.result()
    assert result.status_code == 200, result.text
    assert len(result.json()["support_events"]) == 1


def test_cancel_invalidates_late_provider_result(client, tutor):
    entered, release = Event(), Event()
    def blocked_reply(session, action):
        entered.set()
        assert release.wait(10)
        return reply("Một gợi ý đã bị hủy", "support")
    tutor.reply = blocked_reply
    session = start(client)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(lambda: action(client, session, "hints"))
        try:
            assert entered.wait(5)
            canceled = action(client, session, "cancel")
            assert canceled.status_code == 200
        finally:
            release.set()
        assert future.result().status_code == 409
    saved = client.get(f"/api/sessions/{session['id']}").json()
    assert saved["support_events"] == [] and len(saved["turns"]) == 1


def test_invalid_evidence_fails_without_publishing_grade(client, tutor):
    session = answer(client, start(client))
    original = tutor.assess
    def fabricated(session, essay):
        draft = original(session, essay)
        draft.basic.evidence[0].quote = "Một đoạn mà học sinh chưa từng viết"
        return draft
    tutor.assess = fabricated
    result = finish_and_submit(client, session)
    assert result.status_code == 502
    saved = client.get(f"/api/sessions/{session['id']}").json()
    assert not saved["submitted"] and saved["assessment"] is None
    assert saved["pending_action"]["action"] == "submit"


def test_insufficient_evidence_no_total_or_rank(client, tutor):
    session = answer(client, start(client))
    original = tutor.assess
    def incomplete(session, essay):
        draft = original(session, essay)
        draft.higher.observed, draft.higher.points, draft.higher.evidence = False, None, []
        return draft
    tutor.assess = incomplete
    result = finish_and_submit(client, session)
    assert result.status_code == 200
    report = result.json()["assessment"]
    assert report["coverage"] == 2 and report["score"] is None and report["classification"] is None


def test_missing_key_is_explicit_no_scripted_fallback(client, tutor, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    tutor.plan = OpenAITutor().plan
    result = client.post("/api/sessions", json={"assignment_id": assignment(client)["id"]})
    assert result.status_code == 503
    assert "chưa được kết nối" in result.json()["detail"]
    assert client.get("/api/sessions").json() == []


def test_legacy_session_stays_readable_in_openai_mode(database, authorize, monkeypatch):
    monkeypatch.setenv("TUTOR_MODE", "template")
    with TestClient(create_app(database.path)) as old:
        authorize(old)
        session = start(old)
    monkeypatch.setenv("TUTOR_MODE", "openai")
    with TestClient(create_app(database.path, tutor_engine=FakeTutor())) as new:
        authorize(new)
        assert start(new, session["assignment_id"])["tutor_mode"] == "template"
        assert answer(new, session)["tutor_mode"] == "template"


def test_expired_lease_retry_cannot_publish_old_result_twice(client, tutor, database):
    entered, release = Event(), Event()
    calls = []
    def delayed(session, action):
        calls.append(True)
        if len(calls) == 1:
            entered.set()
            assert release.wait(10)
        return reply("Hãy thử giải thích một chi tiết.", "support")
    tutor.reply = delayed
    session = start(client)
    body = {"expected_version": 0, "client_message_id": "recover-lease"}
    path = f"/api/sessions/{session['id']}/hints"
    with ThreadPoolExecutor(max_workers=1) as pool:
        old = pool.submit(lambda: client.post(path, json=body))
        try:
            assert entered.wait(5)
            with database.connect(write=True) as conn:
                saved = database.get(conn, "sessions", session["id"], owner_id=client.user_id)
                saved["pending_action"]["lease_until"] = 0
                database.put(conn, "sessions", session["id"], saved, owner_id=client.user_id)
            assert client.get(f"/api/sessions/{session['id']}").json()["pending_action"]["status"] == "failed"
            assert client.post(path, json=body).status_code == 200
        finally:
            release.set()
        assert old.result().status_code == 409
    saved = client.get(f"/api/sessions/{session['id']}").json()
    assert len(saved["support_events"]) == 1 and len(saved["turns"]) == 2


def test_mislabeled_hint_not_counted_and_missing_source_never_counts(client, tutor):
    session = start(client)
    tutor.reply = lambda session, action: reply()  # A question is not a delivered hint.
    assert action(client, session, "hints").status_code == 502
    saved = client.get(f"/api/sessions/{session['id']}").json()
    assert saved["support_events"] == []
    session = action(client, saved, "cancel").json()
    tutor.reply = lambda session, action: reply("Cần thêm đoạn trích để gợi ý đúng.", "source_request")
    session = action(client, session, "hints").json()
    assert session["support_events"] == []


def test_adaptive_session_and_pending_input_are_private(client, tutor, database, authorize):
    session = start(client)
    with TestClient(create_app(database.path, tutor_engine=tutor)) as other:
        authorize(other, email="other-adaptive@example.com")
        assert other.get(f"/api/sessions/{session['id']}").status_code == 404
        assert action(other, session, "hints").status_code == 404
        assert action(other, session, "finish").status_code == 404
        assert action(other, session, "cancel").status_code == 404
        assert other.get("/api/progress").json()["sessions"] == []


def test_repeated_support_content_is_not_charged_as_new_help(client, tutor):
    tutor.reply = lambda session, action: reply("Một gợi ý cần được tính đúng một lần.", "support")
    session = action(client, start(client), "hints").json()
    assert len(session["support_events"]) == 1
    result = action(client, session, "hints")
    assert result.status_code == 502
    saved = client.get(f"/api/sessions/{session['id']}").json()
    assert len(saved["support_events"]) == 1
