"""환경변수·런타임 설정 파싱 계층.

main.py에서 분리(Stage 6a). import 시 .env를 로드하고 os.getenv 기본값으로 설정 상수를 만든다.
auth/schemas/conversion 등 다른 서버 모듈이 여기서 설정을 가져간다. 다른 서버 모듈에 의존하지 않는다.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

SERVER_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SERVER_DIR.parent

load_dotenv(PROJECT_DIR / ".env")
load_dotenv(SERVER_DIR / ".env")

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
ALLOWED_ORIGINS = [
    FRONTEND_ORIGIN,
    "https://tongkk.vercel.app",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://localhost:3000",
    "http://localhost:3001",
]
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


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


VISUAL_ANALYSIS_MODE = os.getenv("VISUAL_ANALYSIS_MODE", "auto").lower()
# 시각 분석에 쓸 모델. 기본은 그래프·도표 해석 가성비가 좋은 Gemini 2.5 Flash.
VISUAL_ANALYSIS_MODEL = os.getenv("VISUAL_ANALYSIS_MODEL", "Gemini")
VISUAL_ANALYSIS_GEMINI_MODEL = os.getenv("VISUAL_ANALYSIS_GEMINI_MODEL", "gemini-2.5-flash")
VISUAL_ANALYSIS_OPENAI_MODEL = os.getenv("VISUAL_ANALYSIS_OPENAI_MODEL", "gpt-5.4-mini")
VISUAL_ANALYSIS_MAX_ITEMS = _env_int("VISUAL_ANALYSIS_MAX_ITEMS", 12)
VISUAL_ANALYSIS_BATCH_SIZE = max(1, _env_int("VISUAL_ANALYSIS_BATCH_SIZE", 4))
VISUAL_ANALYSIS_MIN_TEXT_CHARS = _env_int("VISUAL_ANALYSIS_MIN_TEXT_CHARS", 1200)
# 이미지 해석 시 함께 보내는 본문 텍스트(맥락)의 길이 상한.
VISUAL_CONTEXT_MAX_CHARS = _env_int("VISUAL_CONTEXT_MAX_CHARS", 1500)
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
# AI 튜터에 첨부할 수 있는 이미지 수와 1장당 data URL 길이 상한(base64 약 6MB 상당).
MAX_CHAT_IMAGES = _env_int("MAX_CHAT_IMAGES", 3)
MAX_CHAT_IMAGE_CHARS = _env_int("MAX_CHAT_IMAGE_CHARS", 8_000_000)
