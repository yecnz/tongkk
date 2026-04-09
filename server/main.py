import asyncio
import os
import tempfile

import httpx
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from markitdown import MarkItDown
from pydantic import BaseModel

app = FastAPI()

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN],
    allow_methods=["*"],
    allow_headers=["*"],
)

md_converter = MarkItDown()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")

SUMMARY_PROMPT = """너는 대학 전공 강의자료를 '시험 대비용'으로 정리하는 조교이다.
목표는 문서의 전체 흐름을 파악하게 하면서도, 시험에 나올 가능성이 높은 세부 항목을 빠뜨리지 않고 정리하는 것이다.

반드시 지켜라.
1. 문서의 대단원/소단원 순서를 유지하라.
2. 원문에 등장하는 열거형 항목(예: n가지 특성, n계층 구조, n가지 구축 방식, n가지 투명성, 종류, 연산, 장단점)은 개수와 항목 이름을 보존하라.
3. 정의, 특징, 구성요소, 종류, 장단점, 비교 항목은 서로 섞지 말고 분리해서 정리하라.
4. 원문에 없는 내용을 추측해서 추가하지 마라.
5. 너무 추상적으로 뭉뚱그리지 말고, 원문에 있는 구체 용어를 유지하라.
6. 한국어 용어 뒤에 영어 용어가 함께 제시된 경우 가능하면 괄호로 함께 적어라.
7. "다양한", "여러 가지" 같은 표현만 쓰고 구체 항목을 생략하지 마라.
8. 시험 직전 복습에 바로 쓸 수 있도록 정리하라.

[출력 형식]
# 전체 흐름
- 문서가 어떤 순서로 전개되는지 4~8개 bullet

# 섹션별 핵심 정리
## 1. [원문 대제목]
- 핵심 정의
- 핵심 설명 3~6개
- 반드시 기억할 세부 항목
- 장점/단점 또는 특징(있으면)
- 비교 대상(있으면)

## 2. [원문 대제목]
- 위와 동일 형식 반복

# 열거형 암기 포인트
- 개수와 항목명을 보존하여 정리

# 비교 포인트
- 비교 대상별 차이점을 표 또는 bullet로 정리
- 비교가 없으면 "없음"

# 시험 직전 체크리스트
- 단답형/서술형으로 나올 수 있는 키워드 10~15개
- 각 키워드는 한 줄 설명 포함

# 한 줄 요약
- 문서 전체를 1~2문장으로 정리"""


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
    prompt_text = f"{SUMMARY_PROMPT}\n\n[강의자료 원문 - Markdown]\n{req.markdown}"

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
