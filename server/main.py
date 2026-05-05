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

from agent import run_study_agent


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

SummaryTemplate = Literal["GENERAL", "LECTURE_NOTE", "MINDMAP"]

TEMPLATE_LABELS: dict[str, str] = {
    "GENERAL": "일반 요약",
    "LECTURE_NOTE": "강의 노트",
    "MINDMAP": "마인드맵",
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
    "MINDMAP": """마인드맵 형식으로 작성해.
- 중심 주제를 가장 먼저 제시해.
- 주요 가지, 하위 가지, 연결 관계 순서로 구조화해.
- 각 가지는 짧은 bullet point로 작성하고, 핵심 개념 간 관계가 보이게 정리해.
- 실제 시각적 마인드맵으로 옮기기 쉽게 계층 구조를 명확히 해.""",
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


@app.get("/health")
def health():
    return {"status": "ok"}
