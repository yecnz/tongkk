"""focus_prompt(집중할 내용) 프롬프트 빌더 특성화 테스트.

요약·퀴즈에서 사용자의 "집중할 내용"이 확실히 반영되도록 한 변경을 고정한다.
LLM·네트워크 없이 순수 문자열 합성만 검증한다. 핵심 보증:
1. focus가 없으면 LLM에 가는 SYSTEM·USER 문자열이 현행과 글자 단위로 동일하다.
2. focus가 있으면 그 텍스트가 SYSTEM·USER 양쪽에 등장하고, USER에서는 맨 끝(생성 직전)에 온다.
3. 배타적 "…만 따라 작성해"는 focus가 있을 때 사라진다(focus 배제 방지).
4. 마인드맵 JSON·퀴즈 JSON·행정정보 금지 같은 형식/안전 규칙은 깨지지 않는다.
"""

import pytest
from fastapi.testclient import TestClient

import main
import prompts


TEMPLATES = ["GENERAL", "LECTURE_NOTE", "MINDMAP", "CHEAT_SHEET"]
SAMPLE_FOCUS = "합성곱 신경망의 정의와 역전파 공식"
MARKDOWN_MARKER = "[강의자료]"


def render_summary_user(template, focus, markdown="샘플 강의자료 본문입니다", source_names=None):
    checklist, tail = prompts._summary_user_focus_parts(template, focus)
    return prompts.SUMMARY_USER_PROMPT.format(
        template_label=prompts.TEMPLATE_LABELS[template],
        template_instruction=prompts.TEMPLATE_INSTRUCTIONS[template],
        citation_rule=prompts._citation_rule(source_names),
        markdown=markdown,
        focus_checklist=checklist,
        focus_user_tail=tail,
    )


def render_quiz_user(focus, count=10, question_type="객관식"):
    return prompts.QUIZ_USER_PROMPT.format(
        subject="자료구조",
        count=count,
        difficulty="보통",
        question_type=question_type,
        markdown_section="\n강의자료:\n샘플 본문\n",
        exclude_section="",
        focus_quiz_section=prompts._quiz_user_focus_section(focus),
    )


# ---------------------------------------------------------------------------
# 1) no-focus 바이트 동일성
# ---------------------------------------------------------------------------
class TestNoFocusIdentity:
    @pytest.mark.parametrize("blank", [None, "", "   ", "\n\t "])
    def test_summary_system_unchanged(self, blank):
        assert prompts._summary_system_content(blank) == prompts.SUMMARY_SYSTEM_PROMPT

    @pytest.mark.parametrize("blank", [None, "", "   "])
    def test_quiz_system_unchanged(self, blank):
        base = f"{prompts.QUIZ_SYSTEM_PROMPT}\n\n{prompts.quiz_format_instruction('객관식')}"
        assert prompts._quiz_system_content("객관식", blank) == base

    @pytest.mark.parametrize("template", TEMPLATES)
    def test_summary_user_parts_unchanged(self, template):
        label = prompts.TEMPLATE_LABELS[template]
        checklist, tail = prompts._summary_user_focus_parts(template, None)
        assert checklist == f"- {label} 템플릿 지시와 공통 기준만 따라 작성해."
        assert tail == ""

    @pytest.mark.parametrize("blank", [None, "", "   "])
    def test_quiz_user_section_empty(self, blank):
        assert prompts._quiz_user_focus_section(blank) == ""

    def test_summary_user_render_no_focus_block(self):
        out = render_summary_user("GENERAL", None)
        assert "공통 기준만 따라 작성해." in out      # 현행 점검 문구 보존("만" 포함)
        assert "[집중 요청" not in out                # focus 블록 없음

    def test_quiz_user_render_no_focus_block(self):
        out = render_quiz_user(None)
        assert "[집중 요청" not in out
        assert out.rstrip().endswith("JSON 배열로만 출력해.")


# ---------------------------------------------------------------------------
# 2) focus가 SYSTEM·USER 양쪽 등장
# ---------------------------------------------------------------------------
class TestFocusInBothMessages:
    def test_summary_focus_in_system_and_user(self):
        system = prompts._summary_system_content(SAMPLE_FOCUS)
        _, tail = prompts._summary_user_focus_parts("GENERAL", SAMPLE_FOCUS)
        assert SAMPLE_FOCUS in system
        assert SAMPLE_FOCUS in tail
        assert tail.strip()

    def test_quiz_focus_in_system_and_user(self):
        system = prompts._quiz_system_content("객관식", SAMPLE_FOCUS)
        section = prompts._quiz_user_focus_section(SAMPLE_FOCUS)
        assert SAMPLE_FOCUS in system
        assert SAMPLE_FOCUS in section
        assert section.strip()


# ---------------------------------------------------------------------------
# 3) 배타적 "만" 제거 + 합류 문구
# ---------------------------------------------------------------------------
class TestExclusiveManRemoved:
    @pytest.mark.parametrize("template", TEMPLATES)
    def test_checklist_drops_exclusive_man(self, template):
        checklist, _ = prompts._summary_user_focus_parts(template, SAMPLE_FOCUS)
        assert "만 따라 작성해" not in checklist
        assert "함께 반영" in checklist


# ---------------------------------------------------------------------------
# 4) focus가 USER 맨 끝(recency)
# ---------------------------------------------------------------------------
class TestFocusRecency:
    def test_summary_focus_after_markdown(self):
        out = render_summary_user("GENERAL", SAMPLE_FOCUS)
        assert out.rindex(SAMPLE_FOCUS) > out.index(MARKDOWN_MARKER)
        # tail이 점검 블록 뒤, 즉 USER 거의 마지막에 위치
        assert out.index("[집중 요청 — 출력에 반드시 반영]") > out.index("최종 출력 점검:")

    def test_quiz_focus_before_final_instruction(self):
        out = render_quiz_user(SAMPLE_FOCUS)
        assert out.index(SAMPLE_FOCUS) < out.index("위 조건에 맞는")
        assert "[집중 요청 — 출제에 반드시 반영]" in out


# ---------------------------------------------------------------------------
# 5) 적응 규칙(문구 따라 자동: '~만/오직' 한정이면 좁힘)
# ---------------------------------------------------------------------------
class TestAdaptiveSemantics:
    def test_summary_tail_has_narrowing_rule(self):
        _, tail = prompts._summary_user_focus_parts("GENERAL", SAMPLE_FOCUS)
        assert "오직" in tail and "한정" in tail
        assert "강의자료에 근거" in tail          # 환각 금지 유지

    def test_quiz_has_narrowing_rule(self):
        section = prompts._quiz_user_focus_section(SAMPLE_FOCUS)
        system = prompts._quiz_system_content("객관식", SAMPLE_FOCUS)
        assert "~만/오직" in section
        assert "한정" in system


# ---------------------------------------------------------------------------
# 6) 퀴즈 JSON-only 불변 + 행정정보 가드
# ---------------------------------------------------------------------------
class TestQuizFormatSafety:
    @pytest.mark.parametrize("qtype", ["객관식", "OX", "단답형", "주관식"])
    def test_focus_keeps_format_instruction(self, qtype):
        system = prompts._quiz_system_content(qtype, SAMPLE_FOCUS)
        # 유형별 형식 지시가 그대로 포함되어야 한다
        assert prompts.quiz_format_instruction(qtype) in system
        assert "순수 JSON 배열" in system

    def test_focus_keeps_admin_guard(self):
        system = prompts._quiz_system_content("객관식", SAMPLE_FOCUS)
        assert "행정 정보는 집중 요청이라도 출제하지" in system

    def test_focus_does_not_change_output_format_rule(self):
        system = prompts._quiz_system_content("객관식", SAMPLE_FOCUS)
        assert "출력 형식(순수 JSON 배열)과 문항 유형 규칙은 절대 바꾸지 마라" in system


# ---------------------------------------------------------------------------
# 7) MINDMAP JSON 안전
# ---------------------------------------------------------------------------
class TestMindmapSafety:
    def test_focus_system_has_json_guard(self):
        system = prompts._summary_system_content(SAMPLE_FOCUS)
        assert "JSON 구조·키를 절대 바꾸지" in system
        assert "노드 선택·순서·세분화" in system

    def test_mindmap_user_tail_keeps_format_clause(self):
        # 형식은 템플릿대로 지키라는 문구가 USER 말미에도 있어 JSON 형식을 강제
        _, tail = prompts._summary_user_focus_parts("MINDMAP", SAMPLE_FOCUS)
        assert "형식·문체·구조는 마인드맵 템플릿 지시를 그대로 지키고" in tail


# ---------------------------------------------------------------------------
# 8) 플레이스홀더 회귀(KeyError) 방지
# ---------------------------------------------------------------------------
class TestPlaceholderRegression:
    def test_summary_format_succeeds(self):
        assert render_summary_user("LECTURE_NOTE", SAMPLE_FOCUS)
        assert render_summary_user("LECTURE_NOTE", None)

    def test_quiz_format_succeeds(self):
        assert render_quiz_user(SAMPLE_FOCUS)
        assert render_quiz_user(None)

    def test_summary_missing_placeholder_raises(self):
        with pytest.raises(KeyError):
            prompts.SUMMARY_USER_PROMPT.format(
                template_label="일반 요약",
                template_instruction="x",
                citation_rule="y",
                markdown="z",
                # focus_checklist / focus_user_tail 누락
            )

    def test_quiz_missing_placeholder_raises(self):
        with pytest.raises(KeyError):
            prompts.QUIZ_USER_PROMPT.format(
                subject="과목",
                count=5,
                difficulty="보통",
                question_type="객관식",
                markdown_section="",
                exclude_section="",
                # focus_quiz_section 누락
            )


# ---------------------------------------------------------------------------
# 9) 골든(전체 렌더) 동일성 — 부분 문자열이 아닌 정확 등치로 잠가, 빈 확장 위치의
#    stray newline/순서 회귀까지 잡는다. (focus 기계장치가 no-focus 출력을 1바이트도 바꾸지 않음)
# ---------------------------------------------------------------------------
class TestNoFocusGoldenRender:
    def test_quiz_user_full_render_exact(self):
        expected = (
            "과목: 자료구조\n"
            "문항 수: 10\n"
            "난이도: 보통\n"
            "문항 유형: 객관식\n"
            "\n강의자료:\n샘플 본문\n"
            "\n"
            "위 조건에 맞는 문제 10개를 JSON 배열로만 출력해."
        )
        assert render_quiz_user(None) == expected

    @pytest.mark.parametrize("template", TEMPLATES)
    def test_summary_checklist_region_exact(self, template):
        # 변경 지점(점검 블록 + 말미)을 줄바꿈까지 정확히 잠근다. tail이 ""이므로 출력은 이 블록으로 끝나야 한다.
        label = prompts.TEMPLATE_LABELS[template]
        expected_tail = (
            "최종 출력 점검:\n"
            f"- {label} 템플릿 지시와 공통 기준만 따라 작성해.\n"
            "- 일반 요약은 정보 보존형 정리본, 강의 노트는 학습 보조형 노트, 치트시트는 시험 직전 압축 암기표로 작성해.\n"
            "- 형광펜 표시(`==...==`)는 5개 이하인지 확인해.\n"
            "- 필요한 텍스트 상자는 '>' 인용문으로만 만들고, HTML aside는 쓰지 마.\n"
            "- 자료 앞뒤에 붙은 앱 UI 문구, 이전 요약 형식, 예시 제목을 출력에 섞지 마.\n"
        )
        assert render_summary_user(template, None).endswith(expected_tail)


# ---------------------------------------------------------------------------
# 10) .format 주입 안전성 — 사용자 focus 텍스트의 중괄호가 재해석/오류를 일으키지 않는다.
# ---------------------------------------------------------------------------
class TestBraceInjectionSafety:
    WEIRD = "{markdown} {} {0} {focus_user_tail} 중괄호테스트"

    def test_summary_focus_braces_literal(self):
        out = render_summary_user("GENERAL", self.WEIRD)
        assert self.WEIRD in out                       # 그대로(리터럴) 들어감
        assert out.count("{markdown}") == 1            # 재포맷 안 됨(placeholder는 이미 치환됨)

    def test_quiz_focus_braces_literal(self):
        out = render_quiz_user(self.WEIRD)
        assert self.WEIRD in out
        assert out.count("{markdown}") == 1            # 템플릿엔 {markdown} 없음 → focus의 1개뿐


# ---------------------------------------------------------------------------
# 11) 퀴즈 USER 측 recency 순서 + 행정정보 가드(요약 tail과 대칭)
# ---------------------------------------------------------------------------
class TestQuizUserSection:
    def test_focus_after_markdown(self):
        out = render_quiz_user(SAMPLE_FOCUS)
        assert out.index("강의자료:") < out.index("[집중 요청")
        assert out.index(SAMPLE_FOCUS) < out.index("위 조건에 맞는")

    def test_user_section_has_admin_guard(self):
        sec = prompts._quiz_user_focus_section(SAMPLE_FOCUS)
        assert "행정 정보" in sec
        assert "집중 요청이라도 출제하지" in sec


# ---------------------------------------------------------------------------
# 12) 엔드포인트 배선 + 진단 게이팅 — focus가 실제로 LLM 메시지에 닿는지,
#     진단 퀴즈에서는 무력화되는지(전 범위 균등 보존)를 가짜 LLM으로 검증.
# ---------------------------------------------------------------------------
class _Msg:
    def __init__(self, content):
        self.content = content


class _CapturingLLM:
    """invoke에 들어온 메시지를 기록하고 유효한 퀴즈 JSON을 돌려주는 가짜 LLM."""
    QUIZ_JSON = '[{"type":"객관식","question":"Q","options":["a","b","c","d"],"answer":0,"explanation":"E"}]'

    def __init__(self):
        self.captured = []

    def invoke(self, messages):
        self.captured.append(messages)
        return _Msg(self.QUIZ_JSON)


def _joined(messages):
    return "\n".join(getattr(m, "content", "") for m in messages)


@pytest.fixture
def quiz_client(monkeypatch):
    main.app.dependency_overrides[main.require_api_user] = lambda: None
    fake = _CapturingLLM()
    monkeypatch.setattr(main, "build_llm", lambda *a, **k: fake)
    client = TestClient(main.app)
    try:
        yield client, fake
    finally:
        main.app.dependency_overrides.clear()


class TestQuizEndpointFocusWiring:
    def test_focus_reaches_llm(self, quiz_client):
        client, fake = quiz_client
        r = client.post("/quiz", json={"subject": "자료구조", "count": 1, "markdown": "본문", "focus_prompt": "트리 위주로"})
        assert r.status_code == 200, r.text
        text = _joined(fake.captured[-1])
        assert "[집중 요청" in text
        assert "트리 위주로" in text

    def test_diagnostic_ignores_focus(self, quiz_client):
        client, fake = quiz_client
        r = client.post("/quiz", json={"subject": "자료구조", "count": 1, "markdown": "본문", "focus_prompt": "트리 위주로만", "diagnostic": True})
        assert r.status_code == 200, r.text
        text = _joined(fake.captured[-1])
        assert "[진단 퀴즈]" in text          # 진단 preamble은 있고
        assert "[집중 요청" not in text       # focus 블록은 무력화
        assert "트리 위주로만" not in text

    def test_no_focus_no_block(self, quiz_client):
        client, fake = quiz_client
        r = client.post("/quiz", json={"subject": "자료구조", "count": 1, "markdown": "본문"})
        assert r.status_code == 200, r.text
        assert "[집중 요청" not in _joined(fake.captured[-1])

    def test_focus_too_long_rejected(self, quiz_client):
        client, _ = quiz_client
        r = client.post("/quiz", json={"subject": "자료구조", "count": 1, "markdown": "본문", "focus_prompt": "가" * 1001})
        assert r.status_code == 422   # schema max_length=1000
