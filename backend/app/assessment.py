"""Three-tier scoring from the supplied research document; arithmetic stays server-side."""
from decimal import Decimal, ROUND_HALF_UP
from pydantic import BaseModel, ConfigDict, Field, model_validator

SCORING_VERSION = "bloom-autonomy-1.0"
DIMENSIONS = {
    "basic": ("Cơ bản · Nhớ – Hiểu", 30),
    "application": ("Vận dụng · Áp dụng – Phân tích", 35),
    "higher": ("Bậc cao · Đánh giá – Sáng tạo", 35),
}

# Holistic anchors within each original tier, not six independently weighted criteria.
RUBRIC = """
Chấm đúng ba tầng của tài liệu, không cộng điểm theo số tin nhắn:
basic (0–30): tái hiện chính xác chi tiết/thông tin; giải thích đúng bằng lời riêng.
application (0–35): phân tích nguyên nhân–kết quả và liên hệ logic;
chọn, sử dụng bằng chứng từ ngữ liệu/dữ liệu để chứng minh.
higher (0–35): đánh giá, phản biện có lý lẽ; khái quát bài học, đề xuất giải pháp
hoặc tự tổng hợp/hoàn thiện sản phẩm. Đọc hiểu có thể dùng diễn giải/vận dụng
thông điệp vào tình huống mới, không bắt buộc bài nghị luận dài.
Mốc mô tả trong MỖI tầng: 0% đã có cơ hội nhưng chưa đáp ứng tối thiểu;
25% thể hiện rời rạc, sai lệch lớn; 50% đúng một phần, thiếu căn cứ/liên kết;
75% phần lớn đúng, có lý giải và căn cứ, còn thiếu sót;
100% chính xác, đầy đủ các biểu hiện của tầng, lập luận mạch lạc, có căn cứ.
Có thể chấm giữa các mốc với lý do cụ thể. Đây là hướng dẫn vận hành hóa v1.
Chưa có cơ hội thể hiện hoặc thiếu ngữ liệu để kiểm chứng: observed=false,
points=null; không gán 0. Không suy ra năng lực từ bậc câu hỏi đã hỏi.
AI mới hỏi nhưng học sinh chưa trả lời không đủ để gán 0. Câu hỏi phụ lệch
khỏi đề không chứng minh đã có cơ hội đánh giá theo đề. Lựa chọn chỗ vướng
purpose=clarification không phải biểu hiện tư duy để chấm. Một liên tưởng
ngắn chưa giải thích không tự chứng minh nhận thức về tầm quan trọng của vấn đề.
Chỉ dùng bằng chứng từ câu trả lời/bài tổng hợp của học sinh, dẫn đúng source_id
và trích nguyên văn. Không chấm nội dung của AI hoặc ngữ liệu học sinh dán vào
như suy nghĩ tự hình thành. Phân biệt thành quả sau hỗ trợ và tự lực; không trừ
điểm B lần nữa vì đã nhận gợi ý (A do server tính riêng). Không kết luận sao chép
chỉ từ văn phong. Nêu giới hạn nếu không đủ bằng chứng cho cả hai biểu hiện.
"""


class Structured(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Evidence(Structured):
    source_id: str = Field(min_length=1, max_length=100)
    quote: str = Field(min_length=3, max_length=2000)


class DimensionAssessment(Structured):
    observed: bool
    points: float | None = Field(ge=0, le=35)
    rationale: str = Field(min_length=1, max_length=3000)
    evidence: list[Evidence] = Field(max_length=12)

    @model_validator(mode="after")
    def consistent(self):
        if self.observed and (self.points is None or not self.evidence):
            raise ValueError("Observed scores require points and student evidence")
        if not self.observed and self.points is not None:
            raise ValueError("Unobserved is not zero")
        return self


class AssessmentDraft(Structured):
    basic: DimensionAssessment
    application: DimensionAssessment
    higher: DimensionAssessment
    strengths: list[str] = Field(max_length=5)
    next_steps: list[str] = Field(min_length=1, max_length=5)


def student_sources(session, essay=""):
    sources = {t["id"]: t["text"] for t in session["turns"]
               if t["kind"] == "student" and t.get("purpose", "answer") == "answer"}
    if essay:
        sources["submission"] = essay
    return sources


def classify(score: Decimal):
    if score >= 80:
        return "Tư duy Xuất sắc"
    if score >= 65:
        return "Tư duy Khá"
    if score >= 50:
        return "Tư duy Trung bình"
    return "Cần Rèn Luyện"


def build_report(draft: AssessmentDraft, session, essay, model):
    sources = student_sources(session, essay)
    dimensions, total = [], Decimal(0)
    for key, (name, maximum) in DIMENSIONS.items():
        assessment = getattr(draft, key)
        if assessment.points is not None and assessment.points > maximum:
            raise ValueError("Score exceeds the original tier maximum")
        for evidence in assessment.evidence:
            if evidence.source_id not in sources or evidence.quote not in sources[evidence.source_id]:
                raise ValueError("Evidence must be an exact quote from a student answer")
        points = Decimal(str(assessment.points)) if assessment.points is not None else None
        if points is not None:
            total += points
        dimensions.append({"key": key, "name": name, "maximum": maximum,
                           **assessment.model_dump()})
    n = sum(event["counted_for_autonomy"] for event in session.get("support_events", []))
    autonomy = max(Decimal("0.3"), Decimal(1) - Decimal("0.1") * n)
    complete = all(item["observed"] for item in dimensions)
    score = total * autonomy if complete else None
    display = lambda value: float(value.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))
    return {
        "status": "complete" if complete else "insufficient_evidence",
        "dimensions": dimensions, "coverage": sum(item["observed"] for item in dimensions),
        "bloom": display(total) if complete else None, "hint_count": n,
        "autonomy": float(autonomy), "score": display(score) if complete else None,
        # Classify unrounded S: 79.99 must not become excellent after display rounding.
        "classification": classify(score) if complete else None,
        "raw_bloom": str(total) if complete else None,
        "raw_score": str(score) if complete else None,
        "strengths": draft.strengths, "next_steps": draft.next_steps,
        "scoring_version": SCORING_VERSION, "model": model,
    }
