import math
import pytest
from grading import normalize_subjective_score


@pytest.mark.parametrize('value', [None, True, False, '70', {}, [], math.nan, math.inf, -math.inf])
def test_invalid_grades_are_not_zero_scores(value):
    with pytest.raises(ValueError):
        normalize_subjective_score(value)


@pytest.mark.parametrize('value,expected', [(-10, 0), (0, 0), (69.49, 69), (69.5, 70), (70.5, 71), (150, 100)])
def test_rounding_matches_the_browser(value, expected):
    assert normalize_subjective_score(value) == expected


def test_api_rejects_missing_score_instead_of_saving_a_wrong_answer(monkeypatch):
    from types import SimpleNamespace
    from fastapi.testclient import TestClient
    import main
    main.app.dependency_overrides[main.require_api_user] = lambda: {'id': 'test'}
    monkeypatch.setattr(main, 'build_llm', lambda *a: SimpleNamespace(invoke=lambda _: SimpleNamespace(content='{"feedback":"missing"}')))
    try:
        response = TestClient(main.app).post('/quiz/grade-subjective', json={
            'question': '질문', 'reference_answer': '정답', 'student_answer': '답안'})
        assert response.status_code >= 500
        assert 'score' not in response.json()
    finally:
        main.app.dependency_overrides.clear()
