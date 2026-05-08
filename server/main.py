import json
import os
import sqlite3
import tempfile
import time
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv

SERVER_DIR = Path(__file__).resolve().parent

load_dotenv(SERVER_DIR / ".env")

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from markitdown import MarkItDown
from pydantic import BaseModel, Field

from agent import run_study_agent, build_llm
from storage import (
    create_course,
    create_material,
    create_quiz_set,
    delete_course,
    delete_material,
    delete_quiz_set,
    delete_summary,
    get_course,
    init_db,
    list_courses,
    list_materials,
    list_quiz_sets,
    list_summaries,
    update_course_name,
    upsert_summary,
)


app = FastAPI()

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
ALLOWED_ORIGINS = [FRONTEND_ORIGIN, "http://localhost:3000", "http://localhost:3001"]
ALLOWED_ORIGIN_REGEX = r"https://.*\.trycloudflare\.com"

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_methods=["*"],
    allow_headers=["*"],
)

md_converter = MarkItDown()


@app.on_event("startup")
def startup() -> None:
    init_db()

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
    question_type: Literal["객관식", "OX", "단답형"] = "객관식"
    model: Literal["GPT", "Gemini"] = "GPT"
    markdown: str | None = None


MaterialKind = Literal["pdf", "ppt", "img", "file"]


class CourseCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class CourseUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class CourseResponse(BaseModel):
    id: str
    name: str
    created_at: int = Field(alias="createdAt")
    updated_at: int = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class MaterialCreateRequest(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1, max_length=255)
    size: int | None = Field(default=None, ge=0)
    type: MaterialKind
    pages: int | None = Field(default=None, ge=0)
    slides: int | None = Field(default=None, ge=0)
    markdown: str = Field(min_length=1)


class MaterialResponse(BaseModel):
    id: str
    course_id: str = Field(alias="courseId")
    name: str
    size: int | None
    type: MaterialKind
    pages: int | None
    slides: int | None
    markdown: str
    created_at: int = Field(alias="createdAt")
    updated_at: int = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class SummaryCreateRequest(BaseModel):
    template: SummaryTemplate
    content: str = Field(min_length=1)
    material_ids: list[str] = Field(default_factory=list, alias="materialIds")

    model_config = {"populate_by_name": True}


class SummaryResponse(BaseModel):
    id: str
    course_id: str = Field(alias="courseId")
    template: SummaryTemplate
    content: str
    material_ids: list[str] = Field(alias="materialIds")
    created_at: int = Field(alias="createdAt")
    updated_at: int = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class QuizSetCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    difficulty: Literal["쉬움", "보통", "어려움"]
    question_type: Literal["객관식", "OX", "단답형"] = Field(alias="questionType")
    count: int = Field(ge=1, le=30)
    material_ids: list[str] = Field(default_factory=list, alias="materialIds")
    questions: list[dict[str, object]] = Field(min_length=1)

    model_config = {"populate_by_name": True}


class QuizSetResponse(BaseModel):
    id: str
    course_id: str = Field(alias="courseId")
    title: str
    difficulty: Literal["쉬움", "보통", "어려움"]
    question_type: Literal["객관식", "OX", "단답형"] = Field(alias="questionType")
    count: int
    material_ids: list[str] = Field(alias="materialIds")
    questions: list[dict[str, object]]
    created_at: int = Field(alias="createdAt")
    updated_at: int = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


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

    return """출력 형식 (정확히 이 구조):
[{"type":"객관식","question":"문제","options":["선택지1","선택지2","선택지3","선택지4"],"answer":0,"explanation":"해설"}]

객관식 규칙:
- options는 반드시 선택지 4개다.
- answer는 정답 선택지의 인덱스다. 0~3 정수로 작성한다."""


SUPPORTED_CONVERT_EXTENSIONS = {".pdf", ".ppt", ".pptx"}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _json_list(value: str) -> list:
    parsed = json.loads(value)
    return parsed if isinstance(parsed, list) else []


def _summary_for_response(summary: dict) -> dict:
    return {
        **summary,
        "material_ids": _json_list(summary["material_ids"]),
    }


def _quiz_set_for_response(quiz_set: dict) -> dict:
    return {
        **quiz_set,
        "material_ids": _json_list(quiz_set["material_ids"]),
        "questions": _json_list(quiz_set["questions"]),
    }


@app.get("/courses", response_model=list[CourseResponse])
def get_courses():
    return list_courses()


@app.post("/courses", response_model=CourseResponse, status_code=201)
def post_course(req: CourseCreateRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="과목명을 입력해주세요.")

    try:
        return create_course(name, _now_ms())
    except sqlite3.IntegrityError as e:
        raise HTTPException(status_code=409, detail="이미 존재하는 과목명입니다.") from e


@app.get("/courses/{course_id}", response_model=CourseResponse)
def get_course_by_id(course_id: str):
    course = get_course(course_id)
    if course is None:
        raise HTTPException(status_code=404, detail="과목을 찾을 수 없습니다.")
    return course


@app.patch("/courses/{course_id}", response_model=CourseResponse)
def patch_course(course_id: str, req: CourseUpdateRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="과목명을 입력해주세요.")

    try:
        course = update_course_name(course_id, name, _now_ms())
    except sqlite3.IntegrityError as e:
        raise HTTPException(status_code=409, detail="이미 존재하는 과목명입니다.") from e

    if course is None:
        raise HTTPException(status_code=404, detail="과목을 찾을 수 없습니다.")
    return course


@app.delete("/courses/{course_id}", status_code=204)
def delete_course_by_id(course_id: str):
    if not delete_course(course_id):
        raise HTTPException(status_code=404, detail="과목을 찾을 수 없습니다.")
    return None


@app.get("/courses/{course_id}/materials", response_model=list[MaterialResponse])
def get_course_materials(course_id: str):
    if get_course(course_id) is None:
        raise HTTPException(status_code=404, detail="과목을 찾을 수 없습니다.")
    return list_materials(course_id)


@app.post("/courses/{course_id}/materials", response_model=MaterialResponse, status_code=201)
def post_course_material(course_id: str, req: MaterialCreateRequest):
    if get_course(course_id) is None:
        raise HTTPException(status_code=404, detail="과목을 찾을 수 없습니다.")

    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="자료명을 입력해주세요.")

    return create_material(
        material_id=req.id,
        course_id=course_id,
        name=name,
        size=req.size,
        material_type=req.type,
        pages=req.pages,
        slides=req.slides,
        markdown=req.markdown,
        now_ms=_now_ms(),
    )


@app.delete("/materials/{material_id}", status_code=204)
def delete_material_by_id(material_id: str):
    if not delete_material(material_id):
        raise HTTPException(status_code=404, detail="자료를 찾을 수 없습니다.")
    return None


@app.get("/courses/{course_id}/summaries", response_model=list[SummaryResponse])
def get_course_summaries(course_id: str):
    if get_course(course_id) is None:
        raise HTTPException(status_code=404, detail="과목을 찾을 수 없습니다.")
    return [_summary_for_response(summary) for summary in list_summaries(course_id)]


@app.post("/courses/{course_id}/summaries", response_model=SummaryResponse, status_code=201)
def post_course_summary(course_id: str, req: SummaryCreateRequest):
    if get_course(course_id) is None:
        raise HTTPException(status_code=404, detail="과목을 찾을 수 없습니다.")

    summary = upsert_summary(
        course_id=course_id,
        template=req.template,
        content=req.content,
        material_ids=json.dumps(sorted(req.material_ids), ensure_ascii=False),
        now_ms=_now_ms(),
    )
    return _summary_for_response(summary)


@app.delete("/summaries/{summary_id}", status_code=204)
def delete_summary_by_id(summary_id: str):
    if not delete_summary(summary_id):
        raise HTTPException(status_code=404, detail="요약을 찾을 수 없습니다.")
    return None


@app.get("/courses/{course_id}/quiz-sets", response_model=list[QuizSetResponse])
def get_course_quiz_sets(course_id: str):
    if get_course(course_id) is None:
        raise HTTPException(status_code=404, detail="과목을 찾을 수 없습니다.")
    return [_quiz_set_for_response(quiz_set) for quiz_set in list_quiz_sets(course_id)]


@app.post("/courses/{course_id}/quiz-sets", response_model=QuizSetResponse, status_code=201)
def post_course_quiz_set(course_id: str, req: QuizSetCreateRequest):
    if get_course(course_id) is None:
        raise HTTPException(status_code=404, detail="과목을 찾을 수 없습니다.")

    quiz_set = create_quiz_set(
        course_id=course_id,
        title=req.title.strip(),
        difficulty=req.difficulty,
        question_type=req.question_type,
        count=req.count,
        material_ids=json.dumps(sorted(req.material_ids), ensure_ascii=False),
        questions=json.dumps(req.questions, ensure_ascii=False),
        now_ms=_now_ms(),
    )
    return _quiz_set_for_response(quiz_set)


@app.delete("/quiz-sets/{quiz_set_id}", status_code=204)
def delete_quiz_set_by_id(quiz_set_id: str):
    if not delete_quiz_set(quiz_set_id):
        raise HTTPException(status_code=404, detail="퀴즈를 찾을 수 없습니다.")
    return None


@app.post("/convert")
async def convert_document_to_markdown(file: UploadFile = File(...)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in SUPPORTED_CONVERT_EXTENSIONS:
        raise HTTPException(status_code=400, detail="PDF, PPT, PPTX 파일만 지원합니다.")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        result = md_converter.convert(tmp_path)
        return {"markdown": result.text_content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"변환 실패: {str(e)}") from e
    finally:
        os.unlink(tmp_path)


@app.post("/summarize")
async def summarize(req: SummarizeRequest):
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
async def agent(req: AgentRequest):
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
async def generate_quiz(req: QuizRequest):
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
        text = response.content if isinstance(response.content, str) else str(response.content)
        # strip markdown code fences if present
        text = text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text.strip())

    try:
        questions = await run_in_threadpool(_call_llm)
        return {"questions": questions}
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"퀴즈 파싱 실패: {str(e)}") from e
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"퀴즈 생성 실패: {str(e)}") from e


@app.get("/health")
def health():
    return {"status": "ok"}
