"""Derive support state from durable turns, including sessions created before this policy."""

MAX_HINTS_WITHOUT_FEEDBACK = 3
DEFAULT_MAX_DEPTH = 3
LITERATURE_MAX_DEPTH = 2
DIFFICULTIES = {
    "understanding": "Em chưa hiểu câu hỏi.",
    "ideas": "Em chưa nghĩ ra ý.",
    "expression": "Em có ý nhưng chưa biết diễn đạt.",
}


def objective_context(session):
    """Return the server-owned objective anchor for a tutor turn."""
    assignment = session.get("assignment") or {}
    root = session.get("root_objective") or assignment.get("prompt") or ""
    return {
        "root_objective": root[:2000],
        "active_objective": session.get("active_objective") or root[:500],
        "micro_objective": session.get("micro_objective") or "",
        "depth": int(session.get("objective_depth", 0)),
        "max_depth": int(session.get("max_objective_depth", DEFAULT_MAX_DEPTH)),
        "understanding_status": session.get("understanding_status", "unknown"),
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
        **objective_context(session),
    }
