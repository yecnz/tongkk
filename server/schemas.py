"""요청/응답 Pydantic 모델 계층.

main.py에서 분리(Stage 6a). 입력 길이 상한 등은 config에서 가져온다.
라우터들이 엔드포인트 시그니처 타입으로 사용한다.
"""
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from config import (
    MAX_CHAT_CONTENT_CHARS,
    MAX_CHAT_IMAGES,
    MAX_CHAT_IMAGE_CHARS,
    MAX_CHAT_MESSAGES,
    MAX_MARKDOWN_CHARS,
)

SummaryTemplate = Literal["GENERAL", "LECTURE_NOTE", "MINDMAP", "CHEAT_SHEET"]


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(default="", max_length=MAX_CHAT_CONTENT_CHARS)
    # 사용자가 첨부한 이미지(data:image/...;base64,...). 비어 있으면 일반 텍스트 메시지.
    images: list[str] = Field(default_factory=list, max_length=MAX_CHAT_IMAGES)

    @model_validator(mode="after")
    def _validate_content_or_images(self) -> "ChatMessage":
        if not self.content.strip() and not self.images:
            raise ValueError("메시지에는 내용이나 이미지가 하나 이상 있어야 합니다.")
        for image in self.images:
            if not image.startswith("data:image/"):
                raise ValueError("이미지는 data:image/... 형식의 data URL이어야 합니다.")
            if len(image) > MAX_CHAT_IMAGE_CHARS:
                raise ValueError("첨부 이미지 크기가 너무 큽니다.")
        return self


class SummarizeRequest(BaseModel):
    markdown: str = Field(min_length=1, max_length=MAX_MARKDOWN_CHARS)
    template: SummaryTemplate = "GENERAL"
    model: Literal["GPT", "Gemini"] = "GPT"
    thread_id: str | None = None
    # 사용자가 "1-5, 8"처럼 지정한 반영 페이지. 비우면 전체.
    pages: str | None = None
    # 사용자가 집중을 원하는 내용. 시스템·유저 프롬프트 양쪽에 반영한다(짧은 지시문이라 상한을 둔다).
    focus_prompt: str | None = Field(default=None, max_length=1000)
    # 요약에 포함된 자료 이름 목록. 2개 이상이면 출처에 자료명을 함께 적게 한다.
    source_names: list[str] | None = Field(default=None, max_length=50)


class SummarizeStreamRequest(SummarizeRequest):
    # 구간 분할 생성: 전체 chunk_total개 중 chunk_index(1-base)번째 구간 요청임을 알린다.
    chunk_index: int | None = Field(default=None, ge=1)
    chunk_total: int | None = Field(default=None, ge=1)
    # 직전 구간 요약의 끝부분. 제목 수준·흐름을 이어가되 내용 반복을 막는 용도.
    previous_tail: str | None = Field(default=None, max_length=6000)
    # 직전 구간과 같은 원본 섹션이 글자수 한도 때문에 쪼개진 '이어지는' 구간인지 여부.
    # True면 새 제목을 만들지 말고 직전 요약 끝에 곧바로 이어 쓰게 한다.
    is_continuation: bool = False


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
    # 학습 전 수준 진단용 퀴즈: 전 범위에서 단원별로 골고루, 기초 개념 위주로 출제.
    diagnostic: bool = False
    # 사용자가 "1-5, 8"처럼 지정한 출제 페이지. 비우면 전체. (요약과 동일한 마커 기반 필터)
    pages: str | None = None
    # 사용자가 집중을 원하는 내용. 시스템·유저 프롬프트 양쪽에 반영한다(짧은 지시문이라 상한을 둔다).
    focus_prompt: str | None = Field(default=None, max_length=1000)


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
    type: Literal["assignment", "event", "exam"] = "assignment"
    subj: str = Field(min_length=1)
    date: str = Field(min_length=1)


class StudyPlanItem(BaseModel):
    id: str | None = None
    text: str = Field(min_length=1)
    done: bool = False


class StudyPlanCourse(BaseModel):
    """학습계획 처방 근거가 되는 과목별 학습 상태 요약."""
    name: str = Field(min_length=1)
    materials: int = Field(default=0, ge=0)
    summaries: int = Field(default=0, ge=0)
    quiz_sets: int = Field(default=0, ge=0)
    attempts: int = Field(default=0, ge=0)
    last_score_percent: int | None = Field(default=None, ge=0, le=100)
    recent_wrong_count: int = Field(default=0, ge=0)
    days_since_last_attempt: int | None = Field(default=None, ge=0)


class StudyPlanReviewCandidate(BaseModel):
    """간격 반복 복습 후보(며칠 전 학습한 내용)."""
    course: str = Field(min_length=1)
    days_since: int = Field(default=1, ge=0)
    score_percent: int | None = Field(default=None, ge=0, le=100)


class StudyPlanRequest(BaseModel):
    ddays: list[StudyPlanDday] = Field(default_factory=list)
    incomplete_plans: list[StudyPlanItem] = Field(default_factory=list)
    mode: Literal["balanced", "lighter", "harder", "assignment", "event", "reroll"] = "balanced"
    # 콜드 스타트 대응 학습자 정보(선택). 없으면 기존과 동일하게 동작한다.
    goal: Literal["exam", "assignment", "review"] | None = None
    familiarity: Literal["new", "attended", "reviewed"] | None = None
    daily_minutes: int | None = Field(default=None, ge=30, le=480)
    # 데이터 기반 처방(선택): 과목별 학습 상태와 간격 반복 복습 후보.
    courses: list[StudyPlanCourse] = Field(default_factory=list)
    review_candidates: list[StudyPlanReviewCandidate] = Field(default_factory=list)
