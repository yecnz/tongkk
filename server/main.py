import asyncio
import os
import tempfile

from dotenv import load_dotenv
load_dotenv()

import httpx
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from markitdown import MarkItDown
from pydantic import BaseModel

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

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite-preview")

SUMMARY_PROMPT = """다음 [내용]을 입력받아 아래 작업을 순서대로 수행해.

1) 제목
콘텐츠 제목

2) 키워드
핵심 키워드를 추출

3) 브리프
50자 이내로 브리프 작성

4) 구성
내용 흐름을 분석해서 구성 목차를 간결하게 리스트업

5) 전체 요약
전체글을 요약
  - 중요 내용을 빠짐없이 포함
  - 250자 이내로 정리

6) 용어설명
새로운 용어가 있으면 볼드체로 표기하고 요약문 끝에 용어 설명 추가

전문용어 외에는 한국어로 답변해줘. 입력된 내용에 없는 것은 추가하지 말 것.

[내용]"""


@app.post("/convert")
async def convert_pdf_to_markdown(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="PDF 파일만 지원합니다.")

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        result = md_converter.convert(tmp_path)
        return {"markdown": result.text_content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"변환 실패: {str(e)}")
    finally:
        os.unlink(tmp_path)


class SummarizeRequest(BaseModel):
    model: str  # "GPT" | "Gemini"
    markdown: str


@app.post("/summarize")
async def summarize(req: SummarizeRequest):
    prompt_text = f"{SUMMARY_PROMPT}\n{req.markdown}"

    if req.model == "GPT":
        if not OPENAI_API_KEY:
            raise HTTPException(status_code=500, detail="서버에 OPENAI_API_KEY가 설정되지 않았습니다.")
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                },
                json={
                    "model": "gpt-4o-mini",
                    "messages": [{"role": "user", "content": prompt_text}],
                    "max_tokens": 2048,
                    "temperature": 0.3,
                },
            )
        if not response.is_success:
            detail = response.json().get("error", {}).get("message", f"OpenAI API 오류 ({response.status_code})")
            raise HTTPException(status_code=502, detail=detail)
        data = response.json()
        choices = data.get("choices") or []
        if not choices:
            raise HTTPException(status_code=502, detail="OpenAI가 빈 응답을 반환했습니다.")
        return {"result": choices[0]["message"]["content"]}

    elif req.model == "Gemini":
        if not GEMINI_API_KEY:
            raise HTTPException(status_code=500, detail="서버에 GEMINI_API_KEY가 설정되지 않았습니다.")
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
        max_retries = 3
        response = None
        async with httpx.AsyncClient(timeout=120) as client:
            for attempt in range(1, max_retries + 1):
                response = await client.post(
                    url,
                    headers={"Content-Type": "application/json"},
                    json={
                        "contents": [{"parts": [{"text": prompt_text}]}],
                        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 2048},
                    },
                )
                if response.status_code == 503 and attempt < max_retries:
                    await asyncio.sleep(2 * attempt)
                    continue
                break

        if not response.is_success:
            detail = response.json().get("error", {}).get("message", f"Gemini API 오류 ({response.status_code})")
            raise HTTPException(status_code=502, detail=detail)
        data = response.json()
        candidates = data.get("candidates") or []
        if not candidates or not candidates[0].get("content", {}).get("parts"):
            raise HTTPException(status_code=502, detail="Gemini가 빈 응답을 반환했습니다. (안전 필터 차단 가능성)")
        return {"result": candidates[0]["content"]["parts"][0]["text"]}

    else:
        raise HTTPException(status_code=400, detail=f"지원하지 않는 모델입니다: {req.model}")


@app.get("/health")
def health():
    return {"status": "ok"}
