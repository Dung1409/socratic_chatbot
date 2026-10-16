import math
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Input(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class AssignmentInput(Input):
    title: str = Field(min_length=5, max_length=300)
    prompt: str = Field(min_length=15, max_length=30000)
    target: int = Field(default=4, ge=1, le=6)
    due: str = Field(default="", max_length=30)
    author: str = Field(default="Đề luyện tập", max_length=150)
    grade: str = Field(default="THPT", max_length=50)
    excerpt: str = Field(default="", max_length=50000)


class Criterion(Input):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    weight: int = Field(ge=0, le=100)
    desc: str = Field(default="", max_length=1000)


class RubricInput(Input):
    criteria: list[Criterion] = Field(min_length=1, max_length=20)

    @model_validator(mode="after")
    def valid_weights(self):
        if sum(c.weight for c in self.criteria) != 100:
            raise ValueError("Tổng trọng số phải bằng 100%")
        if len({c.id for c in self.criteria}) != len(self.criteria):
            raise ValueError("Mã tiêu chí không được trùng nhau")
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


Score = Annotated[float, Field(ge=0, le=10, allow_inf_nan=False)]


class ReviewInput(Input):
    scores: dict[str, Score]
    feedback: str = Field(min_length=1, max_length=10000)

    @field_validator("scores")
    @classmethod
    def nonempty(cls, value):
        if not value or not all(math.isfinite(s) for s in value.values()):
            raise ValueError("Cần nhập điểm cho từng tiêu chí")
        return value
