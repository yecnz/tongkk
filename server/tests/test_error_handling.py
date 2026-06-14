"""LLM 엔드포인트 공통 에러 사다리(_run_llm_call)의 동작을 고정한다.

Stage 6b에서 6개 엔드포인트의 try/except를 한 헬퍼로 합쳤다. full 사다리(/quiz)와
partial 사다리(/summarize)의 상태코드·메시지가 그대로인지 검증한다.
require_api_user는 override로 통과시키고, build_llm을 가짜로 바꿔 오류를 주입한다.
"""

import pytest

from fastapi.testclient import TestClient

import main


class _Msg:
    def __init__(self, content):
        self.content = content


class _FakeLLM:
    def __init__(self, *, exc=None, content=""):
        self._exc = exc
        self._content = content

    def invoke(self, messages):
        if self._exc is not None:
            raise self._exc
        return _Msg(self._content)


@pytest.fixture
def client():
    main.app.dependency_overrides[main.require_api_user] = lambda: None
    yield TestClient(main.app)
    main.app.dependency_overrides.clear()


# ── full 사다리(/quiz): 파싱 실패=500, 형식 검증=500, RuntimeError=500 원문, 그 외=502 ──
def test_quiz_parse_error_returns_500(client, monkeypatch):
    monkeypatch.setattr(main, "build_llm", lambda *a, **k: _FakeLLM(content="json 아님"))
    resp = client.post("/quiz", json={"subject": "수학", "count": 1, "markdown": "내용"})
    assert resp.status_code == 500
    assert "퀴즈 파싱 실패" in resp.json()["detail"]


def test_quiz_runtime_error_passes_message_through(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("키 없음")

    monkeypatch.setattr(main, "build_llm", boom)
    resp = client.post("/quiz", json={"subject": "수학", "count": 1})
    assert resp.status_code == 500
    assert resp.json()["detail"] == "키 없음"


def test_quiz_generic_error_returns_502(client, monkeypatch):
    monkeypatch.setattr(main, "build_llm", lambda *a, **k: _FakeLLM(exc=TypeError("이상")))
    resp = client.post("/quiz", json={"subject": "수학", "count": 1})
    assert resp.status_code == 502
    assert resp.json()["detail"] == "퀴즈 생성 중 오류가 발생했습니다."


# ── partial 사다리(/summarize): 파싱 분기 없음 → ValueError도 502, RuntimeError만 500 ──
def test_summarize_value_error_is_502_not_500(client, monkeypatch):
    monkeypatch.setattr(main, "build_llm", lambda *a, **k: _FakeLLM(exc=ValueError("형식")))
    resp = client.post("/summarize", json={"markdown": "내용"})
    assert resp.status_code == 502
    assert resp.json()["detail"] == "요약 생성 중 오류가 발생했습니다."


def test_summarize_runtime_error_passes_message_through(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("모델 설정 누락")

    monkeypatch.setattr(main, "build_llm", boom)
    resp = client.post("/summarize", json={"markdown": "내용"})
    assert resp.status_code == 500
    assert resp.json()["detail"] == "모델 설정 누락"
