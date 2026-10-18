from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Input(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class AssignmentInput(Input):
    title: str = Field(min_length=5, max_length=300)
    prompt: str = Field(min_length=15, max_length=30000)
    target: int = Field(default=6, ge=1, le=6)  # Historical template sessions only.
    task_type: Literal["reading", "social"] = "social"
    source_text: str = Field(default="", max_length=30000)
    grade: Literal[10, 11, 12] | None = None
    document_id: str | None = Field(default=None, min_length=1, max_length=100)


class AssignmentItemInput(Input):
    item_type: Literal["reading", "social", "literary", "other"] = "other"
    label: str = Field(min_length=1, max_length=200)
    prompt: str = Field(min_length=1, max_length=150000)
    context: str = Field(default="", max_length=200000)
    source_pages: list[int] = Field(default_factory=list, max_length=30)
    metadata: dict = Field(default_factory=dict)


class MultiAssignmentInput(Input):
    title: str = Field(min_length=5, max_length=300)
    prompt: str = Field(default="", max_length=150000)
    task_type: Literal["reading", "social", "literary", "mixed"] = "mixed"
    source_text: str = Field(default="", max_length=150000)
    document_id: str | None = Field(default=None, min_length=1, max_length=100)
    items: list[AssignmentItemInput] = Field(min_length=1, max_length=100)


class SessionTurnInput(Input):
    session_item_id: str = Field(min_length=1, max_length=100)
    role: Literal["student", "tutor", "hint", "system"]
    kind: str = Field(min_length=1, max_length=50)
    text: str = Field(min_length=1, max_length=50000)
    bloom_level: int | None = Field(default=None, ge=1, le=6)
    strategy: str | None = Field(default=None, max_length=100)
    objective: str | None = Field(default=None, max_length=500)
    metadata: dict = Field(default_factory=dict)


class SessionItemStatusInput(Input):
    status: Literal["pending", "active", "completed", "skipped"]


class SessionDraftInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answer: str = Field(default="", max_length=10000)
    essay: str = Field(default="", max_length=50000)
    revision: int = Field(ge=0)
    expected_version: int = Field(ge=0)


class SourcePageInput(Input):
    number: int = Field(ge=1, le=30)
    label: str = Field(min_length=1, max_length=100)
    text: str = Field(max_length=150000)
    method: str = Field(default="text", max_length=20)
    confidence: float | None = Field(default=None, ge=0, le=100)
    image_source: str | None = Field(default=None, max_length=20)
    subject_hint: str | None = Field(default=None, max_length=100)
    tags: list[dict] | None = Field(default=None, max_length=200)
    visual_sources: list[dict] = Field(default_factory=list, max_length=100)
    visuals: list[dict] = Field(default_factory=list, max_length=100)


class StructureInput(Input):
    text: str = Field(min_length=15, max_length=150000)
    pages: list[SourcePageInput] | None = Field(default=None, max_length=30)
    mode: Literal["auto", "single", "reference"] = "auto"

    @model_validator(mode="after")
    def valid_pages(self):
        if self.pages and [page.number for page in self.pages] != list(range(1, len(self.pages) + 1)):
            raise ValueError("Trang/ảnh phải được đánh số theo thứ tự đã xác nhận")
        if self.pages and "\n\n".join(page.text for page in self.pages if page.text).strip() != self.text:
            raise ValueError("Văn bản đã thay đổi; cần bỏ bản trang cũ và phân tích lại nội dung mới")
        return self


class ReviewParagraph(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    text: str = Field(max_length=150000)
    source_pages: list[int] = Field(default_factory=list, max_length=30)


class ReviewQuestion(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(min_length=1, max_length=100)
    label: str = Field(min_length=1, max_length=200)
    text: str = Field(max_length=150000)
    task: str = Field(default="", max_length=150000)
    context: str = Field(max_length=200000)
    materials: str = Field(default="", max_length=150000)
    source_only: bool = False
    stem: str = Field(default="", max_length=150000)
    paragraphs: list[ReviewParagraph] = Field(default_factory=list, max_length=15000)
    source_pages: list[int] = Field(default_factory=list, max_length=30)
    subject_hint: str | None = Field(default=None, max_length=100)
    ideas: list[dict] = Field(default_factory=list, max_length=100)
    subquestions: list[str] = Field(default_factory=list, max_length=100)
    question_type: Literal["multiple_choice", "true_false", "short_answer", "essay", "open_response"] = "open_response"
    answer_format: str = Field(default="text", max_length=50)
    options: list[dict] = Field(default_factory=list, max_length=20)
    statements: list[dict] = Field(default_factory=list, max_length=50)
    visual_refs: list[str] = Field(default_factory=list, max_length=100)
    visual_candidates: list[str] = Field(default_factory=list, max_length=100)


class ReviewPart(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(min_length=1, max_length=100)
    title: str = Field(max_length=500)
    context: str = Field(default="", max_length=150000)
    paragraphs: list[ReviewParagraph] = Field(default_factory=list, max_length=15000)
    source_pages: list[int] = Field(default_factory=list, max_length=30)
    questions: list[ReviewQuestion] = Field(max_length=5000)


class ReviewStructure(BaseModel):
    model_config = ConfigDict(extra="allow")
    parts: list[ReviewPart] = Field(min_length=1, max_length=100)
    global_context: str = Field(default="", max_length=150000)
    global_paragraphs: list[ReviewParagraph] = Field(default_factory=list, max_length=15000)
    visuals: list[dict] = Field(default_factory=list, max_length=3000)
    warnings: list[str] = Field(default_factory=list, max_length=1000)
    excluded: list[dict] = Field(default_factory=list, max_length=15000)


class DocumentReviewInput(Input):
    title: str = Field(min_length=5, max_length=300)
    text: str = Field(default="", max_length=150000)
    structure: ReviewStructure
    selected_ids: list[str] = Field(default_factory=list, max_length=100)
    mode: Literal["auto", "single", "reference"] = "auto"

    @model_validator(mode="after")
    def valid_selection(self):
        ids = [q.id for part in self.structure.parts for q in part.questions]
        if len(ids) > 5000 or len(ids) != len(set(ids)) or not set(self.selected_ids).issubset(ids):
            raise ValueError("Bản tách không hợp lệ; tài liệu tối đa 5.000 câu và mỗi phiên chọn tối đa 100 câu")
        if not self.text.strip() and not any(
                isinstance(visual, dict) and visual.get("kind") == "question"
                for visual in self.structure.visuals):
            raise ValueError("Cần có nội dung chữ hoặc câu hỏi được khoanh từ ảnh")
        import json
        if len(json.dumps(self.structure.model_dump(), ensure_ascii=False)) > 32_000_000:
            raise ValueError("Bản tách quá lớn; hãy chia tài liệu thành các phần nhỏ hơn")
        return self


class TextDocumentInput(StructureInput):
    title: str = Field(default="Đề nhập trực tiếp", min_length=5, max_length=300)


class QuickTaskInput(Input):
    prompt: str = Field(min_length=15, max_length=150000)
    materials: str = Field(default="", max_length=150000)

    @model_validator(mode="after")
    def combined_size(self):
        if len(self.prompt) + len(self.materials) + (12 if self.materials else 0) > 150000:
            raise ValueError("Đề và ngữ liệu tối đa 150.000 ký tự")
        return self


class SessionInput(Input):
    assignment_id: str = Field(min_length=1, max_length=100)
    item_id: str | None = Field(default=None, min_length=1, max_length=100)


class SessionSelectItemInput(Input):
    item_id: str = Field(min_length=1, max_length=100)


class ActionInput(Input):
    client_message_id: str = Field(min_length=1, max_length=100)
    expected_version: int = Field(ge=0)


class HintInput(ActionInput):
    difficulty: Literal["understanding", "ideas", "expression"] | None = None


class MessageInput(ActionInput):
    text: str = Field(min_length=1, max_length=10000)


class SubmissionInput(ActionInput):
    essay: str = Field(min_length=20, max_length=50000)
