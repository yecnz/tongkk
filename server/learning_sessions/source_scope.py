import hashlib
import re

from .errors import fail
from .schemas import Scope

MAX_SOURCE_CHARS = 12000
PAGE = re.compile(r"<!--\s*(?:p\.|Slide number:\s*)(\d+)\s*-->")


def source_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def units(text: str) -> list[dict]:
    """Stable codepoint offsets, tied to the full source hash, not UI UTF-16 offsets."""
    markers = list(PAGE.finditer(text))
    if markers:
        spans = [(m.start(), markers[i + 1].start() if i + 1 < len(markers) else len(text),
                  int(m[1]), f"{m[1]}페이지/슬라이드") for i, m in enumerate(markers)]
        if markers[0].start() and text[:markers[0].start()].strip():
            spans.insert(0, (0, markers[0].start(), None, "자료 머리말"))
    else:
        # Paragraph boundaries also work for text without headings/page markers.
        starts = [0] + [m.end() for m in re.finditer(r"\n\s*\n", text)]
        spans = [(start, starts[i + 1] if i + 1 < len(starts) else len(text), None,
                  text[start:start + 70].split("\n")[0].strip("# ") or f"문단 {i + 1}")
                 for i, start in enumerate(starts)]
    return [{"id": f"u{start}", "label": label, "page": page, "start": start, "end": end,
             "text": text[start:end], "chars": end - start}
            for start, end, page, label in spans if text[start:end].strip()]


def select_source(text: str, scope: Scope) -> tuple[str, list[dict]]:
    available = units(text)
    if scope.type == "pages":
        pages = set(scope.pages)
        if scope.unit_ids or not pages or not pages.issubset({u["page"] for u in available}):
            fail("INVALID_SCOPE", "실제 자료에 있는 페이지를 선택해주세요.", 422)
        chosen = [u for u in available if u["page"] in pages]
    elif scope.type == "units":
        ids = set(scope.unit_ids)
        if scope.pages or not ids or not ids.issubset({u["id"] for u in available}):
            fail("INVALID_SCOPE", "원문 구간을 다시 선택해주세요.", 422)
        chosen = [u for u in available if u["id"] in ids]
    else:
        if scope.pages or scope.unit_ids:
            fail("INVALID_SCOPE", "전체 범위에는 개별 구간을 지정할 수 없습니다.", 422)
        chosen = available
    snapshot = "\n\n".join(u["text"] for u in chosen)
    if not snapshot.strip() or len(snapshot) > MAX_SOURCE_CHARS:
        fail("SOURCE_LIMIT", f"텍스트가 있는 범위를 {MAX_SOURCE_CHARS:,}자 이내로 선택해주세요.", 422)
    return snapshot, chosen
