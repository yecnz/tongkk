from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictInt


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Scope(Input):
    type: Literal["all", "pages", "units"] = "all"
    pages: list[StrictInt] = Field(default_factory=list, max_length=300)
    unit_ids: list[str] = Field(default_factory=list, max_length=100)


class CreateSession(Input):
    course_id: UUID
    material_id: str = Field(min_length=1, max_length=1000)
    source_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    scope: Scope = Field(default_factory=Scope)
    familiarity: Literal["attended", "new"] = "attended"
    target_minutes: int = Field(default=15, ge=5, le=60)
    concept_count: int = Field(default=2, ge=1, le=3)
    idempotency_key: UUID


class Command(Input):
    expected_revision: int = Field(ge=0)
    idempotency_key: UUID


class Draft(Input):
    item_id: UUID
    expected_item_revision: int = Field(ge=0)
    text: str = Field(max_length=4000)


class Answer(Command):
    item_id: UUID
    kind: Literal["recall", "check"]
    answer: Annotated[str, Field(max_length=4000)] | StrictInt


class Help(Command):
    item_id: UUID
    help_type: Literal["source", "hint1", "hint2", "reference"]


class Action(Command):
    action: Literal["advance", "unknown", "skip", "self_check", "pause", "resume", "finish", "abandon"]
    self_check: Literal["understood", "needs_review", "unknown"] | None = None


class Report(Command):
    reason: Literal["question", "answer", "feedback", "source"]
    description: str = Field(default="", max_length=1000)


class SourceRef(Input):
    unit_id: str
    quote: str = Field(min_length=1, max_length=2000)


class Criterion(Input):
    id: str = Field(min_length=1, max_length=40)
    description: str = Field(min_length=1, max_length=1000)
    source_refs: list[SourceRef] = Field(min_length=1, max_length=5)


class CheckQuestion(Input):
    question: str = Field(min_length=1, max_length=2000)
    options: list[str] = Field(min_length=2, max_length=5)
    answer_index: StrictInt
    explanation: str = Field(min_length=1, max_length=2000)


class Concept(Input):
    title: str = Field(min_length=1, max_length=200)
    introduction: str = Field(min_length=1, max_length=1500)
    question: str = Field(min_length=1, max_length=2000)
    criteria: list[Criterion] = Field(min_length=1, max_length=5)
    source_refs: list[SourceRef] = Field(min_length=1, max_length=5)
    hints: list[str] = Field(min_length=2, max_length=2)
    reference: str = Field(min_length=1, max_length=3000)
    check: CheckQuestion


class PackContent(Input):
    concepts: list[Concept] = Field(min_length=1, max_length=3)


class CriterionFeedback(Input):
    criterion_id: str
    status: Literal["met", "missing", "contradicted", "uncertain"]
    student_quote: str = Field(max_length=4000)
    reason: str = Field(min_length=1, max_length=1000)
    source_refs: list[SourceRef] = Field(min_length=1, max_length=5)


class RecallFeedback(Input):
    criteria: list[CriterionFeedback] = Field(min_length=1, max_length=5)


# Public DTOs intentionally have no pack/rubric/future question fields.
class PublicHelp(BaseModel):
    source: str | None = None
    hint1: str | None = None
    hint2: str | None = None
    reference: str | None = None


class PublicCheck(BaseModel):
    question: str
    options: list[str]


class PublicCheckResult(BaseModel):
    answer_index: int
    selected: int
    correct: bool
    explanation: str


class PublicItem(BaseModel):
    id: str
    title: str
    phase: str
    revision: int
    position: int
    question: str
    draft: str
    introduction: str | None = None
    help: PublicHelp
    feedback: RecallFeedback | None = None
    evaluation_error: bool = False
    self_check: str | None = None
    check: PublicCheck | None = None
    check_result: PublicCheckResult | None = None
    reported: bool = False


class OperationView(BaseModel):
    id: str
    kind: str
    status: str
    retryable: bool
    error_code: str | None = None


class ResultItem(BaseModel):
    title: str
    recall: Literal["sufficient", "needs_review", "uncertain", "ungraded", "self_report"]
    check: Literal["correct", "incorrect", "ungraded"]
    assisted: bool
    prior_instruction: bool
    repeated: bool
    reported: bool
    skipped: bool = False


class SessionView(BaseModel):
    id: str
    course_id: str
    material_id: str
    material_name: str
    status: str
    revision: int
    target_minutes: int
    concept_count: int
    completed_count: int
    source_changed: bool = False
    current: PublicItem | None = None
    operation: OperationView | None = None
    allowed_actions: list[str]
    result: list[ResultItem]


class ScopeUnit(BaseModel):
    id: str
    label: str
    page: int | None = None
    chars: int


class ScopesView(BaseModel):
    material_name: str
    source_hash: str
    total_chars: int
    max_chars: int
    units: list[ScopeUnit]


class SessionSummary(BaseModel):
    id: str
    material_name: str
    status: str
    updated_at: str


class SessionList(BaseModel):
    sessions: list[SessionSummary]
