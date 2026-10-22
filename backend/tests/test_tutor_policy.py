import pytest

from backend.app.ai_tutor import (
    AssessmentReview, OpenAITutor, SupportReview, TutorError, TutorReply,
)
from backend.app.assessment import AssessmentDraft, build_report, student_sources
from backend.tests.fake_tutor import reply


def book_session():
    return {
        "model": "test", "assessment_model": "test", "plan": {},
        "assignment": {"prompt": "Trình bày suy nghĩ về vai trò của đọc sách"},
        "turns": [
            {"id": "question", "kind": "tutor", "response_kind": "question",
             "text": "Đọc sách có vai trò gì với em, vì sao?", "objective": "Giải thích vai trò đọc sách"},
            {"id": "old-hint", "kind": "hint", "text": "Nhân vật nghỉ học chăm người thân có cảm xúc gì?"},
        ], "support_events": [],
    }


@pytest.mark.parametrize("on_target,useful,gives_answer", [
    (False, True, False), (True, True, True),
])
def test_support_review_rejects_drift_rephrasing_or_answer_giveaway(monkeypatch, on_target, useful, gives_answer):
    tutor = OpenAITutor()
    calls = []

    def call(schema, instruction, context, **kwargs):
        calls.append(context)
        if schema is TutorReply:
            return reply("Em chọn cảm xúc lo lắng hay tủi thân?", "support")
        assert schema is SupportReview
        return SupportReview(on_target=on_target, adds_useful_support=useful,
                             gives_away_answer=gives_answer, reason="Kiểm tra gợi ý")

    monkeypatch.setattr(tutor, "_call", call)
    if on_target and not gives_answer:
        assert tutor.reply(book_session(), "hint").kind == "support"
    else:
        with pytest.raises(TutorError, match="chưa bám sát"):
            tutor.reply(book_session(), "hint")
    assert len(calls) == 2
    assert calls[0]["support_context"]["question_id"] == "question"
    assert calls[1]["support_context"]["objective"] == "Giải thích vai trò đọc sách"


def test_on_target_support_is_returned_and_source_request_needs_no_support_review(monkeypatch):
    tutor = OpenAITutor()
    candidate = reply("Chọn một thay đổi nhờ đọc sách, rồi thử giải thích vì sao thay đổi đó có ích.", "support")
    monkeypatch.setattr(tutor, "_call", lambda schema, *args, **kwargs:
        candidate if schema is TutorReply else SupportReview(
            on_target=True, adds_useful_support=True, gives_away_answer=False, reason="Bám câu gốc"))
    assert tutor.reply(book_session(), "hint") == candidate
    candidate = reply("Em bổ sung ngữ liệu nhé.", "source_request")
    assert tutor.reply(book_session(), "hint") == candidate


def test_unanswered_side_questions_cannot_force_zero_and_clarification_is_not_evidence(monkeypatch):
    session = book_session()
    session["turns"] += [
        {"id": "clarify", "kind": "student", "purpose": "clarification", "text": "Em chưa nghĩ ra ý."},
        {"id": "answer", "kind": "student", "purpose": "answer", "text": "đọc sách là xem 1 bộ phim"},
    ]
    tier = lambda points: {"observed": True, "points": points, "rationale": "Đã được hỏi",
                           "evidence": [{"source_id": "answer", "quote": "đọc sách là xem 1 bộ phim"}]}
    draft = AssessmentDraft(basic=tier(7.5), application=tier(0), higher=tier(0),
                            strengths=["Đã khẳng định tầm quan trọng"], next_steps=["Nêu cảm xúc nhân vật"])
    review = AssessmentReview(
        basic={"can_assess": True, "reason": "Có liên tưởng ban đầu"},
        application={"can_assess": False, "reason": "Chưa có phản hồi cho yêu cầu phân tích bám đề"},
        higher={"can_assess": False, "reason": "Câu hỏi phụ chưa được trả lời"},
        strengths=["Có liên tưởng giữa đọc sách và xem phim"], next_steps=["Giải thích một vai trò đọc sách"],
    )
    tutor = OpenAITutor()
    monkeypatch.setattr(tutor, "_call", lambda schema, *args, **kwargs:
                        draft if schema is AssessmentDraft else review)
    assessed = tutor.assess(session, "")
    report = build_report(assessed, session, "", "test")
    assert report["coverage"] == 1 and report["score"] is None and report["classification"] is None
    assert report["dimensions"][1]["points"] is None
    assert report["strengths"] == review.strengths
    assert "clarify" not in student_sources(session)
