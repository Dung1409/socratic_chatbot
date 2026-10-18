"""Derive support state from durable turns, including sessions created before this policy."""

MAX_HINTS_WITHOUT_FEEDBACK = 3
DIFFICULTIES = {
    "understanding": "Em chưa hiểu câu hỏi.",
    "ideas": "Em chưa nghĩ ra ý.",
    "expression": "Em có ý nhưng chưa biết diễn đạt.",
}


def support_context(session):
    turns = session.get("turns", [])
    questions = [(i, t) for i, t in enumerate(turns)
                 if t["kind"] == "tutor" and t.get("response_kind", "question") == "question"]
    fallback = [(i, t) for i, t in enumerate(turns) if t["kind"] == "tutor"]
    index, question = (questions or fallback or [(-1, {})])[-1]
    consecutive = 0
    difficulty = None
    for turn in reversed(turns[index + 1:]):
        if turn["kind"] == "student" and turn.get("purpose", "answer") != "source":
            if turn.get("purpose") == "clarification":
                difficulty = turn.get("difficulty")
            break
        if turn["kind"] == "hint":
            consecutive += 1
    return {
        "question_id": question.get("id"),
        "question_text": question.get("text", ""),
        "objective": question.get("objective", session.get("current_objective", "")),
        "consecutive_hints": consecutive,
        "needs_check_in": consecutive >= MAX_HINTS_WITHOUT_FEEDBACK,
        "difficulty": difficulty,
    }
