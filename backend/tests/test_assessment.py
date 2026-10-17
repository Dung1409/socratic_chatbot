from decimal import Decimal

import pytest

from backend.app.assessment import AssessmentDraft, build_report, classify


def report_input(basic=30, application=30, higher=30):
    def tier(points):
        return {"observed": points is not None, "points": points,
                "rationale": "Có căn cứ" if points is not None else "Chưa có cơ hội thể hiện",
                "evidence": [{"source_id": "answer-1", "quote": "Lập luận của em"}] if points is not None else []}
    return AssessmentDraft(basic=tier(basic), application=tier(application), higher=tier(higher),
                           strengths=[], next_steps=["Luyện phản biện"])


@pytest.mark.parametrize("n,a,s", [(0, 1, 90), (1, .9, 81), (2, .8, 72), (4, .6, 54), (6, .4, 36), (7, .3, 27), (15, .3, 27)])
def test_original_formula_and_floor(n, a, s):
    session = {"turns": [{"id": "answer-1", "kind": "student", "text": "Lập luận của em"}],
               "support_events": [{"counted_for_autonomy": True}] * n + [{"counted_for_autonomy": False}]}
    result = build_report(report_input(), session, "", "test")
    assert (result["bloom"], result["autonomy"], result["score"], result["hint_count"]) == (90, a, s, n)


@pytest.mark.parametrize("score,label", [("100", "Tư duy Xuất sắc"), ("80", "Tư duy Xuất sắc"), ("79.999", "Tư duy Khá"), ("65", "Tư duy Khá"), ("64.99", "Tư duy Trung bình"), ("50", "Tư duy Trung bình"), ("49.999", "Cần Rèn Luyện"), ("0", "Cần Rèn Luyện")])
def test_continuous_classification_boundaries(score, label):
    assert classify(Decimal(score)) == label


def test_missing_evidence_is_not_zero_and_rounding_does_not_change_rank():
    session = {"turns": [{"id": "answer-1", "kind": "student", "text": "Lập luận của em"}], "support_events": []}
    incomplete = build_report(report_input(higher=None), session, "", "test")
    assert incomplete["status"] == "insufficient_evidence"
    assert incomplete["coverage"] == 2
    assert incomplete["bloom"] is None and incomplete["score"] is None and incomplete["classification"] is None
    result = build_report(report_input(30, 30, 19.99), session, "", "test")
    assert result["score"] == 80 and Decimal(result["raw_score"]) == Decimal("79.99")
    assert result["classification"] == "Tư duy Khá"


def test_only_actual_student_answer_quotes_can_be_evidence():
    draft = report_input()
    with pytest.raises(ValueError):
        build_report(draft, {"turns": [{"id": "answer-1", "kind": "tutor", "text": "Lập luận của em"}]}, "", "test")
    with pytest.raises(ValueError):
        build_report(draft, {"turns": [{"id": "answer-1", "kind": "student", "purpose": "source", "text": "Lập luận của em"}]}, "", "test")
    with pytest.raises(ValueError):
        build_report(draft, {"turns": [{"id": "answer-1", "kind": "student", "text": "Một câu khác"}]}, "", "test")
    with pytest.raises(ValueError):
        build_report(report_input(basic=31), {"turns": []}, "", "test")
