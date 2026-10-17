from pydantic import BaseModel, ConfigDict, Field, model_validator


class Input(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class AssignmentInput(Input):
    title: str = Field(min_length=5, max_length=300)
    prompt: str = Field(min_length=15, max_length=30000)
    target: int = Field(default=4, ge=1, le=6)
    document_id: str | None = Field(default=None, min_length=1, max_length=100)


class SourcePageInput(Input):
    number: int = Field(ge=1, le=30)
    label: str = Field(min_length=1, max_length=100)
    text: str = Field(max_length=150000)
    method: str = Field(default="text", max_length=20)
    confidence: float | None = Field(default=None, ge=0, le=100)


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
