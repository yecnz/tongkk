"""main.py의 순수 헬퍼(파싱·검증·페이지필터)에 대한 특성화 테스트.

거대 main.py를 모듈로 분할(Stage 6a)하기 전에 동작을 고정하는 안전망이다.
LLM·네트워크·파일 IO 없이 순수 입출력만 검증한다.
"""

import json

import pytest

import main


class TestStripMarkdownCodeFence:
    def test_no_fence(self):
        assert main._strip_markdown_code_fence("hello") == "hello"

    def test_json_fence(self):
        assert main._strip_markdown_code_fence('```json\n{"a":1}\n```') == '{"a":1}'

    def test_plain_fence(self):
        assert main._strip_markdown_code_fence("```\n[1,2]\n```") == "[1,2]"


class TestParseQuizJson:
    def test_clean_array(self):
        assert main._parse_quiz_json('[{"a":1}]') == [{"a": 1}]

    def test_array_inside_noise(self):
        assert main._parse_quiz_json("앞 [1,2] 뒤") == [1, 2]

    def test_fenced(self):
        assert main._parse_quiz_json("```json\n[1,2,3]\n```") == [1, 2, 3]

    def test_unparseable_raises(self):
        with pytest.raises(json.JSONDecodeError):
            main._parse_quiz_json("전혀 json 아님")


class TestParseJsonObject:
    def test_object(self):
        assert main._parse_json_object('{"a":1}') == {"a": 1}

    def test_object_inside_noise(self):
        assert main._parse_json_object('머리말 {"a": 2} 꼬리말') == {"a": 2}

    def test_array_is_not_object(self):
        with pytest.raises(ValueError):
            main._parse_json_object("[1,2]")


class TestValidateQuizQuestions:
    def test_multiple_choice_ok(self):
        parsed = {"questions": [
            {"type": "객관식", "question": "Q", "options": ["a", "b", "c", "d"], "answer": 2, "explanation": "E"},
        ]}
        result = main._validate_quiz_questions(parsed, "객관식")
        assert result[0]["answer"] == 2
        assert result[0]["type"] == "객관식"

    def test_ox_forces_options(self):
        parsed = [{"question": "Q", "answer": 1, "explanation": "E"}]
        result = main._validate_quiz_questions(parsed, "OX")
        assert result[0]["options"] == ["O", "X"]

    def test_short_answer_drops_choice_fields(self):
        parsed = [{"question": "Q", "answerText": "답", "explanation": "E", "options": ["x"], "answer": 0}]
        result = main._validate_quiz_questions(parsed, "단답형")
        assert "options" not in result[0]
        assert "answer" not in result[0]
        assert result[0]["answerText"] == "답"

    def test_answer_out_of_range_raises(self):
        parsed = [{"question": "Q", "options": ["a", "b"], "answer": 5, "explanation": "E"}]
        with pytest.raises(ValueError):
            main._validate_quiz_questions(parsed, "객관식")

    def test_empty_raises(self):
        with pytest.raises(ValueError):
            main._validate_quiz_questions({"questions": []}, "객관식")


class TestValidateStudyPlan:
    def test_clamps_and_defaults(self):
        parsed = {
            "message": "  안녕  ",
            "items": [{"text": "공부하기", "minutes": 200, "source_type": "weird", "day_offset": 99}],
        }
        result = main._validate_study_plan(parsed)
        assert result["message"] == "안녕"
        assert result["model"] == main.STUDY_PLAN_MODEL
        item = result["items"][0]
        assert item["minutes"] == 90            # 10~90으로 클램프
        assert item["source_type"] == "assignment"  # 미허용 값 → 기본
        assert item["day_offset"] == 30          # 0~30으로 클램프

    def test_no_valid_items_raises(self):
        with pytest.raises(ValueError):
            main._validate_study_plan({"items": []})

    def test_items_not_list_raises(self):
        with pytest.raises(ValueError):
            main._validate_study_plan({"items": "nope"})


class TestCoerceStrList:
    def test_strips_and_limits(self):
        assert main._coerce_str_list(["  a  ", "b", "c", "d", "e"]) == ["a", "b", "c", "d"]

    def test_non_list(self):
        assert main._coerce_str_list("nope") == []

    def test_skips_blank(self):
        assert main._coerce_str_list(["x", "   ", ""]) == ["x"]


class TestValidateWrongAnalysis:
    def test_defaults_on_empty(self):
        result = main._validate_wrong_analysis({})
        assert result["summary"]            # 기본 안내문
        assert result["weaknesses"] == []
        assert result["studyMethod"] == ""

    def test_passthrough(self):
        parsed = {
            "summary": "요약",
            "weaknesses": ["w1", "w2"],
            "studyMethod": "방법",
            "studyPoints": ["p"],
            "memorize": ["m"],
        }
        result = main._validate_wrong_analysis(parsed)
        assert result["summary"] == "요약"
        assert result["weaknesses"] == ["w1", "w2"]
        assert result["studyMethod"] == "방법"


class TestMessageContentToText:
    def test_str(self):
        assert main._message_content_to_text("hi") == "hi"

    def test_list_of_dicts(self):
        assert main._message_content_to_text([{"text": "a"}, {"text": "b"}]) == "a\nb"

    def test_list_mixed(self):
        assert main._message_content_to_text(["x", {"nope": 1}]) == "x"


class TestQuizFormatInstruction:
    def test_ox(self):
        assert '["O","X"]' in main.quiz_format_instruction("OX")

    def test_short_answer(self):
        assert "answerText" in main.quiz_format_instruction("단답형")

    def test_default_is_multiple_choice(self):
        assert "선택지 4개" in main.quiz_format_instruction("객관식")


class TestParsePageSelection:
    def test_ranges_and_singletons(self):
        assert main._parse_page_selection("1-3, 5, 8-8") == {1, 2, 3, 5, 8}

    def test_reversed_range_is_normalized(self):
        assert main._parse_page_selection("5-3") == {3, 4, 5}

    def test_invalid_tokens_ignored(self):
        assert main._parse_page_selection("abc, 2") == {2}


class TestFilterMarkdownByPages:
    MD = "<!-- p.1 -->\npage one\n<!-- p.2 -->\npage two\n<!-- p.3 -->\npage three"

    def test_no_spec_returns_original(self):
        assert main._filter_markdown_by_pages(self.MD, None) == self.MD

    def test_selects_only_chosen_page(self):
        out = main._filter_markdown_by_pages(self.MD, "2")
        assert "page two" in out
        assert "page one" not in out
        assert "page three" not in out

    def test_no_markers_returns_original(self):
        plain = "마커 없는 본문"
        assert main._filter_markdown_by_pages(plain, "1") == plain

    def test_unmatched_selection_returns_original(self):
        # 선택 페이지가 자료에 하나도 없으면 빈 요약 방지로 원본을 그대로 쓴다.
        assert main._filter_markdown_by_pages(self.MD, "99") == self.MD
