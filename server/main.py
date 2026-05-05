import json
import os
import tempfile
from typing import Literal

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from markitdown import MarkItDown
from pydantic import BaseModel, Field

from agent import run_study_agent, build_llm


app = FastAPI()

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
ALLOWED_ORIGINS = [FRONTEND_ORIGIN, "http://localhost:3000", "http://localhost:3001"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

md_converter = MarkItDown()

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
    model: Literal["GPT", "Gemini"] = "GPT"
    markdown: str | None = None


QUIZ_SYSTEM_PROMPT = """너는 대학 강의자료 기반 퀴즈 출제 전문가다.
반드시 순수 JSON 배열만 출력해. 설명, 코드 블록, 마크다운, 기타 텍스트 없이 JSON 배열만 출력해.

출력 형식 (정확히 이 구조):
[{"question":"문제","options":["선택지1","선택지2","선택지3","선택지4"],"answer":0,"explanation":"해설"}]

규칙:
- answer는 정답 선택지의 인덱스 (0~3 정수)
- 각 문항은 반드시 선택지 4개
- 해설은 한 문장으로 간결하게
- JSON 외 어떤 텍스트도 출력 금지"""

QUIZ_USER_PROMPT = """과목: {subject}
문항 수: {count}
난이도: {difficulty}
{markdown_section}
위 조건에 맞는 4지선다 문제 {count}개를 JSON 배열로만 출력해."""


@app.post("/convert")
async def convert_pdf_to_markdown(file: UploadFile = File(...)):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="PDF 파일만 지원합니다.")

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
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
        markdown_section=markdown_section,
    )

    def _call_llm():
        llm = build_llm(req.model)
        from langchain_core.messages import HumanMessage, SystemMessage
        response = llm.invoke([SystemMessage(content=QUIZ_SYSTEM_PROMPT), HumanMessage(content=prompt)])
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
