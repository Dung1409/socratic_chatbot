from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


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


class SessionInput(Input):
    assignment_id: str = Field(min_length=1, max_length=100)


class ActionInput(Input):
    client_message_id: str = Field(min_length=1, max_length=100)
    expected_version: int = Field(ge=0)


class MessageInput(ActionInput):
    text: str = Field(min_length=1, max_length=10000)


class SubmissionInput(ActionInput):
    essay: str = Field(min_length=20, max_length=50000)
