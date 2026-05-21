import json
import os
import base64
import zipfile
import tempfile
from pathlib import Path
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
from langchain_core.messages import HumanMessage, SystemMessage
from markitdown import MarkItDown
from pydantic import BaseModel, Field

from agent import run_study_agent, build_llm


app = FastAPI()

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
ALLOWED_ORIGINS = [FRONTEND_ORIGIN, "http://localhost:3000", "http://localhost:3001"]
ALLOWED_ORIGIN_REGEX = r"https://.*\.trycloudflare\.com"
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
GOOGLE_VISION_API_KEY = os.getenv("GOOGLE_VISION_API_KEY", "")
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
    "LECTURE_NOTE": """시험 대비용 강의 노트 형식으로 작성해.
- 아래 Markdown 제목을 정확히 이 순서와 이름으로만 사용해. '전체 흐름', '세부 설명' 같은 다른 최상위 제목은 만들지 마.
  # 제목
  ## 1. 학습 목표
  ## 2. 슬라이드별 핵심 흐름
  ## 3. 코드/수식 핵심
  ## 4. 핵심 개념 정리
  ## 5. 연습문제/과제
  ## 6. 시험 포인트
  ## 7. 복습 질문
- '# 제목' 바로 아래에는 자료의 실제 제목을 반드시 한 줄로 적어. 제목을 비워두지 마.
- 원문의 대단원/소단원 순서를 최대한 유지하고, 같은 제목이나 같은 설명을 반복하지 마.
- '슬라이드별 핵심 흐름'의 하위 제목은 자료에 실제로 등장한 제목이나 주제만 사용하고, 예시 제목이나 이전 자료의 제목을 재사용하지 마.
- '코드/수식 핵심'은 원문 코드 목록이 아니라 시험/구현에 필요한 핵심 원리만 요약해. 반드시 8~12개 bullet로 제한하고, 12개를 초과하지 마.
- '코드/수식 핵심'에서는 import, scene/camera/renderer 생성, geometry attribute 설정, controls 설정처럼 연속된 설정 코드를 각각 나열하지 말고 하나의 개념 bullet로 묶어.
- 개별 코드 줄은 꼭 필요한 대표 예시만 backtick으로 1개까지 인용하고, 같은 bullet 안에서 의미/주의점/시험 포인트를 설명해.
- 파일명, 제출일, 과제 조건, 좌표 목록은 '## 5. 연습문제/과제'에 정리하고, '코드/수식 핵심'에 섞지 마.
- 코드가 있는 자료라도 개념 설명과 실행 흐름을 우선 정리해. 함수명, 변수명, 행렬식, import는 필요한 경우에만 대표 표기로 보존해.
- 셰이더나 변환식처럼 단계가 바뀌는 내용은 초반 예제와 이후 적용 예제를 분리해서 설명해.
- built-in 항목은 가능하면 uniform과 attribute처럼 역할별로 나눠 정리해.
- 행렬 곱 순서, 좌표계, local/global 기준처럼 결과를 바꾸는 조건은 반드시 별도 bullet로 강조해.
- 연습문제와 과제는 요구사항, 위치값, 금지 조건, 제출일, 파일명 등 원문 조건을 빠뜨리지 말고 정확히 적어.
- 과제가 자료에 있으면 '## 5. 연습문제/과제'에 반드시 포함하고, 자료에 없으면 '과제: 자료에서 확인되지 않음'이라고 적어.""",
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
7. 코드, 수식, 파일명, 날짜, 숫자, 좌표, 함수명, 변수명은 가능한 한 원문 그대로 보존해.
8. 자료에서 글자가 흐리거나 내용이 불확실하면 추측하지 말고 **[확인 필요]**라고 표시해.
9. PDF 변환 결과에 코드가 일부 누락된 것처럼 보이면, 보이는 정보만 정리하고 누락 가능성을 **[확인 필요]**로 남겨.

[강의자료]
{markdown}

최종 출력 점검:
- {template_label} 템플릿 지시와 공통 기준만 따라 작성해.
- 템플릿 지시에서 허용한 최상위 Markdown 제목 외에는 새 최상위 제목을 만들지 마.
- 자료 앞뒤에 붙은 앱 UI 문구, 이전 요약 형식, 예시 제목을 출력에 섞지 마.
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
SUPPORTED_OCR_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp", "image/tiff"}
MAX_OCR_IMAGE_BYTES = 10 * 1024 * 1024

def _image_data_url(image_bytes: bytes, mime_type: str = "image/png") -> str:
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def _text_length(text: str) -> int:
    return len("".join(text.split()))


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
                "반드시 각 항목을 '## 라벨' 제목으로 시작하고, 이미지 순서대로 작성해. "
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

    return "# 이미지/손글씨 분석 결과\n\n" + "\n\n".join(sections)


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
        # 1단계: markitdown으로 텍스트 레이어 추출
        result = await run_in_threadpool(md_converter.convert, tmp_path)
        base_markdown = (result.text_content or "").strip()
        visual_markdown = ""
        try:
            visual_markdown = await run_in_threadpool(_analyze_document_visuals, tmp_path, suffix, base_markdown)
        except Exception as visual_error:
            visual_markdown = f"# 이미지/손글씨 분석 결과\n\n이미지/손글씨 분석 실패: {str(visual_error)}"
        markdown_parts = [part for part in [base_markdown, visual_markdown.strip()] if part]
        return {"markdown": "\n\n---\n\n".join(markdown_parts)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"변환 실패: {str(e)}") from e
    finally:
        os.unlink(tmp_path)


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
                params={"key": GOOGLE_VISION_API_KEY},
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
    prompt = SUMMARY_USER_PROMPT.format(
        template_label=TEMPLATE_LABELS[req.template],
        template_instruction=TEMPLATE_INSTRUCTIONS[req.template],
        markdown=req.markdown,
    )

    def _call_llm():
        from langchain_core.messages import HumanMessage, SystemMessage
        llm = build_llm(req.model)
        response = llm.invoke([
            SystemMessage(content="너는 대학 강의자료 요약 전문가다. 지시한 템플릿 형식으로만 요약하고, 후속 질문이나 추가 제안은 절대 붙이지 마."),
            HumanMessage(content=prompt),
        ])
        return {"result": _message_content_to_text(response.content).strip()}

    try:
        return await run_in_threadpool(_call_llm)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"요약 실패: {str(e)}") from e


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
