from __future__ import annotations

import os
import re
import json
import math
import argparse
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import List, Dict, Tuple, Optional

from dotenv import load_dotenv
import pymupdf4llm
from google import genai
from openai import OpenAI


# ============================================================
# 목적
# - 단일 Gemini 모델만 사용하여 파이프라인이 끝까지 도는지 확인
# - 업로드 시: PDF -> Markdown -> 섹션 분할 -> 청킹 -> 저장
# - 요청 시:
#   1) Global summary
#   2) Local summary
#   3) Global quiz
#   4) Local quiz
#   5) Search
#
# 주의
# - "단일모델 smoke test" 목적이므로 embeddings 모델은 쓰지 않음
# - retrieval은 간단한 lexical scoring으로 구현
# - 전체 문서의 one-shot 가능 여부만 Gemini count_tokens로 정확히 계산
# - chunking은 대략값(rough token) 기반으로 처리
# ============================================================


# -----------------------------
# 데이터 구조
# -----------------------------
@dataclass
class Section:
    section_index: int
    header: str
    text: str
    rough_tokens: int


@dataclass
class Chunk:
    section_index: int
    chunk_index: int
    global_chunk_index: int
    header: str
    text: str
    rough_tokens: int


# -----------------------------
# 유틸
# -----------------------------
HEADER_RE = re.compile(r"^(#{1,6})\s+(.+)$")


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def save_text(path: Path, text: str) -> None:
    ensure_dir(path.parent)
    path.write_text(text, encoding="utf-8")


def save_json(path: Path, data) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def normalize_terms(text: str) -> List[str]:
    return re.findall(r"[A-Za-z0-9가-힣_+\-]+", text.lower())


def rough_token_count(text: str) -> int:
    """
    목적:
        내부 청킹용 대략 토큰 수 계산
    입력:
        text
    출력:
        rough token count (int)
    내부:
        대략 4글자 ~= 1 token 기준 사용
    """
    text = text or ""
    return max(1, math.ceil(len(text) / 4))


def get_model_provider() -> str:
    provider = os.getenv("MODEL_PROVIDER", "gemini").strip().lower()
    if provider not in {"gemini", "ollama"}:
        raise RuntimeError(f"지원하지 않는 MODEL_PROVIDER입니다: {provider}")
    return provider


# -----------------------------
# Client / Generation routing
# -----------------------------
def get_client():
    """
    목적:
        MODEL_PROVIDER에 따라 Gemini client 또는 Ollama(OpenAI-compatible) client 생성
    """
    provider = get_model_provider()

    if provider == "gemini":
        api_key = os.getenv("GEMINI_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY가 비어 있습니다. .env를 확인하세요.")
        return genai.Client(api_key=api_key)

    if provider == "ollama":
        base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1/").strip()
        return OpenAI(base_url=base_url, api_key="ollama")

    raise RuntimeError(f"지원하지 않는 provider: {provider}")


def generate_text(client, model_name: str, prompt: str) -> str:
    """
    목적:
        MODEL_PROVIDER에 따라 Gemini 또는 Ollama로 텍스트 생성
    """
    provider = get_model_provider()

    if provider == "gemini":
        response = client.models.generate_content(
            model=model_name,
            contents=prompt,
        )
        text = getattr(response, "text", None)
        if text is None:
            return str(response)
        return text.strip()

    if provider == "ollama":
        response = client.responses.create(
            model=model_name,
            input=prompt,
        )
        return response.output_text.strip()

    raise RuntimeError(f"지원하지 않는 provider: {provider}")


def count_tokens_for_routing(client, model_name: str, text: str) -> int:
    """
    목적:
        one-shot 분기용 토큰 수 계산
        - Gemini: SDK count_tokens 사용
        - Ollama: rough token count 사용
    """
    provider = get_model_provider()

    if provider == "gemini":
        resp = client.models.count_tokens(
            model=model_name,
            contents=text,
        )

        total = getattr(resp, "total_tokens", None)
        if total is None:
            total = getattr(resp, "totalTokens", None)

        if total is None:
            if isinstance(resp, int):
                total = resp
            else:
                raise RuntimeError(f"count_tokens 응답에서 total token 수를 읽지 못했습니다: {resp}")

        return int(total)

    if provider == "ollama":
        return rough_token_count(text)

    raise RuntimeError(f"지원하지 않는 provider: {provider}")


# -----------------------------
# PDF -> Markdown
# -----------------------------
def extract_markdown_from_pdf(pdf_path: Path) -> str:
    """
    목적:
        PDF를 Markdown 문자열로 변환
    입력:
        pdf_path
    출력:
        markdown
    """
    md = pymupdf4llm.to_markdown(str(pdf_path))
    return md.strip()


# -----------------------------
# Markdown -> Section
# -----------------------------
def normalize_header(line: str) -> str:
    m = HEADER_RE.match(line.strip())
    if m:
        return m.group(2).strip()
    return line.strip() or "Document"


def split_markdown_by_headers(markdown: str) -> List[Tuple[str, str]]:
    """
    목적:
        Markdown 헤더 기반 1차 섹션 분할
    입력:
        markdown
    출력:
        [(header, section_text), ...]
    내부:
        헤더가 없으면 전체를 하나의 섹션으로 간주
    """
    lines = markdown.splitlines()

    sections: List[Tuple[str, str]] = []
    current_header = "Document"
    current_lines: List[str] = []

    for line in lines:
        stripped = line.strip()
        if HEADER_RE.match(stripped):
            if current_lines:
                section_text = "\n".join(current_lines).strip()
                if section_text:
                    sections.append((current_header, section_text))
            current_header = normalize_header(stripped)
            current_lines = []
        else:
            current_lines.append(line)

    if current_lines:
        section_text = "\n".join(current_lines).strip()
        if section_text:
            sections.append((current_header, section_text))

    if not sections:
        return [("Document", markdown)]

    return sections


# -----------------------------
# Recursive split
# -----------------------------
SEPARATORS = ["\n\n", "\n", ". ", " "]


def hard_split_by_words(text: str, max_tokens: int) -> List[str]:
    """
    목적:
        recursive split이 안 될 때 마지막 fallback 분할
    입력:
        text, max_tokens
    출력:
        rough max_tokens 이하 word chunk
    """
    words = text.split()
    if not words:
        return [text]

    out: List[str] = []
    buf: List[str] = []

    for word in words:
        candidate = " ".join(buf + [word])
        if rough_token_count(candidate) <= max_tokens:
            buf.append(word)
        else:
            if buf:
                out.append(" ".join(buf))
            buf = [word]

    if buf:
        out.append(" ".join(buf))

    return [x.strip() for x in out if x.strip()]


def recursive_split_text(text: str, max_tokens: int) -> List[str]:
    """
    목적:
        512 tokens를 넘는 긴 섹션을 2차 분할
    입력:
        text, max_tokens
    출력:
        chunk text list
    내부:
        큰 구분자부터 작은 구분자 순으로 재귀 분할
    """
    if rough_token_count(text) <= max_tokens:
        return [text.strip()]

    def _split(cur_text: str, sep_idx: int) -> List[str]:
        if rough_token_count(cur_text) <= max_tokens:
            return [cur_text.strip()]

        if sep_idx >= len(SEPARATORS):
            return hard_split_by_words(cur_text, max_tokens)

        sep = SEPARATORS[sep_idx]
        parts = cur_text.split(sep)

        if len(parts) == 1:
            return _split(cur_text, sep_idx + 1)

        out: List[str] = []
        buf = ""

        for part in parts:
            part = part.strip()
            if not part:
                continue

            candidate = part if not buf else buf + sep + part
            if rough_token_count(candidate) <= max_tokens:
                buf = candidate
            else:
                if buf.strip():
                    out.extend(_split(buf, sep_idx + 1))
                buf = part

                if rough_token_count(buf) > max_tokens:
                    out.extend(_split(buf, sep_idx + 1))
                    buf = ""

        if buf.strip():
            out.extend(_split(buf, sep_idx + 1))

        return [x.strip() for x in out if x.strip()]

    return _split(text, 0)


# -----------------------------
# Section / Chunk build
# -----------------------------
def build_sections(markdown: str) -> List[Section]:
    raw_sections = split_markdown_by_headers(markdown)
    sections: List[Section] = []

    for i, (header, text) in enumerate(raw_sections, start=1):
        sections.append(
            Section(
                section_index=i,
                header=header,
                text=text,
                rough_tokens=rough_token_count(text),
            )
        )
    return sections


def build_chunks(sections: List[Section], max_tokens_per_chunk: int) -> List[Chunk]:
    """
    목적:
        섹션 리스트를 chunk 리스트로 변환
    출력:
        전체 문서 기준 ordered chunk 리스트
    """
    chunks: List[Chunk] = []
    g_idx = 1

    for sec in sections:
        if sec.rough_tokens <= max_tokens_per_chunk:
            piece_texts = [sec.text]
        else:
            piece_texts = recursive_split_text(sec.text, max_tokens_per_chunk)

        for c_idx, piece in enumerate(piece_texts, start=1):
            chunks.append(
                Chunk(
                    section_index=sec.section_index,
                    chunk_index=c_idx,
                    global_chunk_index=g_idx,
                    header=sec.header,
                    text=piece,
                    rough_tokens=rough_token_count(piece),
                )
            )
            g_idx += 1

    return chunks


# -----------------------------
# Retrieval (single-model smoke test용 lexical retrieval)
# -----------------------------
def lexical_score(query: str, chunk: Chunk) -> float:
    q_terms = set(normalize_terms(query))
    if not q_terms:
        return 0.0

    body_terms = set(normalize_terms(chunk.text))
    header_terms = set(normalize_terms(chunk.header))

    overlap_body = len(q_terms & body_terms)
    overlap_header = len(q_terms & header_terms)

    score = overlap_body + 2.0 * overlap_header

    full_q = query.lower().strip()
    if full_q and full_q in chunk.text.lower():
        score += 3.0

    return score


def retrieve_top_chunks(
    chunks: List[Chunk],
    query: str,
    top_k: int = 4,
    add_neighbors: bool = True,
) -> List[Chunk]:
    """
    목적:
        관련 chunk 검색
    입력:
        chunks, query
    출력:
        score 높은 chunk 리스트
    내부:
        lexical scoring + 인접 chunk 보강
    """
    scored = [(lexical_score(query, ch), ch) for ch in chunks]
    scored.sort(key=lambda x: x[0], reverse=True)

    top = [ch for score, ch in scored[:top_k] if score > 0]

    if not top:
        # 검색 실패 시 앞 chunk 몇 개라도 반환
        top = chunks[: min(top_k, len(chunks))]

    if add_neighbors:
        chosen = {ch.global_chunk_index for ch in top}
        for ch in list(top):
            prev_idx = ch.global_chunk_index - 1
            next_idx = ch.global_chunk_index + 1
            for cand in chunks:
                if cand.global_chunk_index in (prev_idx, next_idx):
                    chosen.add(cand.global_chunk_index)

        top = [ch for ch in chunks if ch.global_chunk_index in chosen]

    top.sort(key=lambda x: x.global_chunk_index)
    return top


# -----------------------------
# 프롬프트들
# -----------------------------
def make_global_summary_prompt(markdown: str) -> str:
    return f"""
너는 대학 전공 강의자료를 '시험 대비용'으로 정리하는 조교이다.
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

[강의자료 원문]
{markdown}

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
- 예: "데이터웨어하우스의 특성 4가지: ..."
- 예: "3계층 구조: ..."
- 예: "주요 연산 5가지: ..."

# 비교 포인트
- 비교 대상별 차이점을 표 또는 bullet로 정리
- 비교가 없으면 "없음"

# 시험 직전 체크리스트
- 단답형/서술형으로 나올 수 있는 키워드 10~15개
- 각 키워드는 한 줄 설명 포함

# 한 줄 요약
- 문서 전체를 1~2문장으로 정리
""".strip()


def make_section_summary_prompt(section_text: str, header: str) -> str:
    return f"""
너는 대학 전공 강의자료의 한 섹션을 시험 대비용으로 정리하는 조교이다.

반드시 지켜라.
1. 이 섹션의 핵심 정의를 먼저 제시하라.
2. 열거형 항목이 있으면 개수와 이름을 보존하라.
3. 종류, 장단점, 비교, 절차, 연산은 따로 구분해서 정리하라.
4. 원문에 없는 내용을 추측해서 추가하지 마라.
5. 너무 짧게 압축해서 중요한 세부 항목을 버리지 마라.

[섹션 제목]
{header}

[섹션 본문]
{section_text}

[출력 형식]
## 섹션 핵심
- 4~8개 bullet

## 열거형 항목
- 개수와 항목명 보존
- 없으면 "없음"

## 비교/장단점
- 있으면 정리
- 없으면 "없음"

## 시험 포인트
- 3~6개 bullet
""".strip()


def make_chunk_summary_prompt(chunk: Chunk) -> str:
    return f"""
너는 대학 강의자료의 일부 청크를 요약하는 조교이다.
아래 청크를 한국어로 간결하게 요약하라.
반드시 원문 내용만 사용하라.

[section_index]
{chunk.section_index}

[chunk_index]
{chunk.chunk_index}

[header]
{chunk.header}

[text]
{chunk.text}

[출력 형식]
## 청크 요약
- 3~6개 bullet

## 핵심 개념
- 2~5개 bullet
""".strip()


def make_reduce_prompt(section_summaries_text: str) -> str:
    return f"""
너는 여러 섹션 요약을 합쳐 문서 전체를 시험 대비용으로 정리하는 조교이다.

반드시 지켜라.
1. 섹션 순서를 유지하라.
2. 섹션 요약에 포함된 열거형 항목의 개수와 이름을 함부로 줄이지 마라.
3. 비교 대상과 장단점은 별도로 모아서 정리하라.
4. 원문에 없는 내용을 추측해서 추가하지 마라.
5. 전체 개요만 말하고 끝내지 말고, 시험에 필요한 세부 항목도 유지하라.

[섹션 요약들]
{section_summaries_text}

[출력 형식]
# 전체 흐름
- 4~8개 bullet

# 섹션별 핵심 정리
- 섹션 순서대로 정리

# 열거형 암기 포인트
- 개수와 항목명 보존

# 비교 포인트
- 표 또는 bullet 정리

# 시험 직전 체크리스트
- 10~15개 키워드

# 한 줄 요약
- 1~2문장
""".strip()


def make_local_summary_prompt(query: str, context_text: str) -> str:
    return f"""
너는 대학 강의자료 질의응답 조교이다.
아래 사용자의 요청에 대해, 제공된 context 조각만 근거로 한국어로 답하라.
근거가 부족하면 부족하다고 말하라.
원문에 없는 내용을 추측해서 추가하지 마라.

[사용자 요청]
{query}

[context]
{context_text}

[출력 형식]
# 답변
요청에 대한 답변

# 근거 요약
- 3~6개 bullet
""".strip()


def make_global_quiz_prompt(source_text: str, num_questions: int) -> str:
    return f"""
너는 대학 강의자료 기반 퀴즈 생성 조교이다.
아래 자료를 바탕으로 한국어 퀴즈를 만들어라.
반드시 자료에 있는 내용만 바탕으로 하라.

[자료]
{source_text}

[요구사항]
- 총 {num_questions}문제
- 객관식 3문제, 단답형 2문제(가능하면)
- 각 문항마다 정답과 해설 포함
- 시험 대비용으로 핵심 개념 위주

[출력 형식]
# 퀴즈
문항, 정답, 해설을 차례대로 작성
""".strip()


def make_local_quiz_prompt(query: str, context_text: str, num_questions: int) -> str:
    return f"""
너는 대학 강의자료의 특정 범위에 대한 퀴즈 생성 조교이다.
아래 요청과 context를 바탕으로 한국어 퀴즈를 만들어라.
반드시 context에 있는 내용만 바탕으로 하라.

[사용자 요청]
{query}

[context]
{context_text}

[요구사항]
- 총 {num_questions}문제
- 요청 범위에 집중
- 각 문항마다 정답과 해설 포함

[출력 형식]
# 퀴즈
문항, 정답, 해설을 차례대로 작성
""".strip()


# -----------------------------
# Context 문자열 구성
# -----------------------------
def render_chunks_for_context(chunks: List[Chunk]) -> str:
    pieces = []
    for ch in chunks:
        pieces.append(
            f"""[section_index={ch.section_index}, chunk_index={ch.chunk_index}, header={ch.header}]
{ch.text}"""
        )
    return "\n\n".join(pieces)


def render_section_summaries(section_summaries: List[Dict]) -> str:
    pieces = []
    for item in section_summaries:
        pieces.append(
            f"""[section_index={item["section_index"]}, header={item["header"]}]
{item["summary"]}"""
        )
    return "\n\n".join(pieces)


# -----------------------------
# Global 처리
# -----------------------------
def build_section_summaries_if_needed(
    client: genai.Client,
    model_name: str,
    sections: List[Section],
    chunks: List[Chunk],
) -> List[Dict]:
    """
    목적:
        문서가 너무 길면 section-based hierarchical summary를 만들기 위한 중간 산출물 생성
    출력:
        [{"section_index":..., "header":..., "summary":...}, ...]
    내부:
        짧은 섹션은 바로 요약
        긴 섹션은 chunk summary -> section reduce
    """
    chunks_by_section: Dict[int, List[Chunk]] = {}
    for ch in chunks:
        chunks_by_section.setdefault(ch.section_index, []).append(ch)

    section_summaries: List[Dict] = []

    for sec in sections:
        sec_chunks = chunks_by_section[sec.section_index]

        if len(sec_chunks) == 1:
            summary = generate_text(client, model_name, make_section_summary_prompt(sec.text, sec.header))
        else:
            chunk_summaries = []
            for ch in sec_chunks:
                ch_sum = generate_text(client, model_name, make_chunk_summary_prompt(ch))
                chunk_summaries.append(
                    {
                        "section_index": ch.section_index,
                        "chunk_index": ch.chunk_index,
                        "header": ch.header,
                        "summary": ch_sum,
                    }
                )

            reduce_source = []
            for item in chunk_summaries:
                reduce_source.append(
                    f"""[section_index={item["section_index"]}, chunk_index={item["chunk_index"]}, header={item["header"]}]
{item["summary"]}"""
                )

            reduce_prompt = f"""
너는 한 섹션의 여러 청크 요약을 합쳐 섹션 요약을 만드는 조교이다.
아래 청크 요약들을 바탕으로 섹션 전체를 한국어로 요약하라.
원문에 없는 내용을 추측해서 추가하지 마라.

[청크 요약들]
{chr(10).join(reduce_source)}

[출력 형식]
## 섹션 요약
- 4~8개 bullet

## 핵심 개념
- 3~8개 bullet

## 시험 포인트
- 2~5개 bullet
""".strip()

            summary = generate_text(client, model_name, reduce_prompt)

        section_summaries.append(
            {
                "section_index": sec.section_index,
                "header": sec.header,
                "summary": summary,
            }
        )

    return section_summaries


def run_global_summary(
    client: genai.Client,
    model_name: str,
    markdown: str,
    sections: List[Section],
    chunks: List[Chunk],
    safe_one_shot_input_tokens: int,
    outdir: Path,
) -> str:
    """
    목적:
        Global summary 생성
    분기:
        - 안전 구간 이내면 one-shot
        - 넘으면 section-based hierarchical summary
    """
    exact_tokens = count_tokens_for_routing(client, model_name, markdown)
    save_json(outdir / "10_global_token_check.json", {"exact_input_tokens": exact_tokens})

    if exact_tokens <= safe_one_shot_input_tokens:
        final_summary = generate_text(client, model_name, make_global_summary_prompt(markdown))
        save_text(outdir / "20_global_summary_one_shot.md", final_summary)
        return final_summary

    section_summaries = build_section_summaries_if_needed(client, model_name, sections, chunks)
    save_json(outdir / "11_section_summaries.json", section_summaries)

    reduce_input = render_section_summaries(section_summaries)
    final_summary = generate_text(client, model_name, make_reduce_prompt(reduce_input))
    save_text(outdir / "21_global_summary_hierarchical.md", final_summary)
    return final_summary


def run_global_quiz(
    client: genai.Client,
    model_name: str,
    markdown: str,
    sections: List[Section],
    chunks: List[Chunk],
    safe_one_shot_input_tokens: int,
    num_questions: int,
    outdir: Path,
) -> str:
    """
    목적:
        전체 범위 퀴즈 생성
    분기:
        - 문서가 작으면 전체 원문 기반
        - 크면 section summary 기반
    """
    exact_tokens = count_tokens_for_routing(client, model_name, markdown)
    save_json(outdir / "30_global_quiz_token_check.json", {"exact_input_tokens": exact_tokens})

    if exact_tokens <= safe_one_shot_input_tokens:
        quiz = generate_text(client, model_name, make_global_quiz_prompt(markdown, num_questions))
        save_text(outdir / "31_global_quiz_one_shot.md", quiz)
        return quiz

    section_summaries = build_section_summaries_if_needed(client, model_name, sections, chunks)
    save_json(outdir / "32_section_summaries_for_quiz.json", section_summaries)

    source_text = render_section_summaries(section_summaries)
    quiz = generate_text(client, model_name, make_global_quiz_prompt(source_text, num_questions))
    save_text(outdir / "33_global_quiz_hierarchical.md", quiz)
    return quiz


# -----------------------------
# Local 처리
# -----------------------------
def run_local_summary(
    client: genai.Client,
    model_name: str,
    chunks: List[Chunk],
    query: str,
    top_k: int,
    outdir: Path,
) -> str:
    hits = retrieve_top_chunks(chunks, query, top_k=top_k, add_neighbors=True)
    save_json(outdir / "40_local_hits.json", [asdict(h) for h in hits])

    context_text = render_chunks_for_context(hits)
    answer = generate_text(client, model_name, make_local_summary_prompt(query, context_text))
    save_text(outdir / "41_local_summary.md", answer)
    return answer


def run_local_quiz(
    client: genai.Client,
    model_name: str,
    chunks: List[Chunk],
    query: str,
    top_k: int,
    num_questions: int,
    outdir: Path,
) -> str:
    hits = retrieve_top_chunks(chunks, query, top_k=top_k, add_neighbors=True)
    save_json(outdir / "50_local_quiz_hits.json", [asdict(h) for h in hits])

    context_text = render_chunks_for_context(hits)
    quiz = generate_text(client, model_name, make_local_quiz_prompt(query, context_text, num_questions))
    save_text(outdir / "51_local_quiz.md", quiz)
    return quiz


def run_search(
    chunks: List[Chunk],
    query: str,
    top_k: int,
    outdir: Path,
) -> List[Chunk]:
    hits = retrieve_top_chunks(chunks, query, top_k=top_k, add_neighbors=False)
    save_json(outdir / "60_search_hits.json", [asdict(h) for h in hits])

    md_lines = ["# Search Hits", ""]
    for h in hits:
        md_lines.append(f"## section={h.section_index}, chunk={h.chunk_index}, header={h.header}")
        md_lines.append(h.text)
        md_lines.append("")
    save_text(outdir / "61_search_hits.md", "\n".join(md_lines))
    return hits


# -----------------------------
# 메인
# -----------------------------
def main():
    load_dotenv()

    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", default=os.getenv("INPUT_PDF", "input/sample.pdf"))
    parser.add_argument("--outdir", default=os.getenv("OUTPUT_DIR", "output/run_001"))
    parser.add_argument("--model", default=os.getenv("MODEL_NAME", "gemini-2.5-flash"))
    parser.add_argument(
        "--task",
        choices=["global_summary", "local_summary", "global_quiz", "local_quiz", "search"],
        default="global_summary",
    )
    parser.add_argument("--query", default="")
    parser.add_argument("--top-k", type=int, default=int(os.getenv("TOP_K", "4")))
    parser.add_argument("--num-questions", type=int, default=5)
    parser.add_argument(
        "--safe-one-shot-input-tokens",
        type=int,
        default=int(os.getenv("SAFE_ONE_SHOT_INPUT_TOKENS", "250000")),
    )
    parser.add_argument(
        "--max-tokens-per-chunk",
        type=int,
        default=int(os.getenv("MAX_TOKENS_PER_CHUNK", "512")),
    )
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    outdir = Path(args.outdir)
    ensure_dir(outdir)

    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF를 찾을 수 없습니다: {pdf_path}")

    client = get_client()

    # A. 업로드 시 파이프라인
    markdown = extract_markdown_from_pdf(pdf_path)
    sections = build_sections(markdown)
    chunks = build_chunks(sections, args.max_tokens_per_chunk)

    save_text(outdir / "01_markdown.md", markdown)
    save_json(outdir / "02_sections.json", [asdict(s) for s in sections])
    save_json(outdir / "03_chunks.json", [asdict(c) for c in chunks])

    run_meta = {
        "pdf": str(pdf_path),
        "model": args.model,
        "task": args.task,
        "safe_one_shot_input_tokens": args.safe_one_shot_input_tokens,
        "max_tokens_per_chunk": args.max_tokens_per_chunk,
        "num_sections": len(sections),
        "num_chunks": len(chunks),
    }
    save_json(outdir / "00_run_meta.json", run_meta)

    # B. 요청 시 파이프라인
    if args.task == "global_summary":
        result = run_global_summary(
            client=client,
            model_name=args.model,
            markdown=markdown,
            sections=sections,
            chunks=chunks,
            safe_one_shot_input_tokens=args.safe_one_shot_input_tokens,
            outdir=outdir,
        )
        print(result)

    elif args.task == "global_quiz":
        result = run_global_quiz(
            client=client,
            model_name=args.model,
            markdown=markdown,
            sections=sections,
            chunks=chunks,
            safe_one_shot_input_tokens=args.safe_one_shot_input_tokens,
            num_questions=args.num_questions,
            outdir=outdir,
        )
        print(result)

    elif args.task == "local_summary":
        if not args.query.strip():
            raise ValueError("--task local_summary 에서는 --query가 필요합니다.")
        result = run_local_summary(
            client=client,
            model_name=args.model,
            chunks=chunks,
            query=args.query,
            top_k=args.top_k,
            outdir=outdir,
        )
        print(result)

    elif args.task == "local_quiz":
        if not args.query.strip():
            raise ValueError("--task local_quiz 에서는 --query가 필요합니다.")
        result = run_local_quiz(
            client=client,
            model_name=args.model,
            chunks=chunks,
            query=args.query,
            top_k=args.top_k,
            num_questions=args.num_questions,
            outdir=outdir,
        )
        print(result)

    elif args.task == "search":
        if not args.query.strip():
            raise ValueError("--task search 에서는 --query가 필요합니다.")
        hits = run_search(
            chunks=chunks,
            query=args.query,
            top_k=args.top_k,
            outdir=outdir,
        )
        print(json.dumps([asdict(h) for h in hits], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()