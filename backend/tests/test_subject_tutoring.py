from fastapi.testclient import TestClient

from backend.app.ai_tutor import LessonPlan, OpenAITutor, TutorReply
from backend.app.main import create_app
from backend.app.subject_tutoring import tutor_profile
from backend.app.tutor import lesson_steps
from backend.app.extraction import subject_from_pages
from backend.app.structure import structure_text
from backend.app import document_ai


def test_literature_is_preserved_and_stem_uses_different_questions():
    literature = {"subject": "Ngữ văn", "task_type": "literary", "target": 4}
    physics = {"subject": "Vật lý", "task_type": "other", "target": 4}
    assert tutor_profile(literature)[0] == "literature"
    assert "luận điểm" in lesson_steps(literature)[3]["q"]
    assert tutor_profile(physics)[0] == "physics"
    assert "dữ kiện" in lesson_steps(physics)[0]["q"]


def test_model_subject_hint_is_not_limited_to_a_fixed_subject_list():
    pages = [{"number": 1, "text": "Dữ liệu về các lục địa.", "subject_hint": "Địa lý"}]
    assert subject_from_pages(pages, pages[0]["text"], "bai-tap.txt") == "Địa lý"
    assert tutor_profile({"subject": "Địa lý", "task_type": "other"})[0] == "other"
    page = {"number": 1, "label": "Trang 1", "text": "Câu 1. Giải thích số liệu khí hậu.",
            "subject_hint": "Địa lý"}
    question = structure_text(page["text"], [page])["parts"][0]["questions"][0]
    assert question["subject_hint"] == "Địa lý"


def test_document_model_subject_hint_survives_transcription():
    pages = [{"number": 1, "label": "Trang 1", "text": "Câu 1. Giải thích khí hậu.",
              "method": "text", "confidence": None}]
    result, _ = document_ai._apply(pages, {}, lambda batch: (
        {batch[0]["id"]: {"text": pages[0]["text"], "tags": [], "subject": "Địa lý"}}, []))
    assert result[0]["subject_hint"] == "Địa lý"


def test_unlisted_subject_is_not_rejected_by_the_plan(monkeypatch):
    tutor = OpenAITutor(visual_loader=lambda assignment: [b"jpeg"])
    calls = []

    def fake_call(schema, instruction, context, **kwargs):
        calls.append((instruction, context, kwargs))
        return LessonPlan(task_type="other", summary="Phân tích dữ kiện.",
                          objectives=["Tự xác định nguồn"], opening=TutorReply(
                              text="Dữ kiện nào quan trọng nhất?", kind="question",
                              strategy="evidence", bloom_level=2, objective="Làm rõ dữ kiện",
                              support_reason=None))

    monkeypatch.setattr(tutor, "_call", fake_call)
    assignment = {"subject": "Địa lý", "task_type": "other", "visual_refs": ["figure-1"]}
    plan = tutor.plan(assignment)
    assert plan.task_type == "other"
    assert "không thuộc" in calls[0][0]
    assert calls[0][2]["images"] == [b"jpeg"]
    assert "items" not in calls[0][1]


def test_tutor_sends_selected_visual_as_response_image_input(monkeypatch):
    import openai

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    captured = {}

    class Client:
        def __init__(self, **kwargs):
            self.responses = self

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def parse(self, **kwargs):
            captured.update(kwargs)
            return type("Result", (), {"status": "completed", "output_parsed": TutorReply(
                text="Em đọc được gì trên đồ thị?", kind="question", strategy="evidence",
                bloom_level=2, objective="Đọc hình", support_reason=None)})()

    monkeypatch.setattr(openai, "OpenAI", Client)
    OpenAITutor()._call(TutorReply, "Đọc hình", {"subject": "Vật lý"}, images=[b"image"])
    content = captured["input"][0]["content"]
    assert content[0]["type"] == "input_text"
    assert content[1]["type"] == "input_image"
    assert content[1]["image_url"].startswith("data:image/jpeg;base64,")


def test_selected_question_metadata_reaches_its_session(database, tmp_path, authorize):
    with TestClient(create_app(database.path, storage_path=tmp_path / "uploads")) as client:
        authorize(client)
        assignment = client.post("/api/learning/assignments", json={
            "title": "Đề kiểm tra Vật lý", "prompt": "Quan sát đồ thị rồi giải thích chuyển động.",
            "items": [{"item_type": "other", "label": "Câu 1", "prompt": "Quan sát đồ thị.",
                       "metadata": {"subject": "Vật lý", "question_type": "multiple_choice",
                                    "visual_refs": ["page-1-region-1"]}}],
        })
        assert assignment.status_code == 201, assignment.text
        session = client.post("/api/sessions", json={"assignment_id": assignment.json()["id"]})
        assert session.status_code == 200, session.text
        selected = session.json()["assignment"]
        assert selected["subject"] == "Vật lý"
        assert selected["question_type"] == "multiple_choice"
        assert selected["visual_refs"] == ["page-1-region-1"]
