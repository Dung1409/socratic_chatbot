from decimal import Decimal

import pytest

from backend.app.assessment import AssessmentDraft, SCORING_VERSION, autonomy_factor, build_report, classify


def report_input(basic=30, application=30, higher=30):
    def tier(points):
        return {"observed": points is not None, "points": points,
                "rationale": "Có căn cứ" if points is not None else "Chưa có cơ hội thể hiện",
                "evidence": [{"source_id": "answer-1", "quote": "Lập luận của em"}] if points is not None else []}
    return AssessmentDraft(basic=tier(basic), application=tier(application), higher=tier(higher),
                           strengths=[], next_steps=["Luyện phản biện"])


@pytest.mark.parametrize("n,a,s", [
    (0, 1, 90), (1, .9125, 82.1), (2, .8444444444444444, 76),
    (4, .7454545454545455, 67.1), (6, .676923076923077, 60.9),
    (7, .65, 58.5), (15, .5227272727272727, 47), (100, .34579439252336447, 31.1),
])
def test_gentle_formula_and_counted_support(n, a, s):
    session = {"turns": [{"id": "answer-1", "kind": "student", "text": "Lập luận của em"}],
               "support_events": [{"counted_for_autonomy": True}] * n + [{"counted_for_autonomy": False}]}
    result = build_report(report_input(), session, "", "test")
    assert (result["bloom"], result["score"], result["hint_count"]) == (90, s, n)
    assert result["autonomy"] == pytest.approx(a)
    assert result["scoring_version"] == SCORING_VERSION == "bloom-autonomy-2.0"


def test_autonomy_floor_diminishing_penalty_and_improvement_over_original():
    factors = [autonomy_factor(n) for n in range(101)]
    penalties = [before - after for before, after in zip(factors, factors[1:])]
    assert factors[0] == 1 and autonomy_factor(7) == Decimal("0.65")
    assert all(Decimal("0.3") <= value <= 1 for value in factors + [autonomy_factor(10**40)])
    assert all(earlier > later > 0 for earlier, later in zip(penalties, penalties[1:]))
    assert all(value >= max(Decimal("0.3"), 1 - Decimal("0.1") * n)
               for n, value in enumerate(factors))


def test_score_uses_full_factor_precision_before_display_rounding():
    session = {"turns": [{"id": "answer-1", "kind": "student", "text": "Lập luận của em"}],
               "support_events": [{"counted_for_autonomy": True}] * 6}
    result = build_report(report_input(), session, "", "test")
    assert result["score"] == 60.9  # Rounding A to 0.7 first would incorrectly yield 63.
    assert Decimal(result["raw_score"]) == Decimal(90) * autonomy_factor(6)
    boundary = build_report(report_input(30, 30, 27.66), {
        **session, "support_events": [{"counted_for_autonomy": True}],
    }, "", "test")
    assert boundary["score"] == 80 and Decimal(boundary["raw_score"]) < 80
    assert boundary["classification"] == "Tư duy Khá"


def test_floor_does_not_award_points_without_student_achievement():
    session = {"turns": [{"id": "answer-1", "kind": "student", "text": "Lập luận của em"}],
               "support_events": [{"counted_for_autonomy": True}] * 20}
    result = build_report(report_input(0, 0, 0), session, "", "test")
    assert result["bloom"] == 0 and result["score"] == 0


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
