"""LLM 응답 파싱·검증 + 호출 래퍼 계층.

main.py에서 분리(Stage 6a). LLM 출력(JSON 문자열)을 안전하게 파싱·정규화하고,
6개 엔드포인트가 공유하는 호출/에러 처리 래퍼(_run_llm_call)를 제공한다.
logging.getLogger("tongkk")은 이름이 같으면 동일 로거 인스턴스라 main과 같은 로거를 쓴다.
"""
import json
import logging

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool

from prompts import STUDY_PLAN_MODEL

logger = logging.getLogger("tongkk")


def _message_content_to_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts)
    return str(content)


def _strip_markdown_code_fence(text: str) -> str:
    cleaned = text.strip()
    if "```" not in cleaned:
        return cleaned

    parts = cleaned.split("```")
    if len(parts) >= 3:
        fenced = parts[1].strip()
        if fenced.lower().startswith("json"):
            fenced = fenced[4:].strip()
        return fenced

    return cleaned


def _parse_quiz_json(text: str):
    cleaned = _strip_markdown_code_fence(text)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as original_error:
        start = cleaned.find("[")
        end = cleaned.rfind("]")
        if start < 0 or end <= start:
            raise original_error
        return json.loads(cleaned[start:end + 1])


def _parse_json_object(text: str) -> dict[str, object]:
    cleaned = _strip_markdown_code_fence(text)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as original_error:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise original_error
        parsed = json.loads(cleaned[start:end + 1])

    if not isinstance(parsed, dict):
        raise ValueError("JSON 객체 형식이 아닙니다.")
    return parsed


def _validate_quiz_questions(parsed, question_type: str) -> list[dict[str, object]]:
    questions = parsed.get("questions") if isinstance(parsed, dict) else parsed
    if not isinstance(questions, list) or not questions:
        raise ValueError("퀴즈 응답이 JSON 배열 형식이 아닙니다.")

    result: list[dict[str, object]] = []
    for item in questions:
        if not isinstance(item, dict):
            raise ValueError("퀴즈 문항은 JSON 객체여야 합니다.")

        normalized = dict(item)
        normalized["type"] = normalized.get("type") or question_type
        if normalized["type"] != question_type:
            normalized["type"] = question_type

        if not isinstance(normalized.get("question"), str) or not normalized["question"].strip():
            raise ValueError("퀴즈 문항에 question이 없습니다.")
        if not isinstance(normalized.get("explanation"), str) or not normalized["explanation"].strip():
            raise ValueError("퀴즈 문항에 explanation이 없습니다.")

        if question_type in {"단답형", "주관식"}:
            if not isinstance(normalized.get("answerText"), str) or not normalized["answerText"].strip():
                raise ValueError("서술형 문항에 answerText가 없습니다.")
            normalized.pop("options", None)
            normalized.pop("answer", None)
        else:
            if question_type == "OX":
                normalized["options"] = ["O", "X"]
            if not isinstance(normalized.get("options"), list) or not normalized["options"]:
                raise ValueError("객관식/OX 문항에 options가 없습니다.")
            if not isinstance(normalized.get("answer"), int):
                raise ValueError("객관식/OX 문항에 answer 인덱스가 없습니다.")
            options = normalized["options"]
            answer = normalized["answer"]
            if answer < 0 or answer >= len(options):
                raise ValueError("정답 인덱스가 선택지 범위를 벗어났습니다.")

        result.append(normalized)

    return result


def _validate_study_plan(parsed: dict[str, object]) -> dict[str, object]:
    raw_message = parsed.get("message")
    raw_items = parsed.get("items")
    if not isinstance(raw_items, list):
        raise ValueError("학습 계획 items가 배열 형식이 아닙니다.")

    items: list[dict[str, object]] = []
    for raw_item in raw_items[:12]:
        if not isinstance(raw_item, dict):
            continue
        text = raw_item.get("text")
        if not isinstance(text, str) or not text.strip():
            continue
        raw_minutes = raw_item.get("minutes", 30)
        minutes = raw_minutes if isinstance(raw_minutes, (int, float)) and not isinstance(raw_minutes, bool) else 30
        minutes = max(10, min(90, int(round(minutes / 5) * 5)))
        source_type = raw_item.get("source_type")
        source_id = raw_item.get("source_id")
        action = raw_item.get("action")
        course = raw_item.get("course")
        raw_offset = raw_item.get("day_offset", 0)
        day_offset = raw_offset if isinstance(raw_offset, (int, float)) and not isinstance(raw_offset, bool) else 0
        items.append({
            "text": text.strip()[:80],
            "minutes": minutes,
            "source_id": source_id if isinstance(source_id, str) and source_id else None,
            "source_type": source_type if source_type in {"assignment", "event", "exam", "carryover", "review"} else "assignment",
            "action": action if action in {"retry_quiz", "review_wrong", "review_summary", "read_material", "make_quiz"} else None,
            "course": course.strip()[:60] if isinstance(course, str) and course.strip() else None,
            "day_offset": max(0, min(30, int(day_offset))),
        })

    if not items:
        raise ValueError("생성된 학습 계획 항목이 없습니다.")

    return {
        "model": STUDY_PLAN_MODEL,
        "message": raw_message.strip()[:140] if isinstance(raw_message, str) and raw_message.strip() else "오늘 할 일을 작게 나눠봤어요.",
        "items": items,
    }


def _coerce_str_list(value, limit: int = 4) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            result.append(item.strip()[:160])
        if len(result) >= limit:
            break
    return result


def _validate_wrong_analysis(parsed: dict[str, object]) -> dict[str, object]:
    summary = parsed.get("summary")
    study_method = parsed.get("studyMethod")
    return {
        "summary": summary.strip()[:200] if isinstance(summary, str) and summary.strip() else "오답을 바탕으로 약점을 정리했어요.",
        "weaknesses": _coerce_str_list(parsed.get("weaknesses")),
        "studyPoints": _coerce_str_list(parsed.get("studyPoints")),
        "studyMethod": study_method.strip()[:240] if isinstance(study_method, str) and study_method.strip() else "",
        "memorize": _coerce_str_list(parsed.get("memorize")),
    }


# 6개 LLM 엔드포인트가 공유하던 try/except 사다리를 한 곳에 모은다(동작 불변).
# - RuntimeError(키/모델 설정 누락 등) → 500 + 원문 메시지
# - handle_parse_errors=True(출제·채점·분석 계열): JSONDecodeError → 500 '{label} 파싱 실패',
#   그 외 ValueError(형식 검증 실패) → 500 '{label} 응답 형식 오류'
#   (json.JSONDecodeError가 ValueError 하위라 한 절에서 받아 isinstance로 분기)
# - 그 외 예외, 그리고 파싱 미처리 엔드포인트(summarize·agent)의 파싱/형식 오류 → 502 + 안내문 + 로그
# log_message는 엔드포인트별 기존 문구를 그대로 받아 로그 표현을 보존한다.
async def _run_llm_call(
    call,
    *,
    fail_message: str,
    log_message: str,
    error_label: str = "",
    handle_parse_errors: bool = True,
):
    try:
        return await run_in_threadpool(call)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except (json.JSONDecodeError, ValueError) as e:
        if handle_parse_errors:
            if isinstance(e, json.JSONDecodeError):
                raise HTTPException(status_code=500, detail=f"{error_label} 파싱 실패: {str(e)}") from e
            raise HTTPException(status_code=500, detail=f"{error_label} 응답 형식 오류: {str(e)}") from e
        logger.exception(log_message)
        raise HTTPException(status_code=502, detail=fail_message) from e
    except Exception as e:
        logger.exception(log_message)
        raise HTTPException(status_code=502, detail=fail_message) from e
