#!/usr/bin/env python3
"""시각 분석(비전) 비용 계측 스크립트 — 문서당 실제 토큰/$ 측정.

목적: "30-60x 절감" 같은 추정 대신, 실제 강의자료 N개를 프로덕션과 동일한 비전 경로로
돌려 비전 호출당 input/output 토큰과 문서당 비용을 측정한다. 이 수치가 나와야 DPI·페이지
상한 인상과 material_pages 재작업을 정당화할 수 있다.

핵심 설계:
- 프로덕션 코드는 건드리지 않는다. main._build_visual_llm을 래핑해 response.usage_metadata를
  수집하고, 시각 항목 캐시(convert_cache.get/set_visual_section)를 우회해 "uncached" 비용을
  측정한다(같은 문서를 다시 올렸을 때가 아니라 처음 변환 비용).
- 측정 경로는 main._analyze_document_visuals와 동일하게 구성한다(게이트→수집→배치→호출).
- 토큰은 정확히 측정되고, 비용 = 토큰 × 단가. 단가는 추정 기본값이며 --price-in/--price-out로
  실제 단가를 넣어 덮어쓴다(아래 DEFAULT_PRICES 경고 참고).

사용 예:
  # 플러밍/계산 검증(API 호출 없음):
  cd server && .venv/bin/python scripts/measure_vision_cost.py --docs /경로/샘플 --mock

  # 실제 계측(GEMINI_API_KEY 필요, API 비용 발생):
  cd server && .venv/bin/python scripts/measure_vision_cost.py \
      --docs /경로/lecture_pdfs --limit 50 --out report.json \
      --price-in 0.30 --price-out 2.50
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os
import statistics
import sys
import time
import traceback
from dataclasses import dataclass
from pathlib import Path

# server/ 디렉터리를 import 경로에 넣어 main을 그대로 import한다(conftest와 동일 방식).
SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

import main  # noqa: E402  (경로 삽입 후 import)

VISION_EXTENSIONS = {".pdf", ".pptx"}

# ⚠ 추정 단가(USD / 1M tokens) — 2026년 중반 리서치 기반의 대략값일 뿐 실측이 아니다.
# 반드시 --price-in/--price-out로 공식 가격을 넣어 덮어써라. 토큰은 정확히 측정되지만
# 비용은 이 단가에 전적으로 의존한다. (input 토큰에는 이미지 타일 토큰이 포함된다.)
DEFAULT_PRICES: dict[str, tuple[float, float]] = {
    "gemini-2.5-flash-lite": (0.10, 0.40),
    "gemini-2.5-flash": (0.30, 2.50),
    "gemini-3.1-flash-lite": (0.10, 0.40),
    "gpt-5.4-nano": (0.05, 0.40),
    "gpt-5.4-mini": (0.25, 2.00),
}


@dataclass
class DocResult:
    file: str
    suffix: str
    pages_selected: int = 0
    vision_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    # --with-summary일 때만 채워진다(요약 1회 = 반복 비용 1단위).
    summary_input_tokens: int = 0
    summary_output_tokens: int = 0
    summary_cost_usd: float = 0.0
    skipped_reason: str | None = None
    error: str | None = None


# ---------------------------------------------------------------------------
# 토큰 사용량 수집 래퍼 / mock LLM
# ---------------------------------------------------------------------------
class _UsageCapturingLLM:
    """real LLM의 .invoke를 감싸 response.usage_metadata를 sink에 모은다."""

    def __init__(self, inner, sink: list[dict]):
        self._inner = inner
        self._sink = sink

    def invoke(self, *args, **kwargs):
        resp = self._inner.invoke(*args, **kwargs)
        usage = getattr(resp, "usage_metadata", None)
        if not usage:
            # 일부 응답은 response_metadata.token_usage(또는 usage)에만 담긴다.
            meta = getattr(resp, "response_metadata", {}) or {}
            tu = meta.get("token_usage") or meta.get("usage") or {}
            usage = {
                "input_tokens": tu.get("prompt_tokens") or tu.get("input_tokens") or 0,
                "output_tokens": tu.get("completion_tokens") or tu.get("output_tokens") or 0,
            }
        self._sink.append(dict(usage))
        return resp


class _FakeResp:
    def __init__(self, usage: dict):
        self.usage_metadata = usage
        self.content = "## mock\n(모의 해석 결과)"
        self.response_metadata = {}


class _FakeLLM:
    """--mock 전용. 실제 네트워크 없이 입력 이미지 수에 비례한 토큰을 돌려준다."""

    def invoke(self, messages, *args, **kwargs):
        n_img = 0
        for m in messages:
            content = getattr(m, "content", None)
            if isinstance(content, list):
                n_img += sum(
                    1 for part in content
                    if isinstance(part, dict) and part.get("type") == "image_url"
                )
        n_img = max(1, n_img)
        # 이미지 1장 ~1200 input 토큰 + 텍스트 ~300, output ~700 가정(플러밍 검증용 임의값).
        usage = {"input_tokens": 1200 * n_img + 300, "output_tokens": 700, "total_tokens": 0}
        return _FakeResp(usage)


# ---------------------------------------------------------------------------
# 단가 해석 / 통계
# ---------------------------------------------------------------------------
def resolve_vision_model() -> str:
    if main.VISUAL_ANALYSIS_MODEL == "GPT":
        return main.VISUAL_ANALYSIS_OPENAI_MODEL
    return main.VISUAL_ANALYSIS_GEMINI_MODEL


def resolve_price(model_name: str, override_in: float | None, override_out: float | None) -> tuple[float, float, bool]:
    """(price_in, price_out, is_estimate)를 돌려준다. override가 있으면 그걸 쓴다."""
    if override_in is not None and override_out is not None:
        return override_in, override_out, False
    # 가장 긴(구체적인) 키부터 매칭한다(gemini-2.5-flash-lite가 gemini-2.5-flash보다 우선).
    for key in sorted(DEFAULT_PRICES, key=len, reverse=True):
        if key in model_name:
            pin, pout = DEFAULT_PRICES[key]
            return (override_in if override_in is not None else pin,
                    override_out if override_out is not None else pout, True)
    return (override_in or 0.0, override_out or 0.0, True)


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * p
    lo = math.floor(k)
    hi = math.ceil(k)
    if lo == hi:
        return float(s[int(k)])
    return float(s[lo] * (hi - k) + s[hi] * (k - lo))


# ---------------------------------------------------------------------------
# 문서 1개 계측 (main._analyze_document_visuals와 동일한 흐름)
# ---------------------------------------------------------------------------
def _extract_base_markdown(path: str, suffix: str) -> str:
    """/convert의 1단계 텍스트 레이어 추출과 동일하게 base_markdown을 만든다."""
    if suffix == ".pdf":
        pdf_md = main._extract_pdf_markdown_with_page_markers(path)
        if pdf_md:
            return pdf_md
    result = main.md_converter.convert(path)
    return (result.text_content or "").strip()


def measure_doc(path: str, price_in: float, price_out: float) -> DocResult:
    suffix = Path(path).suffix.lower()
    res = DocResult(file=path, suffix=suffix)
    try:
        base_markdown = _extract_base_markdown(path, suffix)

        force_visual_scan = main.VISUAL_ANALYSIS_MODE in {"on", "always", "true", "1"}
        if not force_visual_scan and not main._should_analyze_visuals(base_markdown, suffix):
            res.skipped_reason = "gate: 시각 분석 대상 아님"
            return res

        visual_inputs = main._collect_visual_inputs(path, suffix, force_visual_scan)
        res.pages_selected = len(visual_inputs)
        if not visual_inputs:
            res.skipped_reason = "선택된 시각 페이지 없음"
            return res

        shared_context = (
            base_markdown[:main.VISUAL_CONTEXT_MAX_CHARS]
            if (suffix == ".pptx" and base_markdown) else ""
        )

        sink: list[dict] = []
        real_build = main._build_visual_llm

        def patched_build():
            # 두 모드 모두 inner를 usage 수집 프록시로 감싼다(mock은 inner가 _FakeLLM).
            inner = _FakeLLM() if MOCK_MODE else real_build()
            return None if inner is None else _UsageCapturingLLM(inner, sink)

        main._build_visual_llm = patched_build
        try:
            visual_body = main._run_visual_llm(visual_inputs, shared_context)
        finally:
            main._build_visual_llm = real_build

        res.vision_calls = len(sink)
        res.input_tokens = sum(int(u.get("input_tokens") or 0) for u in sink)
        res.output_tokens = sum(int(u.get("output_tokens") or 0) for u in sink)
        res.cost_usd = res.input_tokens / 1e6 * price_in + res.output_tokens / 1e6 * price_out

        if WITH_SUMMARY:
            # /convert(672-681)과 동일하게 base + 시각 분석을 병합해 요약 입력 markdown을 만든다.
            visual_markdown = ""
            if visual_body:
                visual_markdown = "# 이미지/손글씨 분석 결과\n\n" + visual_body
                if suffix == ".pdf":
                    visual_markdown = main._tag_visual_pdf_pages(visual_markdown)
            parts = [p for p in [base_markdown, visual_markdown.strip()] if p]
            full_markdown = "\n\n---\n\n".join(parts)
            _measure_summary(res, full_markdown, price_in, price_out)
    except Exception:
        res.error = traceback.format_exc(limit=3)
    return res


def _measure_summary(res: DocResult, full_markdown: str, price_in: float, price_out: float) -> None:
    """/summarize(876-902)와 동일한 프롬프트·모델로 요약 1회를 돌려 토큰/$를 측정한다.

    단일 자료(source_names=None)·focus 없음·페이지 필터 없음(full markdown) 기준.
    요약 모델은 build_llm(\"GPT\")=gpt-5.4-mini로 비전과 동일 단가를 쓴다.
    """
    from langchain_core.messages import HumanMessage, SystemMessage

    focus_checklist, focus_user_tail = main._summary_user_focus_parts(SUMMARY_TEMPLATE, None)
    prompt = main.SUMMARY_USER_PROMPT.format(
        template_label=main.TEMPLATE_LABELS[SUMMARY_TEMPLATE],
        template_instruction=main.TEMPLATE_INSTRUCTIONS[SUMMARY_TEMPLATE],
        citation_rule=main._citation_rule(None),
        markdown=full_markdown,
        focus_checklist=focus_checklist,
        focus_user_tail=focus_user_tail,
    )
    system_content = main._summary_system_content(None)
    sink: list[dict] = []
    inner = _FakeLLM() if MOCK_MODE else main.build_llm("GPT", max_tokens=main.SUMMARY_MAX_TOKENS)
    llm = _UsageCapturingLLM(inner, sink)
    llm.invoke([SystemMessage(content=system_content), HumanMessage(content=prompt)])
    res.summary_input_tokens = sum(int(u.get("input_tokens") or 0) for u in sink)
    res.summary_output_tokens = sum(int(u.get("output_tokens") or 0) for u in sink)
    res.summary_cost_usd = (
        res.summary_input_tokens / 1e6 * price_in
        + res.summary_output_tokens / 1e6 * price_out
    )


# ---------------------------------------------------------------------------
# 문서 수집
# ---------------------------------------------------------------------------
def discover_docs(patterns: list[str]) -> list[str]:
    found: list[str] = []
    for pat in patterns:
        p = Path(pat)
        if p.is_dir():
            for ext in VISION_EXTENSIONS:
                found.extend(str(f) for f in sorted(p.rglob(f"*{ext}")))
        elif any(ch in pat for ch in "*?["):
            found.extend(sorted(glob.glob(pat, recursive=True)))
        elif p.is_file():
            found.append(str(p))
    # 비전 경로가 처리하는 확장자만, 순서 유지하며 중복 제거.
    seen: set[str] = set()
    docs: list[str] = []
    for f in found:
        if Path(f).suffix.lower() in VISION_EXTENSIONS and f not in seen:
            seen.add(f)
            docs.append(f)
    return docs


# ---------------------------------------------------------------------------
# 메인
# ---------------------------------------------------------------------------
MOCK_MODE = False
WITH_SUMMARY = False
SUMMARY_TEMPLATE = "GENERAL"
SUMMARIES_PER_USER = 20


def main_cli() -> int:
    global MOCK_MODE, WITH_SUMMARY, SUMMARY_TEMPLATE, SUMMARIES_PER_USER
    parser = argparse.ArgumentParser(description="시각 분석 비용 계측(문서당 토큰/$ 측정)")
    parser.add_argument("--docs", nargs="+", required=True,
                        help="디렉터리/글롭/파일 경로(여러 개 가능). .pdf/.pptx만 측정")
    parser.add_argument("--limit", type=int, default=50, help="측정할 최대 문서 수(기본 50)")
    parser.add_argument("--price-in", type=float, default=None,
                        help="input 토큰 단가(USD/1M). 미지정 시 모델별 추정 기본값 사용")
    parser.add_argument("--price-out", type=float, default=None,
                        help="output 토큰 단가(USD/1M). 미지정 시 모델별 추정 기본값 사용")
    parser.add_argument("--out", default=None, help="JSON 리포트 저장 경로")
    parser.add_argument("--mock", action="store_true",
                        help="API 호출 없이 모의 토큰으로 플러밍/계산만 검증")
    parser.add_argument("--with-summary", action="store_true",
                        help="요약 생성(반복 비용)도 함께 측정한다(문서당 요약 1회)")
    parser.add_argument("--summary-template", default="GENERAL",
                        choices=["GENERAL", "LECTURE_NOTE", "MINDMAP", "CHEAT_SHEET"],
                        help="요약 템플릿(기본 GENERAL)")
    parser.add_argument("--summaries-per-user", type=int, default=20,
                        help="1인당 요약 횟수 가정(기본 20). 1인당 비용 투영에 사용")
    args = parser.parse_args()
    MOCK_MODE = args.mock
    WITH_SUMMARY = args.with_summary
    SUMMARY_TEMPLATE = args.summary_template
    SUMMARIES_PER_USER = args.summaries_per_user

    model_name = resolve_vision_model()
    price_in, price_out, is_estimate = resolve_price(model_name, args.price_in, args.price_out)

    if not args.mock:
        # 실측은 키가 있어야 토큰이 잡힌다. 키 없으면 _build_visual_llm이 None을 돌려
        # 0 토큰으로 조용히 측정되므로 미리 막는다.
        provider_key = "OPENAI_API_KEY" if main.VISUAL_ANALYSIS_MODEL == "GPT" else "GEMINI_API_KEY"
        if not os.getenv(provider_key):
            print(f"[오류] {provider_key}가 없어 실측 불가. .env에 키를 넣거나 --mock으로 실행.",
                  file=sys.stderr)
            return 2
        # 실측 동안 시각 항목 캐시를 우회해 'uncached' 비용을 측정한다(프로덕션 캐시 미오염).
        main.convert_cache.get_visual_section = lambda key: None
        main.convert_cache.set_visual_section = lambda key, section: None

    docs = discover_docs(args.docs)[:args.limit]
    if not docs:
        print("[오류] .pdf/.pptx 문서를 찾지 못했습니다.", file=sys.stderr)
        return 2

    print(f"모델: {model_name} | 단가(USD/1M) in={price_in} out={price_out}"
          f"{'  ⚠추정값(--price-in/out로 실단가 입력 권장)' if is_estimate else ''}"
          f"{'  [MOCK]' if args.mock else ''}")
    print(f"DPI={main.PDF_VISUAL_RENDER_DPI} | 페이지상한={main.VISUAL_ANALYSIS_MAX_ITEMS} | "
          f"배치={main.VISUAL_ANALYSIS_BATCH_SIZE} | 모드={main.VISUAL_ANALYSIS_MODE}")
    print(f"문서 {len(docs)}개 계측 시작...\n")

    results: list[DocResult] = []
    started = time.time()
    for i, doc in enumerate(docs, 1):
        r = measure_doc(doc, price_in, price_out)
        results.append(r)
        name = Path(doc).name
        if r.error:
            print(f"  [{i}/{len(docs)}] {name}: 오류")
        elif r.skipped_reason:
            print(f"  [{i}/{len(docs)}] {name}: 건너뜀({r.skipped_reason})")
        else:
            line = (f"  [{i}/{len(docs)}] {name}: {r.pages_selected}p, "
                    f"비전 in {r.input_tokens:,}/out {r.output_tokens:,} ${r.cost_usd:.4f}")
            if WITH_SUMMARY:
                line += (f"  | 요약 in {r.summary_input_tokens:,}/out "
                         f"{r.summary_output_tokens:,} ${r.summary_cost_usd:.4f}")
            print(line)

    # 집계
    with_vision = [r for r in results if r.vision_calls > 0 and not r.error]
    errors = [r for r in results if r.error]
    costs = [r.cost_usd for r in with_vision]
    in_tokens = [r.input_tokens for r in with_vision]
    out_tokens = [r.output_tokens for r in with_vision]
    pages = [r.pages_selected for r in with_vision]

    mean_cost = statistics.fmean(costs) if costs else 0.0

    # 요약(반복 비용) 집계 — --with-summary일 때만.
    with_summary = [r for r in with_vision if r.summary_output_tokens > 0]
    summ_costs = [r.summary_cost_usd for r in with_summary]
    summ_in = [r.summary_input_tokens for r in with_summary]
    summ_out = [r.summary_output_tokens for r in with_summary]
    mean_summary_cost = statistics.fmean(summ_costs) if summ_costs else 0.0

    summary = {
        "n_docs": len(results),
        "n_with_vision": len(with_vision),
        "n_skipped": len([r for r in results if r.skipped_reason]),
        "n_errors": len(errors),
        "pages_selected": {
            "mean": statistics.fmean(pages) if pages else 0.0,
            "max": max(pages) if pages else 0,
        },
        "tokens_per_doc": {
            "input_mean": statistics.fmean(in_tokens) if in_tokens else 0.0,
            "output_mean": statistics.fmean(out_tokens) if out_tokens else 0.0,
            "input_sum": sum(in_tokens),
            "output_sum": sum(out_tokens),
        },
        "cost_per_doc_usd": {
            "mean": mean_cost,
            "median": statistics.median(costs) if costs else 0.0,
            "p90": percentile(costs, 0.90),
            "max": max(costs) if costs else 0.0,
        },
        "total_cost_usd": sum(costs),
        "projection_usd": {
            "per_1k_docs": mean_cost * 1_000,
            "per_100k_docs": mean_cost * 100_000,
        },
        "elapsed_sec": round(time.time() - started, 1),
    }

    if WITH_SUMMARY:
        n_per_user = SUMMARIES_PER_USER
        # 1인당 = N건. 1건 = 자료 1개 업로드(비전 1회, 일회성) + 요약 생성 1회(반복).
        per_user_vision = mean_cost * n_per_user
        per_user_summary = mean_summary_cost * n_per_user
        summary["summary_cost_per_call_usd"] = {
            "mean": mean_summary_cost,
            "median": statistics.median(summ_costs) if summ_costs else 0.0,
            "max": max(summ_costs) if summ_costs else 0.0,
        }
        summary["summary_tokens_per_call"] = {
            "input_mean": statistics.fmean(summ_in) if summ_in else 0.0,
            "output_mean": statistics.fmean(summ_out) if summ_out else 0.0,
        }
        summary["per_user"] = {
            "summaries_per_user": n_per_user,
            "vision_usd": per_user_vision,       # 자료별 1회성(캐시 시 amortize)
            "summary_usd": per_user_summary,     # 요약마다 반복
            "total_usd": per_user_vision + per_user_summary,
            "per_1k_users_usd": (per_user_vision + per_user_summary) * 1_000,
        }

    print("\n" + "=" * 60)
    print(f"문서 {summary['n_docs']}개 중 비전 측정 {summary['n_with_vision']}개"
          f" (건너뜀 {summary['n_skipped']}, 오류 {summary['n_errors']})")
    print(f"문서당 선택 페이지: 평균 {summary['pages_selected']['mean']:.1f} (최대 {summary['pages_selected']['max']})")
    print(f"문서당 토큰: in 평균 {summary['tokens_per_doc']['input_mean']:,.0f} / "
          f"out 평균 {summary['tokens_per_doc']['output_mean']:,.0f}")
    print(f"문서당 비용(USD): 평균 ${summary['cost_per_doc_usd']['mean']:.4f} | "
          f"중앙값 ${summary['cost_per_doc_usd']['median']:.4f} | "
          f"p90 ${summary['cost_per_doc_usd']['p90']:.4f} | "
          f"최대 ${summary['cost_per_doc_usd']['max']:.4f}")
    print(f"투영(비전 일회성): 1k docs ≈ ${summary['projection_usd']['per_1k_docs']:.2f} | "
          f"100k docs/mo ≈ ${summary['projection_usd']['per_100k_docs']:,.0f}")

    if WITH_SUMMARY and "per_user" in summary:
        sc = summary["summary_cost_per_call_usd"]["mean"]
        st = summary["summary_tokens_per_call"]
        pu = summary["per_user"]
        print("-" * 60)
        print(f"요약 1건(반복): in 평균 {st['input_mean']:,.0f} / out 평균 {st['output_mean']:,.0f} "
              f"= ${sc:.4f}")
        print(f"  → 자료 1건당(비전 일회성 ${mean_cost:.4f} + 요약 ${sc:.4f}) = ${mean_cost + sc:.4f}")
        print(f"1인당 {pu['summaries_per_user']}건 가정:")
        print(f"  비전(일회성) ${pu['vision_usd']:.3f} + 요약(반복) ${pu['summary_usd']:.3f} "
              f"= 1인당 ${pu['total_usd']:.3f}")
        print(f"  1,000명 ≈ ${pu['per_1k_users_usd']:,.0f}")
    if is_estimate:
        print("⚠ 비용은 추정 단가 기반 — 공식 단가로 --price-in/--price-out 재실행해 확정할 것.")
    print("=" * 60)

    if args.out:
        report = {
            "config": {
                "model": model_name,
                "price_in_per_1m": price_in,
                "price_out_per_1m": price_out,
                "prices_are_estimate": is_estimate,
                "dpi": main.PDF_VISUAL_RENDER_DPI,
                "max_items": main.VISUAL_ANALYSIS_MAX_ITEMS,
                "batch_size": main.VISUAL_ANALYSIS_BATCH_SIZE,
                "mode": main.VISUAL_ANALYSIS_MODE,
                "mock": args.mock,
            },
            "summary": summary,
            "docs": [vars(r) for r in results],
        }
        Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"리포트 저장: {args.out}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main_cli())
