import json
import logging
import os
import re
import base64
import hashlib
import zipfile
import shutil
import subprocess
import tempfile
from pathlib import Path
from datetime import date
from typing import Literal

import httpx

from config import (
    SERVER_DIR,
    PROJECT_DIR,
    FRONTEND_ORIGIN,
    ALLOWED_ORIGINS,
    GOOGLE_VISION_API_KEY,
    _env_int,
    VISUAL_ANALYSIS_MODE,
    VISUAL_ANALYSIS_MODEL,
    VISUAL_ANALYSIS_GEMINI_MODEL,
    VISUAL_ANALYSIS_OPENAI_MODEL,
    VISUAL_ANALYSIS_MAX_ITEMS,
    VISUAL_ANALYSIS_BATCH_SIZE,
    VISUAL_ANALYSIS_MIN_TEXT_CHARS,
    VISUAL_CONTEXT_MAX_CHARS,
    PDF_VISUAL_RENDER_DPI,
    PDF_VISUAL_TEXT_PAGE_CHARS,
    PPTX_IMAGE_EXTENSIONS,
    SUMMARY_MAX_TOKENS,
    MAX_MARKDOWN_CHARS,
    MAX_CHAT_CONTENT_CHARS,
    MAX_CHAT_MESSAGES,
    MAX_CHAT_IMAGES,
    MAX_CHAT_IMAGE_CHARS,
)

from fastapi import Depends, FastAPI, HTTPException, UploadFile, File
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from langchain_core.messages import HumanMessage, SystemMessage
from markitdown import MarkItDown

from agent import run_study_agent, build_llm, build_openai_llm

import convert_cache
from prompts import (
    TEMPLATE_LABELS,
    TEMPLATE_INSTRUCTIONS,
    SUMMARY_USER_PROMPT,
    SUMMARY_SYSTEM_PROMPT,
    QUIZ_SYSTEM_PROMPT,
    QUIZ_USER_PROMPT,
    STUDY_PLAN_MODEL,
    STUDY_PLAN_SYSTEM_PROMPT,
    STUDY_PLAN_USER_PROMPT,
    WRONG_ANALYSIS_SYSTEM_PROMPT,
    WRONG_ANALYSIS_USER_PROMPT,
    quiz_format_instruction,
    _VISUAL_SYSTEM_PROMPT,
    _citation_rule,
    _summary_system_content,
    _summary_user_focus_parts,
    _quiz_system_content,
    _quiz_user_focus_section,
)
from schemas import (
    SummarizeRequest,
    SummarizeStreamRequest,
    AgentRequest,
    QuizRequest,
    SubjectiveGradeRequest,
    WrongAnalysisRequest,
    StudyPlanRequest,
)
from llm import (
    _message_content_to_text,
    _strip_markdown_code_fence,
    _parse_quiz_json,
    _parse_json_object,
    _validate_quiz_questions,
    _validate_study_plan,
    _coerce_str_list,
    _validate_wrong_analysis,
    _run_llm_call,
)
from auth import require_api_user


app = FastAPI()

logger = logging.getLogger("tongkk")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # 실제 쓰는 것만 허용: 엔드포인트는 POST·GET(/health)뿐이고 프리플라이트가 OPTIONS를 쓴다.
    # 프론트가 보내는 요청 헤더는 Authorization·Content-Type뿐(backend.ts getJsonRequestHeaders).
    # allow_credentials는 미설정(기본 False) 유지 — 쿠키가 아니라 Bearer 토큰 인증이라 불필요.
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

md_converter = MarkItDown()


MaterialKind = Literal["pdf", "ppt", "img", "file"]


SUPPORTED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"}
SUPPORTED_CONVERT_EXTENSIONS = {".pdf", ".ppt", ".pptx", ".docx", *SUPPORTED_IMAGE_EXTENSIONS}
SUPPORTED_PREVIEW_EXTENSIONS = {".pdf", ".ppt", ".pptx", ".docx"}
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
        raise RuntimeError("PPT/PPTX·DOCX 미리보기를 사용하려면 서버에 LibreOffice가 설치되어 있어야 합니다.")

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
            raise RuntimeError("문서 PDF 변환 시간이 초과되었습니다.") from e

        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "").strip()
            raise RuntimeError(f"문서 PDF 변환 실패: {detail or 'LibreOffice 변환 오류'}")

        pdf_files = sorted(Path(output_dir).glob("*.pdf"))
        if not pdf_files:
            raise RuntimeError("문서 변환 결과 PDF를 찾지 못했습니다.")

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


def _pdf_page_image_coverage(page) -> float:
    """페이지에서 이미지(래스터) 블록이 차지하는 면적 비율(0~1)을 돌려준다.

    시각 풍부도 정렬용. coverage > 0이면 이미지가 있다는 뜻이라 기존
    '이미지 존재' 판정도 겸한다(전용 헬퍼를 따로 두지 않는다).
    """
    rect = page.rect
    page_area = float(rect.width * rect.height)
    if page_area <= 0:
        return 0.0
    image_area = 0.0
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 1:
            continue
        bbox = block.get("bbox")
        if bbox and len(bbox) == 4:
            image_area += max(0.0, bbox[2] - bbox[0]) * max(0.0, bbox[3] - bbox[1])
    return min(1.0, image_area / page_area)


# 한 페이지에서 시각 분석 맥락으로 함께 넘길 자동 추출 표의 최대 개수.
_MAX_PAGE_TABLES = 4


def _extract_page_tables_markdown(page) -> str:
    """born-digital 표를 PyMuPDF find_tables()로 추출해 Markdown 표 문자열로 돌려준다.

    표는 텍스트 레이어(get_text)에서 행·열 구조가 뭉개지므로, 구조가 보존된 표를
    시각 분석 맥락에 함께 실어 표 오독을 줄인다. 표가 없거나 추출에 실패하면 빈 문자열.
    """
    try:
        finder = page.find_tables()
    except Exception:
        return ""
    parts: list[str] = []
    for table in list(getattr(finder, "tables", []))[:_MAX_PAGE_TABLES]:
        try:
            md = (table.to_markdown() or "").strip()
        except Exception:
            continue
        if md:
            parts.append(md)
    return "\n\n".join(parts)


def _render_pdf_pages_for_visual_analysis(file_path: str, force: bool = False) -> list[dict[str, str]]:
    try:
        import fitz
    except ImportError as e:
        raise RuntimeError("PDF 이미지 분석을 위해 PyMuPDF가 필요합니다.") from e

    scale = PDF_VISUAL_RENDER_DPI / 72
    matrix = fitz.Matrix(scale, scale)

    pages: list[dict[str, str]] = []
    with fitz.open(file_path) as doc:
        # 1) 분석 후보 선정: 텍스트가 적거나(제목·도식 슬라이드) 이미지가 있는 페이지.
        #    각 후보의 시각 풍부도(이미지 면적 비율)를 함께 기록한다.
        candidates: list[tuple[int, float]] = []
        for index in range(len(doc)):
            page = doc.load_page(index)
            coverage = _pdf_page_image_coverage(page)
            if force:
                candidates.append((index, coverage))
                continue
            page_text_len = _text_length(page.get_text("text") or "")
            if page_text_len < PDF_VISUAL_TEXT_PAGE_CHARS or coverage > 0:
                candidates.append((index, coverage))

        # 2) 후보가 상한을 넘으면 문서 순서로 앞쪽만 자르지 말고, 시각 풍부도가 높은
        #    페이지부터 상한만큼 고른다(같은 예산으로 그림이 많은 페이지를 더 읽기 위함).
        #    sorted는 안정 정렬이라 풍부도가 같으면(예: 0) 페이지 순서가 유지된다.
        #    최종 선택은 출력·페이지 마커 정합을 위해 페이지 번호 오름차순으로 되돌린다.
        if len(candidates) > VISUAL_ANALYSIS_MAX_ITEMS:
            candidates = sorted(candidates, key=lambda c: c[1], reverse=True)[:VISUAL_ANALYSIS_MAX_ITEMS]
        selected_indexes = sorted(index for index, _ in candidates)

        # 3) 선택 페이지를 렌더링하고, 같은 페이지의 텍스트 레이어와 구조가 보존된 표를
        #    맥락으로 함께 싣는다(작은 글씨 오독·표 행열 붕괴 완화).
        for index in selected_indexes:
            page = doc.load_page(index)
            pixmap = page.get_pixmap(matrix=matrix, alpha=False)
            page_text = (page.get_text("text") or "").strip()
            context_parts: list[str] = []
            if page_text:
                context_parts.append(page_text[:VISUAL_CONTEXT_MAX_CHARS])
            table_md = _extract_page_tables_markdown(page)
            if table_md:
                context_parts.append(f"[페이지 표(자동 추출)]\n{table_md}")
            pages.append({
                "label": f"PDF {index + 1}페이지",
                "data_url": _image_data_url(pixmap.tobytes("png")),
                "context": "\n\n".join(context_parts),
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
    # PDF·PPTX는 본문 텍스트 양과 무관하게 삽입 이미지를 해석한다.
    # (이미지가 없으면 _collect_visual_inputs가 빈 목록을 돌려 분석을 건너뛴다.)
    return suffix in {".pdf", ".pptx"}


def _collect_visual_inputs(file_path: str, suffix: str, force: bool = False) -> list[dict[str, str]]:
    if suffix == ".pdf":
        return _render_pdf_pages_for_visual_analysis(file_path, force)
    if suffix == ".pptx":
        return _extract_pptx_images_for_visual_analysis(file_path)
    return []


def _visual_batches(items: list) -> list[list]:
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


# 변환 로직(텍스트 추출, _run_visual_llm의 사용자 프롬프트 문자열, 배치 구성 등)을 바꾸면
# 반드시 수동으로 올릴 것 — 아래 지문은 env 설정과 시스템 프롬프트만 추적한다.
# v2: PDF 시각 페이지 선택을 시각 풍부도 기준 정렬로 변경 + born-digital 표(find_tables)를
#     시각 분석 맥락에 주입.
CONVERT_PIPELINE_VERSION = "2"

# 캐시 키에 들어가는 설정 지문. 프롬프트·모델·DPI 등이 바뀌면 키 공간이 통째로 갈려
# 기존 캐시가 자동 무효화된다(모듈 로드 시 1회 계산).
_CONVERT_CONFIG_FINGERPRINT = hashlib.sha256("|".join([
    CONVERT_PIPELINE_VERSION,
    _VISUAL_SYSTEM_PROMPT,
    VISUAL_ANALYSIS_MODE,
    VISUAL_ANALYSIS_MODEL,
    VISUAL_ANALYSIS_GEMINI_MODEL,
    VISUAL_ANALYSIS_OPENAI_MODEL,
    str(VISUAL_ANALYSIS_MAX_ITEMS),
    str(VISUAL_ANALYSIS_BATCH_SIZE),
    str(VISUAL_CONTEXT_MAX_CHARS),
    str(PDF_VISUAL_RENDER_DPI),
    str(PDF_VISUAL_TEXT_PAGE_CHARS),
]).encode("utf-8")).hexdigest()


def _sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _file_cache_key(file_bytes: bytes, suffix: str) -> str:
    return f"{hashlib.sha256(file_bytes).hexdigest()}|{suffix}|{_CONVERT_CONFIG_FINGERPRINT}"


def _visual_item_cache_key(item: dict[str, str]) -> str:
    # label 포함은 필수 — 캐시된 섹션 제목('## PDF N페이지')에서 페이지 마커(<!-- p.N -->)를
    # 다시 심으므로, 같은 이미지라도 라벨이 다르면 다른 항목으로 취급해야 정합이 맞는다.
    return "|".join([
        _sha256_text(item["data_url"]),
        _sha256_text(item.get("context") or ""),
        item["label"],
        _CONVERT_CONFIG_FINGERPRINT,
    ])


def _preview_cache_key(file_bytes: bytes, suffix: str) -> str:
    # LibreOffice 교체 등으로 변환 결과가 달라지면 CONVERT_PIPELINE_VERSION을 올려 무효화한다.
    return f"{hashlib.sha256(file_bytes).hexdigest()}|{suffix}|preview|{CONVERT_PIPELINE_VERSION}"


def _visual_llm_ready() -> bool:
    """_build_visual_llm과 동일한 API 키 체크만 수행한다(클라이언트 생성 없이).

    키 부재로 시각 분석이 조용히 빠진 '열화' markdown을 캐시에 저장하지 않기 위한 판정용.
    VISUAL_ANALYSIS_MODE가 off면 키가 없어도 저장 가능하다(off는 설정 지문에 들어 있어
    모드를 켜면 자동으로 다른 키 공간이 된다).
    """
    if VISUAL_ANALYSIS_MODEL == "GPT":
        return bool(os.getenv("OPENAI_API_KEY"))
    return bool(os.getenv("GEMINI_API_KEY"))


def _build_visual_llm():
    """시각 분석용 LLM을 만든다. 키가 없으면 None을 돌려 호출부가 분석을 건너뛰게 한다."""
    if VISUAL_ANALYSIS_MODEL == "GPT":
        if not os.getenv("OPENAI_API_KEY"):
            return None
        return build_llm("GPT", model_name=VISUAL_ANALYSIS_OPENAI_MODEL)
    if not os.getenv("GEMINI_API_KEY"):
        return None
    return build_llm("Gemini", model_name=VISUAL_ANALYSIS_GEMINI_MODEL)


_NO_CONTENT_SENTINEL = "유의미한 학습 내용 없음"


def _split_visual_sections(text: str, labels: list[str]) -> list[str] | None:
    """배치 응답을 라벨 제목 줄 기준으로 item별 섹션으로 나눈다.

    각 라벨의 제목 줄을 앞에서부터 순차 탐색(이전 매치 끝 이후에서만 다음 라벨 검색)해,
    전부 순서대로 발견될 때만 분리한다. 하나라도 실패하면 None(보수적 폴백 — 통짜 사용).
    분리 성공 시 첫 제목 앞의 서두 텍스트는 버려진다 — 의도된 동작이며 모델 인사말
    수준이라 손실이 없다.
    """
    positions: list[int] = []
    cursor = 0
    for label in labels:
        match = re.compile(
            rf"(?m)^#{{1,6}}\s+[^\n]*{re.escape(label)}[^\n]*$"
        ).search(text, cursor)
        if match is None:
            return None
        positions.append(match.start())
        cursor = match.end()
    ends = positions[1:] + [len(text)]
    return [text[start:end].strip() for start, end in zip(positions, ends)]


def _is_no_content_section(section: str) -> bool:
    """제목 줄을 뺀 본문이 '유의미한 학습 내용 없음'뿐인 섹션인지 판별한다."""
    body = "\n".join(
        line for line in section.splitlines() if not line.lstrip().startswith("#")
    ).strip()
    return body == _NO_CONTENT_SENTINEL


def _run_visual_llm(visual_inputs: list[dict[str, str]], shared_context: str = "") -> str:
    """이미지 목록을 시각 분석 모델에 보내 해석 결과(섹션들)를 합쳐 돌려준다."""
    llm = _build_visual_llm()
    if llm is None:
        return ""

    # shared_context가 없을 때(=PDF 페이지·단독 이미지)만 item 단위 캐시를 쓴다.
    # PPTX는 본문 전체를 공통 맥락으로 줘 item이 자기 완결적이지 않으므로 제외.
    # 캐시에는 페이지 마커 태깅 전 텍스트가 저장되지만, 태깅(_tag_visual_pdf_pages)은
    # 호출부가 조립 결과에 매번 다시 적용하므로 안전하다.
    use_item_cache = not shared_context
    sections_by_index: dict[int, str] = {}
    misses: list[tuple[int, dict[str, str]]] = []
    if use_item_cache:
        for index, item in enumerate(visual_inputs):
            cached = convert_cache.get_visual_section(_visual_item_cache_key(item))
            if cached is not None:
                sections_by_index[index] = cached
            else:
                misses.append((index, item))
    else:
        misses = list(enumerate(visual_inputs))

    for batch_pairs in _visual_batches(misses):
        batch = [item for _, item in batch_pairs]
        content: list[dict[str, object]] = [{
            "type": "text",
            "text": (
                "아래 강의자료 이미지들을 각각 구분해서 분석해줘. "
                "반드시 각 항목을 제공된 라벨을 그대로 쓴 '## 라벨' 제목(예: '## PDF 3페이지')으로 시작하고, "
                "이미지 순서대로 작성해. "
                "전사뿐 아니라 그래프·도표의 의미와, 본문 텍스트가 주어졌다면 본문과의 연관성(왜 삽입됐는지)을 함께 설명해. "
                "분석 대상: " + ", ".join(item["label"] for item in batch)
            ),
        }]
        if shared_context:
            content.append({
                "type": "text",
                "text": f"[강의자료 본문 텍스트(참고용)]\n{shared_context}",
            })
        for item in batch:
            content.append({"type": "text", "text": f"[{item['label']}]"})
            item_context = (item.get("context") or "").strip()
            if item_context:
                content.append({
                    "type": "text",
                    "text": f"[{item['label']} 본문 텍스트]\n{item_context}",
                })
            content.append({"type": "image_url", "image_url": {"url": item["data_url"]}})

        response = llm.invoke([
            SystemMessage(content=_VISUAL_SYSTEM_PROMPT),
            HumanMessage(content=content),
        ])
        text = _message_content_to_text(response.content).strip()
        if not text or text == _NO_CONTENT_SENTINEL:
            continue
        if use_item_cache:
            split_sections = _split_visual_sections(text, [item["label"] for item in batch])
            if split_sections is not None:
                for (index, item), section in zip(batch_pairs, split_sections):
                    convert_cache.set_visual_section(_visual_item_cache_key(item), section)
                    sections_by_index[index] = section
                continue
        # 분리 실패(또는 PPTX 공통 맥락 모드): 통짜 텍스트를 배치 첫 item 위치에 두고 저장하지 않는다.
        sections_by_index[batch_pairs[0][0]] = text

    # '유의미한 학습 내용 없음' 섹션은 캐시에는 남기되(유효 결과 — 재변환 때 LLM 호출 절약)
    # 출력에서는 제외한다(현행 배치 단위 스킵과 동등).
    return "\n\n".join(
        sections_by_index[index]
        for index in sorted(sections_by_index)
        if not _is_no_content_section(sections_by_index[index])
    )


def _analyze_document_visuals(file_path: str, suffix: str, base_markdown: str = "") -> str:
    force_visual_scan = VISUAL_ANALYSIS_MODE in {"on", "always", "true", "1"}
    if not force_visual_scan and not _should_analyze_visuals(base_markdown, suffix):
        return ""

    visual_inputs = _collect_visual_inputs(file_path, suffix, force_visual_scan)
    if not visual_inputs:
        return ""

    # PPTX 삽입 이미지는 슬라이드 번호와 1:1로 매칭되지 않으므로 본문 전체를 공통 맥락으로 준다.
    shared_context = base_markdown[:VISUAL_CONTEXT_MAX_CHARS] if (suffix == ".pptx" and base_markdown) else ""
    body_text = _run_visual_llm(visual_inputs, shared_context)
    if not body_text:
        return ""

    body = "# 이미지/손글씨 분석 결과\n\n" + body_text
    # PDF는 페이지별로 렌더링·분석하므로 'PDF N페이지' 섹션마다 페이지 마커를 심어,
    # 페이지 선택 요약이 이미지 슬라이드에도 적용되게 한다. (PPTX 삽입 이미지는 슬라이드 번호와
    # 1:1로 매칭되지 않아, 본문 markitdown의 'Slide number' 마커에만 의존한다.)
    if suffix == ".pdf":
        body = _tag_visual_pdf_pages(body)
    return body


def _image_to_png_bytes(path: str) -> bytes:
    """업로드 이미지를 시각 분석 모델 호환성이 높은 PNG로 변환한다(투명 배경은 흰색으로)."""
    import io

    from PIL import Image

    with Image.open(path) as image:
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        background.alpha_composite(rgba)
        buffer = io.BytesIO()
        background.convert("RGB").save(buffer, format="PNG")
        return buffer.getvalue()


def _analyze_uploaded_image(path: str) -> str:
    """단독 업로드 이미지를 시각 분석 모델로 해석한다. 키가 없으면 빈 문자열."""
    png_bytes = _image_to_png_bytes(path)
    item = {"label": "업로드 이미지", "data_url": _image_data_url(png_bytes, "image/png")}
    return _run_visual_llm([item])


@app.post("/convert")
async def convert_document_to_markdown(
    file: UploadFile = File(...),
    _user=Depends(require_api_user),
):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in SUPPORTED_CONVERT_EXTENSIONS:
        raise HTTPException(status_code=400, detail="PDF, PPT/PPTX, DOCX, 이미지 파일만 지원합니다.")

    file_bytes = await file.read()
    if suffix in SUPPORTED_IMAGE_EXTENSIONS:
        if len(file_bytes) > MAX_OCR_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="이미지 파일은 10MB 이하만 OCR할 수 있습니다.")
    elif len(file_bytes) > MAX_DOCUMENT_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"문서 파일은 {MAX_DOCUMENT_BYTES // (1024 * 1024)}MB 이하만 변환할 수 있습니다.",
        )

    # 전역(사용자 무관) 캐시: 같은 수업 수강생들이 바이트 동일 강의자료를 올리는 구조라
    # 해시 캐시 적중률이 높다. SQLite I/O는 threadpool로 감싸 이벤트 루프를 막지 않는다.
    cache_key = _file_cache_key(file_bytes, suffix)
    cached_markdown = await run_in_threadpool(convert_cache.get_markdown, cache_key)
    if cached_markdown is not None:
        return {"markdown": cached_markdown}

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        if suffix in SUPPORTED_IMAGE_EXTENSIONS:
            # 1순위: 시각 분석 모델로 이미지를 읽고 해석한다(텍스트가 없는 그래프·도식도 처리).
            analysis = ""
            analysis_failed = False
            try:
                analysis = await run_in_threadpool(_analyze_uploaded_image, tmp_path)
            except Exception:
                logger.exception("업로드 이미지 시각 분석 실패")
                analysis_failed = True
            if analysis:
                markdown = f"# 이미지 분석 결과\n\n{analysis}"
                await run_in_threadpool(convert_cache.set_markdown, cache_key, markdown)
                return {"markdown": markdown}
            # 폴백: 시각 분석 키가 없거나 결과가 비면 기존 Tesseract OCR로 글자만 추출한다.
            text = await run_in_threadpool(_extract_image_text_with_tesseract, tmp_path)
            markdown = f"# 이미지 OCR 결과\n\n{text}" if text else "# 이미지 OCR 결과\n\n인식된 텍스트가 없습니다."
            # 키 부재(열화)·분석 예외(일시 장애)로 폴백된 OCR-only 결과는 저장하지 않는다 —
            # 키/장애 복구 후에도 TTL 동안 굳는 것을 막는다. 키가 있고 분석이 정상 수행됐다면
            # '로고 → 유의미 없음 → OCR 폴백'도 유효한 결과이므로 저장한다(빈 결과는 제외).
            if text and not analysis_failed and _visual_llm_ready():
                await run_in_threadpool(convert_cache.set_markdown, cache_key, markdown)
            return {"markdown": markdown}

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
        visual_failed = False
        try:
            visual_markdown = await run_in_threadpool(_analyze_document_visuals, tmp_path, suffix, base_markdown)
        except Exception:
            logger.exception("이미지/손글씨 분석 실패")
            visual_markdown = "# 이미지/손글씨 분석 결과\n\n이미지/손글씨 분석을 완료하지 못했습니다."
            visual_failed = True
        markdown_parts = [part for part in [base_markdown, visual_markdown.strip()] if part]
        markdown = "\n\n---\n\n".join(markdown_parts)
        # 시각 분석이 예외로 플레이스홀더가 됐거나, 분석이 필요한 자료인데 API 키 부재로
        # 조용히 빠진 열화 결과는 저장하지 않는다(키 복구 후에도 TTL 동안 굳는 것 차단).
        # 그 외(분석 완료·분석 대상 없음·모드 off)는 저장한다.
        degraded = _should_analyze_visuals(base_markdown, suffix) and not _visual_llm_ready()
        if not visual_failed and not degraded:
            await run_in_threadpool(convert_cache.set_markdown, cache_key, markdown)
        return {"markdown": markdown}
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
        raise HTTPException(status_code=400, detail="PDF, PPT/PPTX, DOCX 파일만 미리보기를 지원합니다.")

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

    # PPT/PPTX만 LibreOffice 변환을 거치므로 그 결과를 캐싱한다(수 MB 블롭 I/O는 threadpool로).
    preview_key = _preview_cache_key(file_bytes, suffix)
    cached_pdf = await run_in_threadpool(convert_cache.get_preview, preview_key)
    if cached_pdf is not None:
        return Response(
            content=cached_pdf,
            media_type="application/pdf",
            headers={"Content-Disposition": 'inline; filename="preview.pdf"'},
        )

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        pdf_bytes = await run_in_threadpool(_convert_presentation_to_pdf, tmp_path)
        await run_in_threadpool(convert_cache.set_preview, preview_key, pdf_bytes)
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
    focus_checklist, focus_user_tail = _summary_user_focus_parts(req.template, req.focus_prompt)
    prompt = SUMMARY_USER_PROMPT.format(
        template_label=TEMPLATE_LABELS[req.template],
        template_instruction=TEMPLATE_INSTRUCTIONS[req.template],
        citation_rule=_citation_rule(req.source_names),
        markdown=markdown,
        focus_checklist=focus_checklist,
        focus_user_tail=focus_user_tail,
    )

    system_content = _summary_system_content(req.focus_prompt)

    def _call_llm():
        from langchain_core.messages import HumanMessage, SystemMessage
        llm = build_llm(req.model, max_tokens=SUMMARY_MAX_TOKENS)
        response = llm.invoke([
            SystemMessage(content=system_content),
            HumanMessage(content=prompt),
        ])
        return {"result": _message_content_to_text(response.content).strip()}

    return await _run_llm_call(
        _call_llm,
        fail_message="요약 생성 중 오류가 발생했습니다.",
        log_message="/summarize 실패",
        handle_parse_errors=False,
    )


def _sse_event(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _summary_chunk_instructions(req: SummarizeStreamRequest) -> str:
    """구간 분할 생성 시, 구간임을 알리고 직전 구간과 자연스럽게 이어지게 하는 지시."""
    lines = [
        "\n\n[구간 분할 요약]",
        f"지금 주어진 강의자료는 전체 자료를 나눈 {req.chunk_total}개 구간 중 {req.chunk_index}번째 구간이다.",
        "- 이 구간의 내용만 정리하고, 전체 자료에 대한 서론·총정리·마무리 멘트를 만들지 마.",
    ]
    if req.chunk_index == 1:
        lines.append("- 첫 구간이므로 문서 제목(# 수준)을 한 번만 만들고 시작해.")
    elif req.is_continuation:
        # 같은 원본 섹션이 길어서 쪼개진 '이어지는' 구간 → 직전에 만든 제목을 다시 만들면 안 된다.
        lines.append(
            "- 이 구간은 직전 구간에서 다루던 같은 원본 섹션의 뒷부분이다. "
            "문서 제목(#)이나 직전 구간에서 이미 만든 단원·소단원 제목(##/###)을 다시 만들지 말고, "
            "직전 요약이 끊긴 지점에서 곧바로 이어서 내용만 작성해. 같은 제목을 새로 달면 안 된다."
        )
    else:
        lines.append("- 첫 구간이 아니므로 문서 제목(# 수준)을 다시 만들지 말고, 이어지는 단원 제목(## 수준)부터 바로 시작해.")
    if req.previous_tail and req.previous_tail.strip():
        lines.append(
            "- 아래는 직전 구간 요약의 끝부분이다. 제목 수준과 흐름이 자연스럽게 이어지게 하되, 같은 내용을 반복하지 마.\n"
            "[직전 구간 요약 끝부분]\n"
            f"{req.previous_tail.strip()}"
        )
    return "\n".join(lines)


@app.post("/summarize/stream")
async def summarize_stream(req: SummarizeStreamRequest, _user=Depends(require_api_user)):
    """요약을 SSE로 토큰 단위 스트리밍한다.

    한 요청의 출력이 짧게 유지되도록 클라이언트가 자료를 구간으로 나눠 호출하고,
    응답이 계속 흐르는 동안은 Cloudflare 터널 응답 대기 제한(~100초)에 걸리지 않는다.
    이벤트: {"delta": str} 반복 → {"done": true, "finish_reason": str}. 오류 시 {"error": str}.
    """
    markdown = _filter_markdown_by_pages(req.markdown, req.pages)
    focus_checklist, focus_user_tail = _summary_user_focus_parts(req.template, req.focus_prompt)
    prompt = SUMMARY_USER_PROMPT.format(
        template_label=TEMPLATE_LABELS[req.template],
        template_instruction=TEMPLATE_INSTRUCTIONS[req.template],
        citation_rule=_citation_rule(req.source_names),
        markdown=markdown,
        focus_checklist=focus_checklist,
        focus_user_tail=focus_user_tail,
    )

    system_content = _summary_system_content(req.focus_prompt)
    if req.chunk_index and req.chunk_total and req.chunk_total > 1:
        system_content += _summary_chunk_instructions(req)

    async def event_stream():
        finish_reason = ""
        try:
            llm = build_llm(req.model, max_tokens=SUMMARY_MAX_TOKENS)
            async for chunk in llm.astream([
                SystemMessage(content=system_content),
                HumanMessage(content=prompt),
            ]):
                text = _message_content_to_text(chunk.content)
                if text:
                    yield _sse_event({"delta": text})
                metadata = getattr(chunk, "response_metadata", None) or {}
                reason = metadata.get("finish_reason") or metadata.get("stop_reason")
                if reason:
                    finish_reason = str(reason)
        except Exception:
            logger.exception("/summarize/stream 실패")
            yield _sse_event({"error": "요약 생성 중 오류가 발생했습니다."})
            return
        yield _sse_event({"done": True, "finish_reason": finish_reason})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        # 프록시(Vite·Cloudflare)가 스트림을 버퍼링하지 않도록 명시한다.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/agent")
async def agent(req: AgentRequest, _user=Depends(require_api_user)):
    messages = [message.model_dump() for message in req.messages]
    # 요약에 쓰인 페이지 범위(pages)가 있으면 원본도 같은 범위로 좁힌다(마커 기준; 없으면 전체).
    source = _filter_markdown_by_pages(req.source_markdown, req.pages) if req.source_markdown else ""
    # 원본이 너무 길면 컨텍스트엔 요약만 넣고, 원본은 inspect_original_source 도구로 on-demand 조회하게 한다.
    source_inline_limit = 12000  # 자(char) 기준
    # 자료 컨텍스트는 대화 메시지로 insert하지 않고 reference_context로 넘긴다. _agent_node가 매 턴
    # SystemMessage에 1회만 주입하므로, InMemorySaver 이력에 턴마다 중복 누적되지 않는다(토큰·지연 급증 방지).
    reference_context = ""
    if source and len(source) <= source_inline_limit:
        parts = [f"[원본 강의자료 본문]\n{source}"]
        if req.markdown:
            parts.append(f"[정리된 요약]\n{req.markdown}")
        reference_context = (
            "다음 자료를 현재 대화의 참고 자료로 사용해. "
            "사실과 내용의 근거는 [원본 강의자료 본문]을 우선하고, "
            "[정리된 요약]은 구조·정리 참고용으로만 사용해.\n\n"
            + "\n\n".join(parts)
        )
    elif req.markdown:
        note = (
            " 원본 본문은 길어서 기본 컨텍스트에는 요약만 넣었어. "
            "요약이 의심스럽거나 원본 확인이 필요하면 inspect_original_source 도구로 원본을 확인해."
            if source
            else ""
        )
        reference_context = f"다음 강의자료를 현재 대화의 참고 자료로 사용해.{note}\n\n[정리된 요약]\n{req.markdown}"

    return await _run_llm_call(
        lambda: run_study_agent(req.model, messages, req.thread_id, source, reference_context),
        fail_message="AI 튜터 응답 생성 중 오류가 발생했습니다.",
        log_message="/agent 실행 실패",
        handle_parse_errors=False,
    )


@app.post("/quiz")
async def generate_quiz(req: QuizRequest, _user=Depends(require_api_user)):
    filtered_markdown = _filter_markdown_by_pages(req.markdown, req.pages) if req.markdown else None
    markdown_section = f"\n강의자료:\n{filtered_markdown}\n" if filtered_markdown else ""
    exclude_section = ""
    excluded = [q.strip() for q in req.exclude_questions if isinstance(q, str) and q.strip()][:80]
    if excluded:
        joined = "\n".join(f"- {q}" for q in excluded)
        exclude_section = (
            "\n[이미 출제된 문제 — 아래와 중복되거나 거의 같은 문제는 절대 내지 마라. "
            "다른 개념·다른 관점으로 새로운 문제를 만들어라]\n"
            f"{joined}\n"
        )
    # 진단 퀴즈는 '전 범위 균등 출제'가 목적이라 집중 요청(특히 범위 한정)과 정면 충돌한다.
    # 진단일 때는 focus를 무력화해 전 범위 진단을 보존한다.
    effective_focus = None if req.diagnostic else req.focus_prompt
    prompt = QUIZ_USER_PROMPT.format(
        subject=req.subject,
        count=req.count,
        difficulty=req.difficulty,
        question_type=req.question_type,
        markdown_section=markdown_section,
        exclude_section=exclude_section,
        focus_quiz_section=_quiz_user_focus_section(effective_focus),
    )
    if req.diagnostic:
        prompt = (
            "[진단 퀴즈] 학습 전 수준 진단용이다. 자료의 전체 범위에서 단원·주제별로 골고루 1문제씩, "
            "핵심 개념을 확인하는 기초 문제로 출제해라.\n\n" + prompt
        )

    def _call_llm():
        llm = build_llm(req.model)
        from langchain_core.messages import HumanMessage, SystemMessage
        response = llm.invoke([
            SystemMessage(content=_quiz_system_content(req.question_type, effective_focus)),
            HumanMessage(content=prompt),
        ])
        text = _message_content_to_text(response.content)
        parsed = _parse_quiz_json(text)
        return _validate_quiz_questions(parsed, req.question_type)

    questions = await _run_llm_call(
        _call_llm,
        error_label="퀴즈",
        fail_message="퀴즈 생성 중 오류가 발생했습니다.",
        log_message="/quiz 생성 실패",
    )
    return {"questions": questions}


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

    return await _run_llm_call(
        _call_llm,
        error_label="주관식 채점",
        fail_message="주관식 채점 중 오류가 발생했습니다.",
        log_message="/quiz/grade-subjective 실패",
    )


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

    return await _run_llm_call(
        _call_llm,
        error_label="오답 분석",
        fail_message="오답 분석 중 오류가 발생했습니다.",
        log_message="/quiz/analyze-wrong 실패",
    )


@app.post("/study-plan")
async def generate_study_plan(req: StudyPlanRequest, _user=Depends(require_api_user)):
    if not req.ddays and not req.incomplete_plans:
        raise HTTPException(status_code=400, detail="D-day나 미완료 학습 계획이 필요합니다.")

    learner_info = {
        key: value
        for key, value in (("goal", req.goal), ("familiarity", req.familiarity), ("daily_minutes", req.daily_minutes))
        if value is not None
    }
    learner_section = (
        f"\n[학습자 정보]\n{json.dumps(learner_info, ensure_ascii=False)}\n\n" if learner_info else "\n"
    )
    courses_section = (
        f"\n[과목 학습 상태]\n{json.dumps([item.model_dump() for item in req.courses], ensure_ascii=False)}\n"
        if req.courses else ""
    )
    review_section = (
        f"\n[복습 추천 후보]\n{json.dumps([item.model_dump() for item in req.review_candidates], ensure_ascii=False)}\n"
        if req.review_candidates else ""
    )
    prompt = STUDY_PLAN_USER_PROMPT.format(
        today=date.today().isoformat(),
        mode=req.mode,
        learner_section=learner_section,
        ddays_json=json.dumps([item.model_dump() for item in req.ddays], ensure_ascii=False),
        incomplete_json=json.dumps([item.model_dump() for item in req.incomplete_plans], ensure_ascii=False),
        courses_section=courses_section,
        review_section=review_section,
    )

    def _call_llm():
        # 시험 분산 배치 시 항목이 최대 12개까지 늘어 토큰 여유를 둔다.
        llm = build_openai_llm(STUDY_PLAN_MODEL, max_tokens=1400)
        response = llm.invoke([
            SystemMessage(content=STUDY_PLAN_SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ])
        parsed = _parse_json_object(_message_content_to_text(response.content))
        return _validate_study_plan(parsed)

    return await _run_llm_call(
        _call_llm,
        error_label="학습 계획",
        fail_message="학습 계획 생성 중 오류가 발생했습니다.",
        log_message="/study-plan 생성 실패",
    )


@app.get("/health")
def health():
    return {"status": "ok"}
