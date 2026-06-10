import json
import logging
import os
import re
import base64
import zipfile
import shutil
import subprocess
import tempfile
from pathlib import Path
from datetime import date
from typing import Literal

import httpx
from dotenv import load_dotenv

SERVER_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SERVER_DIR.parent

load_dotenv(PROJECT_DIR / ".env")
load_dotenv(SERVER_DIR / ".env")

from fastapi import Depends, FastAPI, Header, HTTPException, UploadFile, File
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from langchain_core.messages import HumanMessage, SystemMessage
from markitdown import MarkItDown
from pydantic import BaseModel, Field

from agent import run_study_agent, build_llm, build_openai_llm


app = FastAPI()

logger = logging.getLogger("tongkk")

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
ALLOWED_ORIGINS = [
    FRONTEND_ORIGIN,
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://localhost:3000",
    "http://localhost:3001",
]
ALLOWED_ORIGIN_REGEX = r"https://.*\.trycloudflare\.com"
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
GOOGLE_VISION_API_KEY = os.getenv("GOOGLE_VISION_API_KEY", "")
SUPABASE_PLACEHOLDER_VALUES = {
    "https://your-project.supabase.co",
    "your-supabase-url",
}
# 인증 비활성화는 명시적으로 켤 때만 허용한다(개발용). 운영에서 Supabase 설정이 빠지면
# 조용히 무인증으로 열리는 대신 503으로 막아(fail-closed) 배포 사고를 즉시 드러낸다.
ALLOW_NO_AUTH = os.getenv("ALLOW_NO_AUTH", "").strip().lower() in {"1", "true", "yes", "on"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_methods=["*"],
    allow_headers=["*"],
)

md_converter = MarkItDown()


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


VISUAL_ANALYSIS_MODE = os.getenv("VISUAL_ANALYSIS_MODE", "auto").lower()
VISUAL_ANALYSIS_MAX_ITEMS = _env_int("VISUAL_ANALYSIS_MAX_ITEMS", 12)
VISUAL_ANALYSIS_BATCH_SIZE = max(1, _env_int("VISUAL_ANALYSIS_BATCH_SIZE", 4))
VISUAL_ANALYSIS_MIN_TEXT_CHARS = _env_int("VISUAL_ANALYSIS_MIN_TEXT_CHARS", 1200)
PDF_VISUAL_RENDER_DPI = _env_int("PDF_VISUAL_RENDER_DPI", 90)
PDF_VISUAL_TEXT_PAGE_CHARS = _env_int("PDF_VISUAL_TEXT_PAGE_CHARS", 180)
PPTX_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}

# 요약 출력 토큰 한도. 기본 8192로는 긴 강의자료(예: 100p+) 요약이 중간에 잘리므로 넉넉히 둔다.
# gpt-5.4-mini 출력 하드 상한은 128000이라 32768은 안전한 헤드룸(약 300p+ 커버).
SUMMARY_MAX_TOKENS = _env_int("SUMMARY_MAX_TOKENS", 32768)

# 요청 본문 입력 길이 상한(문자 수). 과도한 입력으로 인한 LLM 비용 폭증·메모리 남용을 막는다.
MAX_MARKDOWN_CHARS = _env_int("MAX_MARKDOWN_CHARS", 2_000_000)
MAX_CHAT_CONTENT_CHARS = _env_int("MAX_CHAT_CONTENT_CHARS", 100_000)
MAX_CHAT_MESSAGES = _env_int("MAX_CHAT_MESSAGES", 100)


async def require_api_user(authorization: str | None = Header(default=None)):
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        if ALLOW_NO_AUTH:
            return None
        raise HTTPException(
            status_code=503,
            detail="서버 인증 설정(SUPABASE_URL/SUPABASE_ANON_KEY)이 누락되었습니다.",
        )
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
    "GENERAL": """자료 정리본 형식으로 작성해.
- 목표는 학습 조언이 아니라 원문 내용을 최대한 많이 보존하면서 깔끔하게 정돈하는 것이다.
- 원문의 대단원/소단원 구조와 흐름을 가능한 유지해.
- 원문 정보량을 많이 담되, 중복 표현과 불필요한 반복만 줄여.
- 정의, 특징, 종류, 방법, 주의사항, 공식, 수치, 단위를 분리해서 정리해.
- 긴 문단은 짧은 문단이나 bullet list로 바꾸되, 세부 내용은 과하게 삭제하지 마.
- 분류 체계나 방법 종류가 많으면 코드블록 구조도(tree)를 사용해 눈으로 흐름이 보이게 정리해.
- 절차나 주의사항처럼 따로 묶어야 하는 내용은 '>' 인용문을 사용해 텍스트 상자로 정리해.
- 원문이 비교 구조일 때만 표를 사용하고, 비교표를 억지로 만들지 마.
- 시험 포인트, 헷갈림 주의, 핵심 암기 사항, 복습 질문, 학습 조언 섹션은 만들지 마.
- 제목별 카드 구조는 만들지 마. 텍스트 상자는 꼭 강조가 필요한 부분에만 사용해.""",
    "LECTURE_NOTE": """학습 보조형 강의 노트로 작성해.
- 목표는 사용자가 공부하기 쉽게 핵심 개념, 흐름, 용어 설명, 중요 내용, 시험 포인트, 암기 사항을 재구성하는 것이다.
- 단순 정리본처럼 모든 내용을 같은 밀도로 나열하지 말고, 중요도와 개념 간 관계가 드러나게 정리해.
- 권장 흐름은 '# 강의 제목' → '## 한눈에 보는 흐름' → '## 핵심 개념' → '## 방법/절차' → '## 주요 용어' → '## 시험 포인트' → '## 핵심 암기 사항' → '## 참고/주의 사항'이다. 자료에 없는 섹션은 억지로 만들지 마.
- '한눈에 보는 흐름'에서는 강의가 어떤 문제의식에서 시작해 어떤 개념과 방법으로 이어지는지 4~7개 bullet로 정리해.
- '핵심 개념'에서는 개념을 하나씩 '### 개념명' 소제목으로 나눠 설명해. 각 소제목 아래에 정의, 의미, 중요한 이유, 예시/적용 맥락을 bullet로 적어. 여러 개념을 '6.1 …', '6.2 …'처럼 절 번호 제목 하나에 몰아넣거나 '**개념명**' 굵은 글머리로 묶지 말고, 소제목에는 번호 없이 개념 이름만 써. 각 개념의 출처는 그 개념 소제목 아래 내용에만 붙여.
- '방법/절차'에서는 실험법, 계산법, 분석법처럼 순서가 있는 내용을 번호 목록으로 정리하고, 단계별 목적과 결과를 함께 적어.
- '주요 용어'는 별도 섹션에서 '용어 | 설명 | 헷갈리는 점' 표로 정리해.
- '시험 포인트'는 출제될 만한 정의, 비교, 조건, 절차, 계산식을 '문제 → 답' 형식으로 정리해. 각 항목은 반드시 '>' 인용문 박스 하나로 감싸서 항목끼리 카드처럼 분리하고, 박스 안에는 질문을 한 줄로 쓰고 그 질문 줄 끝에 '(출처: 파일명, p.X)'로 해당 문제의 출처를 붙인 다음, 줄을 바꿔 '- 답:'을 한 줄로만 적고, 바로 아래 줄부터 답 내용을 요점별로 하위 bullet('  - ')로 나눠 적어라. 한 bullet에는 한 가지 요점만 담고, 한 문장에 사실이 여러 개면 쪼개서 각각 별도 bullet로 만들어라(답이 정말 한 가지뿐일 때만 bullet 하나). '답:' 옆에 답 내용을 같은 줄로 붙이지 말고, 답의 각 요점은 반드시 '- '로 시작하는 별도 줄에 둬라. 질문과 답은 반드시 서로 다른 줄에 둬라. 시험 포인트 출처는 헤딩이 아니라 각 질문 옆에만 둔다. 질문 앞에 '시험 포인트:' 같은 라벨은 붙이지 마.
- '핵심 암기 사항'은 마지막 복습용으로 반드시 외울 정의, 공식, 절차, 비교 개념만 압축해서, 전체를 '>' 인용문 박스 하나로 묶어 bullet 목록으로 정리해(핵심 키워드는 굵게).
- '참고/주의 사항'에는 실험 주의점, 예외, 단위, 조건, 흔한 실수를 '>' 인용문 박스 하나로 묶어 bullet로 정리해(핵심 암기 사항과 같은 박스 형태). 각 항목 앞에 '헷갈림 주의:' 같은 라벨은 붙이지 마.
- 비교가 필요한 개념은 Markdown 표로 정리해.
- 분류 체계나 분석 방법의 갈래는 코드블록 구조도(tree)로 먼저 보여준 뒤 설명해.
- 절차, 시험 포인트, 헷갈림 주의, 핵심 암기 묶음은 필요할 때 '>' 인용문을 사용해 텍스트 상자로 정리해.
- '시험 포인트' 섹션 안에서는 '**시험 포인트:**' 라벨을 붙이지 마라. 다른 섹션 본문에서 특히 시험에 중요한 문장만 제한적으로 '**시험 포인트:**'로 강조한다.
- '참고/주의 사항' 섹션 안에서는 '**헷갈림 주의:**' 라벨을 붙이지 마라. 다른 섹션 본문에서 특히 헷갈리기 쉬운 문장만 제한적으로 '**헷갈림 주의:**'로 강조한다.
- 박스('>' 인용문)는 위에서 지정한 '시험 포인트'·'핵심 암기 사항'·'참고/주의 사항' 세 섹션에서만 써라. '핵심 개념'·'방법/절차'·'주요 용어'·'한눈에 보는 흐름'은 박스로 감싸지 말고 일반 텍스트와 bullet로만 정리하고, 절대 카드/박스로 쪼개지 마.""",
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
    "CHEAT_SHEET": """시험 직전 1~2페이지짜리 종이에 적은 압축 암기표처럼 작성해.
- 제목별 박스나 카드 구조를 만들지 마.
- 긴 설명, 긴 문단, 세부 해설을 쓰지 마.
- 용어-설명 중심으로 압축하고, 각 설명은 가능하면 한 줄로 작성해.
- 핵심 용어, 공식, 조건, 예외, 절차, 비교 포인트만 남겨.
- 깊은 제목 구조를 쓰지 말고 '# 치트시트' 아래에 '## 핵심 용어', '## 핵심 공식', '## 절차 요약', '## 헷갈리는 비교', '## 마지막 체크' 정도만 사용해.
- 핵심 용어와 공식은 표 중심으로 정리해.
- 인용문, 콜아웃, 박스 스타일은 절대 사용하지 마.
- `(출처: ...)` 같은 출처·근거 표기는 절대 붙이지 마. 치트시트는 출처 없이 핵심만 압축한다.
- 원문 전체를 자세히 설명하지 말고 시험 직전에 빠르게 훑을 핵심만 남겨.""",
}

SUMMARY_USER_PROMPT = """업로드한 강의자료를 {template_label} 템플릿으로 요약해줘.

템플릿 지시:
{template_instruction}

공통 기준:
1. 반드시 한국어로 작성해.
2. 원문에 있는 대단원/소단원 흐름을 가능한 유지해.
3. 원문에 없는 내용을 단정해서 추가하지 마.
4. 수치, 단위, 공식, 날짜, 파일명, 고유명사, 영어 약어는 가능한 원문 그대로 보존해.
5. 중요한 용어와 공식은 필요할 때만 **굵게** 표시해. 굵게 표시는 형광펜이 아니라 일반 강조다.
6. 자료에서 글자가 흐리거나 내용이 불확실하면 **[확인 필요]**라고 표시해.
7. Markdown만 출력하고, HTML 태그, 색상 지시, 이모지는 사용하지 마.
8. 형광펜 강조는 기본적으로 사용하지 마. 전체 출력에서 가장 중요한 핵심 내용 5개 이하에만 `==핵심 내용==` 형식으로 표시해.
9. `==...==`는 반드시 한 문장 또는 짧은 구절에만 사용하고, 제목 전체나 긴 문단에는 사용하지 마.
10. 공식, 수치, 단위, 매우 짧은 핵심 키워드는 필요할 때만 `inline code`로 감싸. inline code는 형광펜 강조가 아니다.
11. '>' 인용문은 텍스트 상자가 필요한 경우에만 사용해. 화면에서는 왼쪽 색 선 없이 둥근 박스로 렌더링된다.
12. 제목별로 카드나 박스를 나누는 형식은 사용하지 마.
13. 템플릿별 목적을 최우선으로 따르고, 세 템플릿의 출력 스타일이 서로 비슷해지지 않게 해.
14. 일반 요약과 강의 노트에서는 핵심 bullet이나 중요한 문장 끝에 가능한 경우 `(출처: 파일명, p.3/slide 7/OCR 이미지 2/섹션명)`처럼 짧은 근거 표기를 붙여라. 자료에 위치 단서가 없으면 파일명이나 섹션명만 써도 된다. 단, 치트시트에는 `(출처: ...)` 같은 출처 표기를 절대 붙이지 마라.

[강의자료]
{markdown}

최종 출력 점검:
- {template_label} 템플릿 지시와 공통 기준만 따라 작성해.
- 일반 요약은 정보 보존형 정리본, 강의 노트는 학습 보조형 노트, 치트시트는 시험 직전 압축 암기표로 작성해.
- 형광펜 표시(`==...==`)는 5개 이하인지 확인해.
- 필요한 텍스트 상자는 '>' 인용문으로만 만들고, HTML aside는 쓰지 마.
- 자료 앞뒤에 붙은 앱 UI 문구, 이전 요약 형식, 예시 제목을 출력에 섞지 마.
"""


SUMMARY_SYSTEM_PROMPT = """너는 대학 강의자료를 템플릿별 목적에 맞춰 Markdown으로 정리하는 전문가다.
사용자가 제공한 강의자료에 근거해서만 작성하고, 원문에 없는 내용을 단정하지 마.
일반 요약은 정보 보존형 정리본, 강의 노트는 학습 보조형 노트, 치트시트는 시험 직전 압축 암기표로 작성해.
템플릿 간 출력 스타일이 서로 비슷해지지 않도록 각 템플릿 지시를 최우선으로 따라.
텍스트 상자가 필요하면 '>' 인용문만 사용하고, HTML aside, 이모지, 색상 지시는 사용하지 마.
중요 용어와 공식은 **굵게** 표시하고, 필요한 경우 제목·bullet list·번호 목록·표·코드블록만 사용해.
후속 질문, 추가 제안, 작성 완료 멘트는 절대 붙이지 마."""


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_CHAT_CONTENT_CHARS)


class SummarizeRequest(BaseModel):
    markdown: str = Field(min_length=1, max_length=MAX_MARKDOWN_CHARS)
    template: SummaryTemplate = "GENERAL"
    model: Literal["GPT", "Gemini"] = "GPT"
    thread_id: str | None = None
    # 사용자가 "1-5, 8"처럼 지정한 반영 페이지. 비우면 전체.
    pages: str | None = None
    # 사용자가 집중을 원하는 내용. 시스템 프롬프트에 반영한다.
    focus_prompt: str | None = None


class AgentRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=MAX_CHAT_MESSAGES)
    model: Literal["GPT", "Gemini"] = "GPT"
    thread_id: str | None = None
    markdown: str | None = Field(default=None, max_length=MAX_MARKDOWN_CHARS)
    source_markdown: str | None = Field(default=None, max_length=MAX_MARKDOWN_CHARS)
    pages: str | None = None


class QuizRequest(BaseModel):
    subject: str = Field(min_length=1)
    count: int = Field(default=10, ge=1, le=30)
    difficulty: Literal["쉬움", "보통", "어려움"] = "보통"
    question_type: Literal["객관식", "OX", "단답형", "주관식"] = "객관식"
    model: Literal["GPT", "Gemini"] = "GPT"
    markdown: str | None = Field(default=None, max_length=MAX_MARKDOWN_CHARS)
    # 이전에 출제된 문제 텍스트. 이 문제들과 중복/유사하게 내지 않도록 프롬프트에 반영한다.
    exclude_questions: list[str] = Field(default_factory=list)


class WrongAnswerItem(BaseModel):
    question: str = Field(min_length=1)
    type: str = ""
    student_answer: str = ""
    correct_answer: str = ""
    explanation: str = ""
    is_correct: bool = True


class WrongAnalysisRequest(BaseModel):
    subject: str = Field(min_length=1)
    items: list[WrongAnswerItem] = Field(default_factory=list)
    model: Literal["GPT", "Gemini"] = "GPT"


class SubjectiveGradeRequest(BaseModel):
    question: str = Field(min_length=1, max_length=MAX_CHAT_CONTENT_CHARS)
    reference_answer: str = Field(min_length=1, max_length=MAX_CHAT_CONTENT_CHARS)
    student_answer: str = Field(min_length=1, max_length=MAX_CHAT_CONTENT_CHARS)
    model: Literal["GPT", "Gemini"] = "GPT"
    markdown: str | None = Field(default=None, max_length=MAX_MARKDOWN_CHARS)


class StudyPlanDday(BaseModel):
    id: str | None = None
    type: Literal["assignment", "event"] = "assignment"
    subj: str = Field(min_length=1)
    date: str = Field(min_length=1)


class StudyPlanItem(BaseModel):
    id: str | None = None
    text: str = Field(min_length=1)
    done: bool = False


class StudyPlanRequest(BaseModel):
    ddays: list[StudyPlanDday] = Field(default_factory=list)
    incomplete_plans: list[StudyPlanItem] = Field(default_factory=list)
    mode: Literal["balanced", "lighter", "harder", "assignment", "event", "reroll"] = "balanced"


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
{markdown_section}{exclude_section}
위 조건에 맞는 문제 {count}개를 JSON 배열로만 출력해."""

STUDY_PLAN_MODEL = "gpt-5.4-nano"

STUDY_PLAN_SYSTEM_PROMPT = """너는 대학생의 마감 일정과 미완료 항목을 보고 오늘 할 일을 작게 쪼개는 학습 계획 코치다.
반드시 순수 JSON 객체만 출력해. 설명, 마크다운, 코드 블록, 기타 텍스트 없이 JSON만 출력한다.

판단 기준:
- assignment는 과제다. 요구사항 확인, 자료 정리, 목차 잡기, 초안 작성, 제출 전 검토처럼 실행 가능한 작업으로 쪼갠다.
- event는 일정이다. 오늘 준비가 필요한 경우에만 준비물 확인, 장소/시간 확인, 연락, 이동 계획 같은 리마인드 작업으로 만든다.
- 미완료 항목은 우선 반영하되, 너무 무거우면 더 작게 쪼갠다.
- 오늘 할 일은 1~5개로 제한한다.
- 각 항목은 사용자가 바로 실행할 수 있게 8~22자 정도의 한국어 동사형 문장으로 쓴다.
- 시간은 5분 단위, 10~90분 사이로 제안한다.
- mode가 lighter면 총량을 줄이고 쉬운 작업 위주로 둔다.
- mode가 harder면 더 깊은 작업을 포함하되 과하지 않게 한다.
- mode가 assignment면 과제 작업을 우선한다.
- mode가 event면 일정 준비 작업을 우선한다.

출력 형식:
{"message":"짧은 한두 문장 안내","items":[{"text":"작업명","minutes":30,"source_id":"D-day id 또는 null","source_type":"assignment 또는 event 또는 carryover"}]}"""

STUDY_PLAN_USER_PROMPT = """오늘 날짜: {today}
조정 모드: {mode}

[D-day 목록]
{ddays_json}

[미완료 항목]
{incomplete_json}

위 정보를 보고 오늘의 학습계획을 JSON으로만 생성해."""


WRONG_ANALYSIS_SYSTEM_PROMPT = """너는 대학생의 퀴즈 오답을 분석해 약점과 학습 처방을 정리하는 학습 코치다.
반드시 순수 JSON 객체만 출력해. 설명, 마크다운, 코드 블록, 기타 텍스트 없이 JSON만 출력한다.

분석 원칙:
- 문항별 정답/학생답/해설을 근거로, 학생이 어떤 개념에서 왜 틀렸는지 패턴을 묶어 짚는다.
- 자료에 없는 사실을 지어내지 않는다. 문항·정답·해설에서 드러나는 내용만 근거로 쓴다.
- 각 항목은 한국어로 간결하게(한 줄), 추상적 조언이 아니라 이 과목 내용에 밀착해서 쓴다.

출력 형식:
{"summary":"한 줄 총평","weaknesses":["취약 개념과 왜 틀렸는지 1~4개"],"studyPoints":["덜 틀리려면 더 공부할 내용 1~4개"],"studyMethod":"어떻게 공부하면 좋을지 한두 문장","memorize":["반드시 외워야 할 핵심 1~4개"]}"""

WRONG_ANALYSIS_USER_PROMPT = """과목: {subject}

아래는 이 과목에서 학생이 (과거에 틀려서) 다시 푼 문항과 채점 결과다.
is_correct가 false인 문항을 중심으로 약점을 분석해.

[문항 목록]
{items_json}

위 결과를 바탕으로 이 과목의 취약점과 학습 처방을 JSON으로만 정리해."""


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
- answer는 정답 선택지의 인덱스다. 0~3 정수로 작성한다.
- 정답을 항상 0번에 두지 말고 0~3 위치에 고르게 분산시킨다."""


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
    for raw_item in raw_items[:5]:
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
        items.append({
            "text": text.strip()[:80],
            "minutes": minutes,
            "source_id": source_id if isinstance(source_id, str) and source_id else None,
            "source_type": source_type if source_type in {"assignment", "event", "carryover"} else "assignment",
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


SUPPORTED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"}
SUPPORTED_CONVERT_EXTENSIONS = {".pdf", ".ppt", ".pptx", *SUPPORTED_IMAGE_EXTENSIONS}
SUPPORTED_PREVIEW_EXTENSIONS = {".pdf", ".ppt", ".pptx"}
SUPPORTED_OCR_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp", "image/tiff"}
MAX_OCR_IMAGE_BYTES = 10 * 1024 * 1024
# PDF/PPT 등 비이미지 문서 업로드 크기 상한(메모리·디스크 보호). 이미지(OCR)는 MAX_OCR_IMAGE_BYTES를 따른다.
MAX_DOCUMENT_BYTES = _env_int("MAX_DOCUMENT_BYTES", 100 * 1024 * 1024)
# zip 기반 파일(PPTX 등)의 압축 해제 총량 상한(zip bomb 방어).
MAX_ARCHIVE_UNCOMPRESSED_BYTES = _env_int("MAX_ARCHIVE_UNCOMPRESSED_BYTES", 200 * 1024 * 1024)


def _find_office_binary() -> str | None:
    configured_path = os.getenv("LIBREOFFICE_PATH", "").strip()
    if configured_path:
        return configured_path

    for command in ("soffice", "libreoffice"):
        resolved = shutil.which(command)
        if resolved:
            return resolved

    windows_candidates = [
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    ]
    for candidate in windows_candidates:
        if Path(candidate).exists():
            return candidate

    return None


def _convert_presentation_to_pdf(file_path: str) -> bytes:
    office_binary = _find_office_binary()
    if not office_binary:
        raise RuntimeError("PPT/PPTX 미리보기를 사용하려면 서버에 LibreOffice가 설치되어 있어야 합니다.")

    with tempfile.TemporaryDirectory() as output_dir:
        command = [
            office_binary,
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            output_dir,
            file_path,
        ]
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=_env_int("PPT_PREVIEW_TIMEOUT_SECONDS", 120),
            )
        except subprocess.TimeoutExpired as e:
            raise RuntimeError("PPT/PPTX PDF 변환 시간이 초과되었습니다.") from e

        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "").strip()
            raise RuntimeError(f"PPT/PPTX PDF 변환 실패: {detail or 'LibreOffice 변환 오류'}")

        pdf_files = sorted(Path(output_dir).glob("*.pdf"))
        if not pdf_files:
            raise RuntimeError("PPT/PPTX 변환 결과 PDF를 찾지 못했습니다.")

        return pdf_files[0].read_bytes()


def _extract_image_text_with_tesseract(path: str) -> str:
    from PIL import Image
    import pytesseract

    language = os.getenv("TESSERACT_LANG", "kor+eng")
    with Image.open(path) as image:
        normalized = image.convert("L")
        try:
            return pytesseract.image_to_string(normalized, lang=language).strip()
        except pytesseract.TesseractError:
            if language == "eng":
                raise
            return pytesseract.image_to_string(normalized, lang="eng").strip()

def _image_data_url(image_bytes: bytes, mime_type: str = "image/png") -> str:
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def _text_length(text: str) -> int:
    return len("".join(text.split()))


def _extract_pdf_markdown_with_page_markers(file_path: str) -> str:
    try:
        import fitz
    except ImportError:
        return ""
    pages = []
    with fitz.open(file_path) as doc:
        for i, page in enumerate(doc):
            text = (page.get_text("text") or "").strip()
            # 텍스트가 없는(이미지) 페이지에도 마커를 남긴다. 그래야 페이지 선택 필터가
            # 모든 페이지를 인식하고, 시각 분석(페이지별 OCR) 결과와 같은 페이지로 짝지을 수 있다.
            pages.append(f"<!-- p.{i + 1} -->\n{text}" if text else f"<!-- p.{i + 1} -->")
    return "\n\n".join(pages)


def _parse_page_selection(spec: str) -> set[int]:
    """"1-5, 8, 10-12" 같은 입력을 페이지 번호 집합으로 변환한다."""
    pages: set[int] = set()
    for part in spec.replace(" ", "").split(","):
        if not part:
            continue
        if "-" in part:
            start_str, _, end_str = part.partition("-")
            try:
                start, end = int(start_str), int(end_str)
            except ValueError:
                continue
            if start > end:
                start, end = end, start
            pages.update(range(start, end + 1))
        else:
            try:
                pages.add(int(part))
            except ValueError:
                continue
    return pages


# PDF는 `<!-- p.N -->`, PPT/PPTX(markitdown)는 `<!-- Slide number: N -->` 형식의 마커를 쓴다.
_PAGE_MARKER_RE = re.compile(r"<!--\s*(?:p\.|Slide number:\s*)(\d+)\s*-->")


def _filter_markdown_by_pages(markdown: str, spec: str | None) -> str:
    """`<!-- p.N -->` 마커 기준으로 선택한 페이지 블록만 남긴다.

    마커가 없거나(이미지 OCR 등) 선택이 비면 원본을 그대로 돌려준다.
    """
    if not spec or not spec.strip():
        return markdown
    selected = _parse_page_selection(spec)
    if not selected:
        return markdown
    matches = list(_PAGE_MARKER_RE.finditer(markdown))
    if not matches:
        return markdown
    preamble = markdown[: matches[0].start()].strip()
    kept: list[str] = [preamble] if preamble else []
    for idx, match in enumerate(matches):
        page_no = int(match.group(1))
        if page_no not in selected:
            continue
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(markdown)
        block = markdown[match.start():end].strip()
        if block:
            kept.append(block)
    # 선택한 페이지가 자료에 하나도 없으면 빈 요약을 막기 위해 원본을 쓴다.
    if len(kept) <= (1 if preamble else 0):
        return markdown
    return "\n\n".join(kept)


def _pdf_page_has_image(page) -> bool:
    page_dict = page.get_text("dict")
    for block in page_dict.get("blocks", []):
        if block.get("type") == 1:
            return True
    return False


def _render_pdf_pages_for_visual_analysis(file_path: str, force: bool = False) -> list[dict[str, str]]:
    try:
        import fitz
    except ImportError as e:
        raise RuntimeError("PDF 이미지 분석을 위해 PyMuPDF가 필요합니다.") from e

    pages: list[dict[str, str]] = []
    scale = PDF_VISUAL_RENDER_DPI / 72
    matrix = fitz.Matrix(scale, scale)

    with fitz.open(file_path) as doc:
        selected_indexes: list[int] = []
        for index in range(len(doc)):
            page = doc.load_page(index)
            if force:
                selected_indexes.append(index)
            else:
                page_text_len = _text_length(page.get_text("text") or "")
                if page_text_len < PDF_VISUAL_TEXT_PAGE_CHARS or _pdf_page_has_image(page):
                    selected_indexes.append(index)
            if len(selected_indexes) >= VISUAL_ANALYSIS_MAX_ITEMS:
                break

        for index in selected_indexes:
            page = doc.load_page(index)
            pixmap = page.get_pixmap(matrix=matrix, alpha=False)
            pages.append({
                "label": f"PDF {index + 1}페이지",
                "data_url": _image_data_url(pixmap.tobytes("png")),
            })

    return pages


def _extract_pptx_images_for_visual_analysis(file_path: str) -> list[dict[str, str]]:
    images: list[dict[str, str]] = []
    with zipfile.ZipFile(file_path) as archive:
        total_uncompressed = sum(info.file_size for info in archive.infolist())
        if total_uncompressed > MAX_ARCHIVE_UNCOMPRESSED_BYTES:
            raise RuntimeError(
                f"압축 해제 크기가 너무 큽니다({total_uncompressed // (1024 * 1024)}MB). "
                "손상되었거나 비정상적인 파일일 수 있습니다."
            )
        media_names = [
            name for name in archive.namelist()
            if name.startswith("ppt/media/")
            and Path(name).suffix.lower() in PPTX_IMAGE_EXTENSIONS
        ]
        for index, name in enumerate(media_names[:VISUAL_ANALYSIS_MAX_ITEMS]):
            suffix = Path(name).suffix.lower()
            mime_type = "image/jpeg" if suffix in {".jpg", ".jpeg"} else "image/png"
            images.append({
                "label": f"PPTX 삽입 이미지 {index + 1}",
                "data_url": _image_data_url(archive.read(name), mime_type),
            })
    return images


def _should_analyze_visuals(base_markdown: str, suffix: str) -> bool:
    if VISUAL_ANALYSIS_MODE in {"off", "never", "false", "0"}:
        return False
    if VISUAL_ANALYSIS_MODE in {"on", "always", "true", "1"}:
        return True
    if suffix not in {".pdf", ".pptx"}:
        return False
    if suffix == ".pdf":
        return True
    return _text_length(base_markdown) < VISUAL_ANALYSIS_MIN_TEXT_CHARS


def _collect_visual_inputs(file_path: str, suffix: str, force: bool = False) -> list[dict[str, str]]:
    if suffix == ".pdf":
        return _render_pdf_pages_for_visual_analysis(file_path, force)
    if suffix == ".pptx":
        return _extract_pptx_images_for_visual_analysis(file_path)
    return []


def _visual_batches(items: list[dict[str, str]]) -> list[list[dict[str, str]]]:
    return [
        items[index:index + VISUAL_ANALYSIS_BATCH_SIZE]
        for index in range(0, len(items), VISUAL_ANALYSIS_BATCH_SIZE)
    ]


# 시각 분석 결과의 'PDF N페이지' 제목 줄 앞에 `<!-- p.N -->` 마커를 심는다.
# 텍스트 레이어가 없는(이미지) 슬라이드는 본문이 이 시각 분석에서 나오므로, 마커가 없으면
# 페이지 선택 요약이 적용되지 않는다. 모델이 라벨('PDF N페이지')을 제목으로 그대로 쓰도록 유도하고,
# 그 제목에서 페이지 번호를 읽어 마커를 붙인다. (매칭 실패한 제목은 기존처럼 그대로 둔다.)
_VISUAL_PDF_PAGE_HEADING_RE = re.compile(r"(?m)^(#{1,6}\s+[^\n]*?PDF\s*(\d+)\s*페이지[^\n]*)$")


def _tag_visual_pdf_pages(visual_markdown: str) -> str:
    return _VISUAL_PDF_PAGE_HEADING_RE.sub(
        lambda m: f"<!-- p.{m.group(2)} -->\n{m.group(1)}", visual_markdown
    )


def _analyze_document_visuals(file_path: str, suffix: str, base_markdown: str = "") -> str:
    force_visual_scan = VISUAL_ANALYSIS_MODE in {"on", "always", "true", "1"}
    if not force_visual_scan and not _should_analyze_visuals(base_markdown, suffix):
        return ""

    visual_inputs = _collect_visual_inputs(file_path, suffix, force_visual_scan)
    if not visual_inputs:
        return ""

    model = os.getenv("VISUAL_ANALYSIS_MODEL", "GPT")

    if model == "GPT" and not os.getenv("OPENAI_API_KEY"):
        return ""
    if model == "Gemini" and not os.getenv("GEMINI_API_KEY"):
        return ""

    llm = build_llm(model)
    sections: list[str] = []

    for batch in _visual_batches(visual_inputs):
        content: list[dict[str, object]] = [{
            "type": "text",
            "text": (
                "아래 강의자료 이미지들을 각각 구분해서 분석해줘. "
                "반드시 각 항목을 제공된 라벨을 그대로 쓴 '## 라벨' 제목(예: '## PDF 3페이지')으로 시작하고, "
                "이미지 순서대로 작성해. "
                "분석 대상: " + ", ".join(item["label"] for item in batch)
            ),
        }]
        for item in batch:
            content.extend([
                {
                    "type": "text",
                    "text": f"[{item['label']}]",
                },
                {
                    "type": "image_url",
                    "image_url": {"url": item["data_url"]},
                },
            ])

        response = llm.invoke([
            SystemMessage(content="""너는 강의자료 이미지와 손글씨를 Markdown으로 전사하는 OCR 보조 분석기다.
규칙:
- 이미지 안의 인쇄 텍스트, 도표 텍스트, 손글씨를 최대한 읽어 Markdown bullet로 정리한다.
- 수식, 표, 화살표 관계, 도식의 의미도 강의 요약/퀴즈 생성에 쓸 수 있게 설명한다.
- 확실하지 않은 글자는 추측하지 말고 '[불확실]'로 표시한다.
- 이미지에 유의미한 학습 내용이 없으면 '유의미한 학습 내용 없음'이라고만 답한다.
- 여러 이미지가 들어오면 이미지별로 반드시 별도 섹션을 만든다.
- 한국어로 답한다."""),
            HumanMessage(content=content),
        ])
        text = _message_content_to_text(response.content).strip()
        if text and text != "유의미한 학습 내용 없음":
            sections.append(text)

    if not sections:
        return ""

    body = "# 이미지/손글씨 분석 결과\n\n" + "\n\n".join(sections)
    # PDF는 페이지별로 렌더링·분석하므로 'PDF N페이지' 섹션마다 페이지 마커를 심어,
    # 페이지 선택 요약이 이미지 슬라이드에도 적용되게 한다. (PPTX 삽입 이미지는 슬라이드 번호와
    # 1:1로 매칭되지 않아, 본문 markitdown의 'Slide number' 마커에만 의존한다.)
    if suffix == ".pdf":
        body = _tag_visual_pdf_pages(body)
    return body


@app.post("/convert")
async def convert_document_to_markdown(
    file: UploadFile = File(...),
    _user=Depends(require_api_user),
):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in SUPPORTED_CONVERT_EXTENSIONS:
        raise HTTPException(status_code=400, detail="PDF, PPT, PPTX, 이미지 파일만 지원합니다.")

    file_bytes = await file.read()
    if suffix in SUPPORTED_IMAGE_EXTENSIONS:
        if len(file_bytes) > MAX_OCR_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="이미지 파일은 10MB 이하만 OCR할 수 있습니다.")
    elif len(file_bytes) > MAX_DOCUMENT_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"문서 파일은 {MAX_DOCUMENT_BYTES // (1024 * 1024)}MB 이하만 변환할 수 있습니다.",
        )

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        if suffix in SUPPORTED_IMAGE_EXTENSIONS:
            text = await run_in_threadpool(_extract_image_text_with_tesseract, tmp_path)
            return {"markdown": f"# 이미지 OCR 결과\n\n{text}" if text else "# 이미지 OCR 결과\n\n인식된 텍스트가 없습니다."}

        # 1단계: 텍스트 레이어 추출 (PDF는 페이지 마커 포함)
        if suffix == ".pdf":
            pdf_markdown = await run_in_threadpool(_extract_pdf_markdown_with_page_markers, tmp_path)
            if pdf_markdown:
                base_markdown = pdf_markdown
            else:
                result = await run_in_threadpool(md_converter.convert, tmp_path)
                base_markdown = (result.text_content or "").strip()
        else:
            result = await run_in_threadpool(md_converter.convert, tmp_path)
            base_markdown = (result.text_content or "").strip()
        visual_markdown = ""
        try:
            visual_markdown = await run_in_threadpool(_analyze_document_visuals, tmp_path, suffix, base_markdown)
        except Exception:
            logger.exception("이미지/손글씨 분석 실패")
            visual_markdown = "# 이미지/손글씨 분석 결과\n\n이미지/손글씨 분석을 완료하지 못했습니다."
        markdown_parts = [part for part in [base_markdown, visual_markdown.strip()] if part]
        return {"markdown": "\n\n---\n\n".join(markdown_parts)}
    except Exception as e:
        logger.exception("/convert 처리 실패")
        raise HTTPException(status_code=500, detail="문서 변환 중 오류가 발생했습니다.") from e
    finally:
        os.unlink(tmp_path)


@app.post("/preview/pdf")
async def convert_document_to_pdf_preview(
    file: UploadFile = File(...),
    _user=Depends(require_api_user),
):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in SUPPORTED_PREVIEW_EXTENSIONS:
        raise HTTPException(status_code=400, detail="PDF, PPT, PPTX 파일만 미리보기를 지원합니다.")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="미리보기 파일이 비어 있습니다.")
    if len(file_bytes) > MAX_DOCUMENT_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"미리보기 파일은 {MAX_DOCUMENT_BYTES // (1024 * 1024)}MB 이하만 지원합니다.",
        )

    if suffix == ".pdf":
        return Response(
            content=file_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": 'inline; filename="preview.pdf"'},
        )

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        pdf_bytes = await run_in_threadpool(_convert_presentation_to_pdf, tmp_path)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": 'inline; filename="preview.pdf"'},
        )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e
    except Exception as e:
        logger.exception("/preview/pdf 변환 실패")
        raise HTTPException(status_code=502, detail="미리보기 변환 중 오류가 발생했습니다.") from e
    finally:
        try:
            os.unlink(tmp_path)
        except FileNotFoundError:
            pass


@app.post("/vision/ocr")
async def extract_text_with_google_vision(
    file: UploadFile = File(...),
    _user=Depends(require_api_user),
):
    if not GOOGLE_VISION_API_KEY:
        raise HTTPException(status_code=503, detail="서버에 GOOGLE_VISION_API_KEY가 설정되지 않았습니다.")

    content_type = (file.content_type or "").lower()
    if content_type not in SUPPORTED_OCR_MIME_TYPES:
        raise HTTPException(status_code=400, detail="이미지 OCR은 JPG, PNG, WEBP, GIF, BMP, TIFF 파일만 지원합니다.")

    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="이미지 파일이 비어 있습니다.")
    if len(image_bytes) > MAX_OCR_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="이미지 파일은 10MB 이하만 OCR할 수 있습니다.")

    payload = {
        "requests": [
            {
                "image": {"content": base64.b64encode(image_bytes).decode("ascii")},
                "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
                "imageContext": {"languageHints": ["ko", "en"]},
            }
        ]
    }

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                "https://vision.googleapis.com/v1/images:annotate",
                headers={"x-goog-api-key": GOOGLE_VISION_API_KEY},
                json=payload,
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"Google Vision API 호출 실패: {str(e)}") from e

    try:
        data = response.json()
    except ValueError as e:
        raise HTTPException(status_code=502, detail="Google Vision API 응답을 읽을 수 없습니다.") from e

    if response.status_code >= 400:
        error = data.get("error") if isinstance(data, dict) else None
        message = error.get("message") if isinstance(error, dict) else response.text
        raise HTTPException(status_code=response.status_code, detail=f"Google Vision OCR 실패: {message}")

    result = (data.get("responses") or [{}])[0]
    if isinstance(result, dict) and result.get("error"):
        error = result["error"]
        message = error.get("message") if isinstance(error, dict) else "OCR 처리 중 오류가 발생했습니다."
        raise HTTPException(status_code=502, detail=f"Google Vision OCR 실패: {message}")

    text = ""
    if isinstance(result, dict):
        full_text = result.get("fullTextAnnotation")
        if isinstance(full_text, dict) and isinstance(full_text.get("text"), str):
            text = full_text["text"].strip()
        elif isinstance(result.get("textAnnotations"), list) and result["textAnnotations"]:
            first_annotation = result["textAnnotations"][0]
            if isinstance(first_annotation, dict) and isinstance(first_annotation.get("description"), str):
                text = first_annotation["description"].strip()

    return {"text": text}


@app.post("/summarize")
async def summarize(req: SummarizeRequest, _user=Depends(require_api_user)):
    markdown = _filter_markdown_by_pages(req.markdown, req.pages)
    prompt = SUMMARY_USER_PROMPT.format(
        template_label=TEMPLATE_LABELS[req.template],
        template_instruction=TEMPLATE_INSTRUCTIONS[req.template],
        markdown=markdown,
    )

    system_content = SUMMARY_SYSTEM_PROMPT
    if req.focus_prompt and req.focus_prompt.strip():
        system_content = (
            f"{SUMMARY_SYSTEM_PROMPT}\n\n"
            "[사용자 집중 요청]\n"
            f"사용자가 다음 내용에 특히 집중한 요약을 원한다: {req.focus_prompt.strip()}\n"
            "이 요청을 최우선으로 반영하되, 반드시 제공된 강의자료에 근거해서만 작성하고 "
            "원문에 없는 내용을 지어내지 마."
        )

    def _call_llm():
        from langchain_core.messages import HumanMessage, SystemMessage
        llm = build_llm(req.model, max_tokens=SUMMARY_MAX_TOKENS)
        response = llm.invoke([
            SystemMessage(content=system_content),
            HumanMessage(content=prompt),
        ])
        return {"result": _message_content_to_text(response.content).strip()}

    try:
        return await run_in_threadpool(_call_llm)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        logger.exception("/summarize 실패")
        raise HTTPException(status_code=502, detail="요약 생성 중 오류가 발생했습니다.") from e


@app.post("/agent")
async def agent(req: AgentRequest, _user=Depends(require_api_user)):
    messages = [message.model_dump() for message in req.messages]
    # 요약에 쓰인 페이지 범위(pages)가 있으면 원본도 같은 범위로 좁힌다(마커 기준; 없으면 전체).
    source = _filter_markdown_by_pages(req.source_markdown, req.pages) if req.source_markdown else ""
    # 원본이 너무 길면 컨텍스트엔 요약만 넣고, 원본은 inspect_original_source 도구로 on-demand 조회하게 한다.
    source_inline_limit = 12000  # 자(char) 기준
    if source and len(source) <= source_inline_limit:
        parts = [f"[원본 강의자료 본문]\n{source}"]
        if req.markdown:
            parts.append(f"[정리된 요약]\n{req.markdown}")
        messages.insert(
            0,
            {
                "role": "user",
                "content": (
                    "다음 자료를 현재 대화의 참고 자료로 사용해. "
                    "사실과 내용의 근거는 [원본 강의자료 본문]을 우선하고, "
                    "[정리된 요약]은 구조·정리 참고용으로만 사용해.\n\n"
                    + "\n\n".join(parts)
                ),
            },
        )
    elif req.markdown:
        note = (
            " 원본 본문은 길어서 기본 컨텍스트에는 요약만 넣었어. "
            "요약이 의심스럽거나 원본 확인이 필요하면 inspect_original_source 도구로 원본을 확인해."
            if source
            else ""
        )
        messages.insert(
            0,
            {
                "role": "user",
                "content": f"다음 강의자료를 현재 대화의 참고 자료로 사용해.{note}\n\n[정리된 요약]\n{req.markdown}",
            },
        )

    try:
        return await run_in_threadpool(run_study_agent, req.model, messages, req.thread_id, source)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        logger.exception("/agent 실행 실패")
        raise HTTPException(status_code=502, detail="AI 튜터 응답 생성 중 오류가 발생했습니다.") from e


@app.post("/quiz")
async def generate_quiz(req: QuizRequest, _user=Depends(require_api_user)):
    markdown_section = f"\n강의자료:\n{req.markdown}\n" if req.markdown else ""
    exclude_section = ""
    excluded = [q.strip() for q in req.exclude_questions if isinstance(q, str) and q.strip()][:80]
    if excluded:
        joined = "\n".join(f"- {q}" for q in excluded)
        exclude_section = (
            "\n[이미 출제된 문제 — 아래와 중복되거나 거의 같은 문제는 절대 내지 마라. "
            "다른 개념·다른 관점으로 새로운 문제를 만들어라]\n"
            f"{joined}\n"
        )
    prompt = QUIZ_USER_PROMPT.format(
        subject=req.subject,
        count=req.count,
        difficulty=req.difficulty,
        question_type=req.question_type,
        markdown_section=markdown_section,
        exclude_section=exclude_section,
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
        logger.exception("/quiz 생성 실패")
        raise HTTPException(status_code=502, detail="퀴즈 생성 중 오류가 발생했습니다.") from e


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
        logger.exception("/quiz/grade-subjective 실패")
        raise HTTPException(status_code=502, detail="주관식 채점 중 오류가 발생했습니다.") from e


@app.post("/quiz/analyze-wrong")
async def analyze_wrong_answers(req: WrongAnalysisRequest, _user=Depends(require_api_user)):
    if not req.items:
        raise HTTPException(status_code=400, detail="분석할 문항이 없습니다.")

    items_json = json.dumps(
        [item.model_dump() for item in req.items[:40]],
        ensure_ascii=False,
    )
    prompt = WRONG_ANALYSIS_USER_PROMPT.format(subject=req.subject, items_json=items_json)

    def _call_llm():
        llm = build_llm(req.model)
        from langchain_core.messages import HumanMessage, SystemMessage
        response = llm.invoke([
            SystemMessage(content=WRONG_ANALYSIS_SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ])
        parsed = _parse_json_object(_message_content_to_text(response.content))
        return _validate_wrong_analysis(parsed)

    try:
        return await run_in_threadpool(_call_llm)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"오답 분석 파싱 실패: {str(e)}") from e
    except ValueError as e:
        raise HTTPException(status_code=500, detail=f"오답 분석 응답 형식 오류: {str(e)}") from e
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        logger.exception("/quiz/analyze-wrong 실패")
        raise HTTPException(status_code=502, detail="오답 분석 중 오류가 발생했습니다.") from e


@app.post("/study-plan")
async def generate_study_plan(req: StudyPlanRequest, _user=Depends(require_api_user)):
    if not req.ddays and not req.incomplete_plans:
        raise HTTPException(status_code=400, detail="D-day나 미완료 학습 계획이 필요합니다.")

    prompt = STUDY_PLAN_USER_PROMPT.format(
        today=date.today().isoformat(),
        mode=req.mode,
        ddays_json=json.dumps([item.model_dump() for item in req.ddays], ensure_ascii=False),
        incomplete_json=json.dumps([item.model_dump() for item in req.incomplete_plans], ensure_ascii=False),
    )

    def _call_llm():
        llm = build_openai_llm(STUDY_PLAN_MODEL, max_tokens=900)
        response = llm.invoke([
            SystemMessage(content=STUDY_PLAN_SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ])
        parsed = _parse_json_object(_message_content_to_text(response.content))
        return _validate_study_plan(parsed)

    try:
        return await run_in_threadpool(_call_llm)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"학습 계획 파싱 실패: {str(e)}") from e
    except ValueError as e:
        raise HTTPException(status_code=500, detail=f"학습 계획 응답 형식 오류: {str(e)}") from e
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        logger.exception("/study-plan 생성 실패")
        raise HTTPException(status_code=502, detail="학습 계획 생성 중 오류가 발생했습니다.") from e


@app.get("/health")
def health():
    return {"status": "ok"}
