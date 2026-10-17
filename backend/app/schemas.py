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
    prompt: str = Field(min_length=1, max_length=30000)
    context: str = Field(default="", max_length=50000)
    source_pages: list[int] = Field(default_factory=list, max_length=30)
    metadata: dict = Field(default_factory=dict)


class MultiAssignmentInput(Input):
    title: str = Field(min_length=5, max_length=300)
    prompt: str = Field(default="", max_length=30000)
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


class SourcePageInput(Input):
    number: int = Field(ge=1, le=30)
    label: str = Field(min_length=1, max_length=100)
    text: str = Field(max_length=150000)
    method: str = Field(default="text", max_length=20)
    confidence: float | None = Field(default=None, ge=0, le=100)
    tags: list[dict] | None = Field(default=None, max_length=200)


class StructureInput(Input):
    text: str = Field(min_length=15, max_length=150000)
    pages: list[SourcePageInput] | None = Field(default=None, max_length=30)

    @model_validator(mode="after")
    def valid_pages(self):
        if self.pages and [page.number for page in self.pages] != list(range(1, len(self.pages) + 1)):
            raise ValueError("Trang/ảnh phải được đánh số theo thứ tự đã xác nhận")
        return self


class SessionInput(Input):
    assignment_id: str = Field(min_length=1, max_length=100)


class ActionInput(Input):
    client_message_id: str = Field(min_length=1, max_length=100)
    expected_version: int = Field(ge=0)


class MessageInput(ActionInput):
    text: str = Field(min_length=1, max_length=10000)


class SubmissionInput(ActionInput):
    essay: str = Field(min_length=20, max_length=50000)
