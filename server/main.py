import json
import os
import tempfile
from pathlib import Path
from typing import Literal

import httpx
from dotenv import load_dotenv

SERVER_DIR = Path(__file__).resolve().parent

load_dotenv(SERVER_DIR / ".env")

from fastapi import Depends, FastAPI, Header, HTTPException, UploadFile, File
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from markitdown import MarkItDown
from pydantic import BaseModel, Field

from agent import run_study_agent, build_llm


app = FastAPI()

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
ALLOWED_ORIGINS = [FRONTEND_ORIGIN, "http://localhost:3000", "http://localhost:3001"]
ALLOWED_ORIGIN_REGEX = r"https://.*\.trycloudflare\.com"
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_PLACEHOLDER_VALUES = {
    "https://your-project.supabase.co",
    "your-supabase-url",
}

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_methods=["*"],
    allow_headers=["*"],
)

md_converter = MarkItDown()


async def require_api_user(authorization: str | None = Header(default=None)):
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        return None
    if SUPABASE_URL in SUPABASE_PLACEHOLDER_VALUES:
        raise HTTPException(status_code=503, detail="백엔드 Supabase URL이 실제 프로젝트 주소로 설정되지 않았습니다.")

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="로그인이 필요한 API입니다.")

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="인증 토큰이 비어 있습니다.")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={
                    "apikey": SUPABASE_ANON_KEY,
                    "Authorization": f"Bearer {token}",
                },
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"인증 서버 확인 실패: {str(e)}") from e

    if response.status_code >= 400:
        raise HTTPException(status_code=401, detail="유효하지 않은 로그인입니다.")

    return response.json()

SummaryTemplate = Literal["GENERAL", "LECTURE_NOTE", "MINDMAP", "CHEAT_SHEET"]

TEMPLATE_LABELS: dict[str, str] = {
    "GENERAL": "일반 요약",
    "LECTURE_NOTE": "강의 노트",
    "MINDMAP": "마인드맵",
    "CHEAT_SHEET": "치트시트",
}

TEMPLATE_INSTRUCTIONS: dict[str, str] = {
    "GENERAL": """일반 요약 형식으로 작성해.
- 제목, 핵심 결론, 주요 내용, 중요 키워드, 한 줄 요약 순서로 구성해.
- 전체 내용을 처음 보는 사람도 빠르게 이해할 수 있게 간결하게 정리해.
- 세부 설명보다 핵심 흐름과 결론을 우선해.""",
    "LECTURE_NOTE": """강의 노트 형식으로 작성해.
- 제목, 학습 목표, 전체 흐름, 핵심 개념, 세부 설명, 시험 포인트, 복습 질문 순서로 구성해.
- 강의자가 설명하듯 자연스럽고 읽기 쉬운 문장으로 정리해.
- 원문의 대단원/소단원 순서를 최대한 유지해.""",
    "MINDMAP": """강의자료의 핵심 구조를 JSON으로만 출력해. 공통 기준은 무시하고 아래 형식만 따라.

출력 형식 (순수 JSON만, 코드 블록·설명 없이):
{"root": "중심 주제", "children": [{"label": "가지", "children": [{"label": "하위 항목", "children": []}]}]}

규칙:
- root: 강의 핵심 주제 (15자 이내)
- 주요 가지: 5~8개 (대단원 기준)
- 각 가지에 하위 항목 2~4개
- 최대 2단계 깊이 (root → children → children)
- label은 15자 이내로 간결하게
- JSON 외 텍스트·마크다운·코드 블록 절대 금지""",
    "CHEAT_SHEET": """치트시트 형식으로 작성해.
- 시험 직전 빠르게 훑을 수 있는 압축 암기표로 구성해.
- 핵심 공식, 정의, 비교, 조건, 예외, 암기 포인트를 짧은 bullet point로 정리해.
- 중요한 용어는 반드시 **굵게** 표시해.
- 긴 문단보다 한 줄 설명과 비교형 bullet을 우선해.
- 원문에 있는 열거형 항목은 빠뜨리지 말고 개수와 항목명을 보존해.""",
}

SUMMARY_USER_PROMPT = """업로드한 강의자료를 {template_label} 템플릿으로 요약해줘.

템플릿 지시:
{template_instruction}

공통 기준:
1. 문서의 대단원/소단원 순서를 유지해.
2. 열거형 항목은 개수와 항목명을 보존해.
3. 정의, 특징, 구성요소, 종류, 장단점, 비교 항목을 분리해.
4. 원문에 없는 내용을 추가하지 마.
5. 시험 직전 복습에 바로 쓸 수 있게 정리해.
6. 화면 가독성을 위해 핵심 용어는 **굵게** 표시하고, 세부 내용은 bullet point로 정리해.

[강의자료]
{markdown}
"""


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class SummarizeRequest(BaseModel):
    markdown: str = Field(min_length=1)
    template: SummaryTemplate = "GENERAL"
    model: Literal["GPT", "Gemini"] = "GPT"
    thread_id: str | None = None


class AgentRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)
    model: Literal["GPT", "Gemini"] = "GPT"
    thread_id: str | None = None
    markdown: str | None = None


class QuizRequest(BaseModel):
    subject: str = Field(min_length=1)
    count: int = Field(default=10, ge=1, le=30)
    difficulty: Literal["쉬움", "보통", "어려움"] = "보통"
    question_type: Literal["객관식", "OX", "단답형", "주관식"] = "객관식"
    model: Literal["GPT", "Gemini"] = "GPT"
    markdown: str | None = None


class SubjectiveGradeRequest(BaseModel):
    question: str = Field(min_length=1)
    reference_answer: str = Field(min_length=1)
    student_answer: str = Field(min_length=1)
    model: Literal["GPT", "Gemini"] = "GPT"
    markdown: str | None = None


MaterialKind = Literal["pdf", "ppt", "img", "file"]


QUIZ_SYSTEM_PROMPT = """너는 대학 강의자료 기반 퀴즈 출제 전문가다.
반드시 순수 JSON 배열만 출력해. 설명, 코드 블록, 마크다운, 기타 텍스트 없이 JSON 배열만 출력해.

공통 규칙:
- 각 문항은 question, type, explanation을 포함한다.
- explanation은 한 문장으로 간결하게 작성한다.
- 자료가 있으면 자료에 나온 정의, 비교, 열거형 항목, 장단점을 우선 출제한다.
- 자료에 없는 사실을 정답 근거로 쓰지 않는다.
- JSON 외 어떤 텍스트도 출력 금지"""

QUIZ_USER_PROMPT = """과목: {subject}
문항 수: {count}
난이도: {difficulty}
문항 유형: {question_type}
{markdown_section}
위 조건에 맞는 문제 {count}개를 JSON 배열로만 출력해."""


def quiz_format_instruction(question_type: str) -> str:
    if question_type == "OX":
        return """출력 형식 (정확히 이 구조):
[{"type":"OX","question":"문제","options":["O","X"],"answer":0,"explanation":"해설"}]

OX 규칙:
- options는 반드시 ["O","X"]로 고정한다.
- answer는 정답 선택지의 인덱스다. O가 정답이면 0, X가 정답이면 1."""

    if question_type == "단답형":
        return """출력 형식 (정확히 이 구조):
[{"type":"단답형","question":"문제","answerText":"정답","explanation":"해설"}]

단답형 규칙:
- options와 answer 필드는 넣지 않는다.
- answerText는 사용자가 직접 입력할 짧은 정답이다.
- answerText는 핵심 용어 또는 짧은 구문으로 작성한다."""

    if question_type == "주관식":
        return """출력 형식 (정확히 이 구조):
[{"type":"주관식","question":"문제","answerText":"모범답안","explanation":"채점 기준과 해설"}]

주관식 규칙:
- options와 answer 필드는 넣지 않는다.
- question은 개념 설명, 비교, 원인/결과, 적용 과정을 서술하게 만든다.
- answerText는 채점 기준으로 사용할 수 있는 2~4문장의 모범답안으로 작성한다.
- explanation에는 핵심 채점 포인트를 간결하게 포함한다."""

    return """출력 형식 (정확히 이 구조):
[{"type":"객관식","question":"문제","options":["선택지1","선택지2","선택지3","선택지4"],"answer":0,"explanation":"해설"}]

객관식 규칙:
- options는 반드시 선택지 4개다.
- answer는 정답 선택지의 인덱스다. 0~3 정수로 작성한다."""


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


SUPPORTED_CONVERT_EXTENSIONS = {".pdf", ".ppt", ".pptx"}


@app.post("/convert")
async def convert_document_to_markdown(
    file: UploadFile = File(...),
    _user=Depends(require_api_user),
):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in SUPPORTED_CONVERT_EXTENSIONS:
        raise HTTPException(status_code=400, detail="PDF, PPT, PPTX 파일만 지원합니다.")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        result = await run_in_threadpool(md_converter.convert, tmp_path)
        return {"markdown": result.text_content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"변환 실패: {str(e)}") from e
    finally:
        os.unlink(tmp_path)


@app.post("/summarize")
async def summarize(req: SummarizeRequest, _user=Depends(require_api_user)):
    messages = [
        {
            "role": "user",
            "content": SUMMARY_USER_PROMPT.format(
                template_label=TEMPLATE_LABELS[req.template],
                template_instruction=TEMPLATE_INSTRUCTIONS[req.template],
                markdown=req.markdown,
            ),
        }
    ]
    try:
        return await run_in_threadpool(run_study_agent, req.model, messages, req.thread_id)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Agent 실행 실패: {str(e)}") from e


@app.post("/agent")
async def agent(req: AgentRequest, _user=Depends(require_api_user)):
    messages = [message.model_dump() for message in req.messages]
    if req.markdown:
        messages.insert(
            0,
            {
                "role": "user",
                "content": f"다음 강의자료를 현재 대화의 참고 자료로 사용해.\n\n[강의자료]\n{req.markdown}",
            },
        )

    try:
        return await run_in_threadpool(run_study_agent, req.model, messages, req.thread_id)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Agent 실행 실패: {str(e)}") from e


@app.post("/quiz")
async def generate_quiz(req: QuizRequest, _user=Depends(require_api_user)):
    markdown_section = f"\n강의자료:\n{req.markdown}\n" if req.markdown else ""
    prompt = QUIZ_USER_PROMPT.format(
        subject=req.subject,
        count=req.count,
        difficulty=req.difficulty,
        question_type=req.question_type,
        markdown_section=markdown_section,
    )

    def _call_llm():
        llm = build_llm(req.model)
        from langchain_core.messages import HumanMessage, SystemMessage
        response = llm.invoke([
            SystemMessage(content=f"{QUIZ_SYSTEM_PROMPT}\n\n{quiz_format_instruction(req.question_type)}"),
            HumanMessage(content=prompt),
        ])
        text = _message_content_to_text(response.content)
        parsed = _parse_quiz_json(text)
        return _validate_quiz_questions(parsed, req.question_type)

    try:
        questions = await run_in_threadpool(_call_llm)
        return {"questions": questions}
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"퀴즈 파싱 실패: {str(e)}") from e
    except ValueError as e:
        raise HTTPException(status_code=500, detail=f"퀴즈 응답 형식 오류: {str(e)}") from e
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"퀴즈 생성 실패: {str(e)}") from e


@app.post("/quiz/grade-subjective")
async def grade_subjective_answer(req: SubjectiveGradeRequest, _user=Depends(require_api_user)):
    markdown_section = f"\n[강의자료]\n{req.markdown}\n" if req.markdown else ""
    prompt = f"""아래 주관식 답안을 채점해.

[문제]
{req.question}

[모범답안]
{req.reference_answer}

[학생 답안]
{req.student_answer}
{markdown_section}
출력은 순수 JSON 객체만 사용해.
형식:
{{"score": 0부터 100까지 정수, "is_correct": true 또는 false, "feedback": "학생에게 줄 짧은 피드백", "reference_answer": "보완된 모범답안"}}

채점 기준:
- 핵심 개념이 맞으면 표현이 달라도 인정한다.
- 자료와 모범답안에 없는 사실을 학생 답안의 정답 근거로 추가하지 않는다.
- 70점 이상이면 is_correct를 true로 둔다.
- feedback은 부족한 부분과 다음 복습 포인트를 2문장 이내로 알려준다."""

    def _call_llm():
        llm = build_llm(req.model)
        from langchain_core.messages import HumanMessage, SystemMessage
        response = llm.invoke([
            SystemMessage(content="너는 대학 강의 주관식 답안을 공정하게 채점하는 튜터다. 반드시 순수 JSON 객체만 출력한다."),
            HumanMessage(content=prompt),
        ])
        parsed = _parse_json_object(_message_content_to_text(response.content))
        raw_score = parsed.get("score", 0)
        score = raw_score if isinstance(raw_score, (int, float)) and not isinstance(raw_score, bool) else 0
        score = max(0, min(100, int(round(score))))
        raw_is_correct = parsed.get("is_correct")
        feedback = parsed.get("feedback")
        reference_answer = parsed.get("reference_answer")
        return {
            "score": score,
            "is_correct": raw_is_correct if isinstance(raw_is_correct, bool) else score >= 70,
            "feedback": feedback if isinstance(feedback, str) and feedback.strip() else "채점 결과를 확인했습니다.",
            "reference_answer": reference_answer if isinstance(reference_answer, str) and reference_answer.strip() else req.reference_answer,
        }

    try:
        return await run_in_threadpool(_call_llm)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"주관식 채점 파싱 실패: {str(e)}") from e
    except ValueError as e:
        raise HTTPException(status_code=500, detail=f"주관식 채점 응답 형식 오류: {str(e)}") from e
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"주관식 채점 실패: {str(e)}") from e


@app.get("/health")
def health():
    return {"status": "ok"}
