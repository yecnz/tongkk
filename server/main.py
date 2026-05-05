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

SUMMARY_USER_PROMPT = """업로드한 강의자료를 시험 대비용으로 요약해줘.

다음 기준을 지켜줘.
1. 문서의 대단원/소단원 순서를 유지해.
2. 열거형 항목은 개수와 항목명을 보존해.
3. 정의, 특징, 구성요소, 종류, 장단점, 비교 항목을 분리해.
4. 원문에 없는 내용을 추가하지 마.
5. 시험 직전 복습에 바로 쓸 수 있게 정리해.

[강의자료]
{markdown}
"""


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class SummarizeRequest(BaseModel):
    model: Literal["GPT", "Gemini"]
    markdown: str = Field(min_length=1)
    thread_id: str | None = None


class AgentRequest(BaseModel):
    model: Literal["GPT", "Gemini"]
    messages: list[ChatMessage] = Field(min_length=1)
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
            "content": SUMMARY_USER_PROMPT.format(markdown=req.markdown),
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
