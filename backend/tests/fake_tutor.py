"""Deterministic provider for contract/E2E tests; never selected by production config."""
from backend.app.ai_tutor import LessonPlan, TutorReply, TutorError
from backend.app.assessment import AssessmentDraft


def reply(text="Dẫn chứng nào trong đề giúp em bảo vệ nhận định đó?", kind="question", level=4):
    return TutorReply(text=text, kind=kind, strategy="evidence", bloom_level=level,
                      objective="Liên kết dẫn chứng với nhận định", support_reason="Chưa liên kết được căn cứ và kết luận" if kind == "support" else None)


class FakeTutor:
    model = "test-tutor"
    assessment_model = "test-assessor"
    configured = True

    def plan(self, assignment):
        task_type = assignment.get("task_type", "social")
        if task_type in ("other", "mixed"):
            task_type = "social"  # Quick entry leaves classification to the provider.
        return LessonPlan(task_type=task_type,
                          summary="Nhận diện yêu cầu và bảo vệ quan điểm bằng căn cứ.",
                          objectives=["Hiểu vấn đề", "Phân tích dẫn chứng", "Phản biện và tổng hợp"],
                          opening=reply("Em hiểu vấn đề của đề bài như thế nào?", level=2))

    def reply(self, session, action):
        if action == "hint":
            if session["turns"][-1].get("purpose") == "clarification":
                return reply("Từ chỗ em đang vướng, hãy chọn một căn cứ và giải thích bằng lời riêng. "
                             f"Đây là lượt hỗ trợ {len(session['support_events']) + 1} cho câu hỏi gốc.", "support")
            hints = [
                "Hãy chọn một chi tiết và thử nối nó với luận điểm bằng từ ‘vì’. Em sẽ nối như thế nào?",
                "Thử kiểm tra xem chi tiết đó là nguyên nhân, kết quả hay ngoại lệ. Vì sao em chọn cách hiểu đó?",
                "Thử khung: ý kiến của em là…; căn cứ là…; căn cứ này thuyết phục vì… Em sẽ tự điền thế nào?",
            ]
            return reply(hints[min(len(session["support_events"]), 2)], "support")
        latest = session["turns"][-1]["text"]
        if "[fail]" in latest:
            raise TutorError("Lỗi kết nối AI thử nghiệm")
        answers = sum(t["kind"] == "student" and t.get("purpose") == "answer" for t in session["turns"])
        if answers >= 3:
            return reply("Em hãy tự tổng hợp kết luận và giải thích lựa chọn của mình.", "ready", 6)
        return reply()

    def assess(self, session, essay):
        first = next(t for t in session["turns"] if t["kind"] == "student" and t.get("purpose") == "answer")
        evidence = [{"source_id": first["id"], "quote": first["text"][:200]}]
        dimension = lambda points: {"observed": True, "points": points, "rationale": "Có căn cứ trong câu trả lời và phần tổng hợp.", "evidence": evidence}
        return AssessmentDraft(basic=dimension(30), application=dimension(30), higher=dimension(30),
                               strengths=["Nhận diện được vấn đề"], next_steps=["Thử kiểm tra một phản ví dụ mới."])
