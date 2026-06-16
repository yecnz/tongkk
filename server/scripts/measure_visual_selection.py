#!/usr/bin/env python3
"""시각 페이지 선택 계측 — 현행(raster coverage) 선택 vs 벡터 fill 신호 추가 선택을 비교.

목적: #1(벡터 도식을 시각 풍부도 정렬에 반영)을 프로덕션에 넣기 전에, 실제 강의자료에서
벡터 fill 신호가 '어떤 페이지'를 새로 끌어올리고/떨어뜨리는지 0비용(LLM 호출 없음)으로 측정한다.

배경: 합성 테스트에서 fill 신호는 채운 도식을 끌어올리지만, 채운 장식 chrome(데코 밴드·음영 표·
템플릿 chrome)도 함께 끌어올려 stroke-only 진짜 도식을 밀어내는 backfire가 확인됐다. 실제 덱에서
순효과가 +인지 -인지는 자료 구성에 달렸으므로, 사람이 눈으로 판정할 수 있게 선택 diff를 덤프한다.
이 수치가 나오기 전에는 main.py의 선택 정렬에 fill 신호를 넣지 않는다.

프로덕션 코드는 건드리지 않는다. main의 게이트·상한·정렬 로직을 그대로 재현하되,
정렬 점수만 (a)현행=raster coverage, (b)제안=max(coverage, vector_fill)로 두고 선택 집합을 비교한다.

사용 예:
  cd server && .venv/bin/python scripts/measure_visual_selection.py --docs /경로/lecture_pdfs
  cd server && .venv/bin/python scripts/measure_visual_selection.py --docs /경로 --out sel.json --show-pages
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import fitz

# server/ 디렉터리를 import 경로에 넣어 main을 그대로 import한다(measure_vision_cost와 동일).
SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

import main  # noqa: E402  (경로 삽입 후 import)
from measure_vision_cost import discover_docs  # noqa: E402  (.pdf/.pptx 수집 재사용)

# 단일 fill path가 페이지의 이 비율 이상이면 전면 배경 장식으로 보고 제외(제안 _BACKGROUND_FILL_MAX_RATIO).
BACKGROUND_FILL_MAX_RATIO = 0.85


def _page_vector_fill(page) -> float:
    """채워진(fill) 벡터 도형이 차지하는 면적 비율(0~1). 제안 #1 신호의 후보 구현.

    표 격자선·테두리(stroke-only, fill=None)는 0이 되고, 전면 배경(단일 초대형 fill)은 제외한다.
    한계(계측으로 확인할 대상): 채운 데코 밴드·음영 표·템플릿 chrome은 fill>0이라 잡히고,
    stroke-only 도식은 0이라 못 잡는다.
    """
    rect = page.rect
    page_area = float(rect.width * rect.height)
    if page_area <= 0:
        return 0.0
    try:
        drawings = page.get_drawings()
    except Exception:
        return 0.0
    fill_area = 0.0
    for d in drawings:
        if d.get("type") not in ("f", "fs") or d.get("fill") is None:
            continue
        r = d.get("rect")
        if r is None:
            continue
        a = max(0.0, r.width) * max(0.0, r.height)
        if a >= BACKGROUND_FILL_MAX_RATIO * page_area:  # 전면 배경 장식 제외
            continue
        fill_area += a
    return min(1.0, fill_area / page_area)


def _select(doc, cap: int, use_vector_fill: bool) -> tuple[set[int], list[int], dict[int, float]]:
    """main._render_pdf_pages_for_visual_analysis의 선택부를 그대로 재현(렌더 제외).

    반환: (후보 집합, 선택된 페이지 인덱스 오름차순, 페이지별 fill 점수).
    """
    candidates: list[tuple[int, float]] = []
    fills: dict[int, float] = {}
    for index in range(len(doc)):
        page = doc.load_page(index)
        coverage = main._pdf_page_image_coverage(page)
        # 게이트는 현행과 동일(코드 변경 없음) — 후보 집합은 두 모드가 동일해야 한다(비용중립).
        page_text_len = main._text_length(page.get_text("text") or "")
        if page_text_len < main.PDF_VISUAL_TEXT_PAGE_CHARS or coverage > 0:
            vfill = _page_vector_fill(page)
            fills[index] = vfill
            score = max(coverage, vfill) if use_vector_fill else coverage
            candidates.append((index, score))
    cand_set = {i for i, _ in candidates}
    if len(candidates) > cap:
        candidates = sorted(candidates, key=lambda c: c[1], reverse=True)[:cap]
    selected = sorted(i for i, _ in candidates)
    return cand_set, selected, fills


def measure_doc(path: str, cap: int) -> dict:
    res: dict = {"file": path, "error": None}
    try:
        with fitz.open(path) as doc:
            n_pages = len(doc)
            cur_set, cur_sel, _ = _select(doc, cap, use_vector_fill=False)
            new_set, new_sel, fills = _select(doc, cap, use_vector_fill=True)
        added = sorted(set(new_sel) - set(cur_sel))      # fill 신호로 새로 들어온 페이지
        removed = sorted(set(cur_sel) - set(new_sel))    # fill 신호로 밀려난 페이지
        res.update({
            "n_pages": n_pages,
            "n_candidates": len(cur_set),
            "cap": cap,
            "cost_neutral": cur_set == new_set and len(cur_sel) == len(new_sel),
            "current_selected": [i + 1 for i in cur_sel],   # 1-base 페이지 번호
            "proposed_selected": [i + 1 for i in new_sel],
            "added": [i + 1 for i in added],
            "removed": [i + 1 for i in removed],
            "n_changed": len(added),
            # 들어오고/밀려난 페이지의 fill 점수(사람이 도식 vs chrome 판정에 사용).
            "added_fill": {i + 1: round(fills.get(i, 0.0), 3) for i in added},
            "removed_fill": {i + 1: round(fills.get(i, 0.0), 3) for i in removed},
        })
    except Exception as e:  # noqa: BLE001
        res["error"] = repr(e)
    return res


def main_cli() -> int:
    parser = argparse.ArgumentParser(description="시각 페이지 선택 계측(현행 vs 벡터 fill 신호)")
    parser.add_argument("--docs", nargs="+", required=True, help="디렉터리/글롭/파일 경로. .pdf만 측정")
    parser.add_argument("--limit", type=int, default=200, help="측정할 최대 문서 수(기본 200)")
    parser.add_argument("--cap", type=int, default=main.VISUAL_ANALYSIS_MAX_ITEMS,
                        help=f"페이지 상한(기본 {main.VISUAL_ANALYSIS_MAX_ITEMS})")
    parser.add_argument("--out", default=None, help="JSON 리포트 저장 경로")
    parser.add_argument("--show-pages", action="store_true", help="선택이 바뀐 문서의 페이지 diff 출력")
    args = parser.parse_args()

    # PDF만 의미가 있다(PPTX는 삽입 이미지 경로라 페이지 선택 로직과 무관).
    docs = [d for d in discover_docs(args.docs) if Path(d).suffix.lower() == ".pdf"][:args.limit]
    if not docs:
        print("[오류] .pdf 문서를 찾지 못했습니다.", file=sys.stderr)
        return 2

    print(f"PDF {len(docs)}개 | 상한={args.cap} | 게이트=현행 동일(비용중립)\n")
    results = [measure_doc(d, args.cap) for d in docs]

    ok = [r for r in results if not r["error"]]
    changed = [r for r in ok if r["n_changed"] > 0]
    over_cap = [r for r in ok if r["n_candidates"] > r["cap"]]
    not_neutral = [r for r in ok if not r["cost_neutral"]]
    total_changed_pages = sum(r["n_changed"] for r in changed)

    for r in results:
        name = Path(r["file"]).name
        if r["error"]:
            print(f"  {name}: 오류 {r['error']}")
            continue
        flag = "" if r["cost_neutral"] else "  [경고:비용중립 깨짐]"
        line = f"  {name}: {r['n_pages']}p, 후보 {r['n_candidates']}/상한 {r['cap']}, 변경 {r['n_changed']}p{flag}"
        print(line)
        if args.show_pages and r["n_changed"] > 0:
            print(f"      + 편입 {r['added']} fill={r['added_fill']}")
            print(f"      - 탈락 {r['removed']} fill={r['removed_fill']}")

    print("\n" + "=" * 60)
    print(f"문서 {len(ok)}개 측정(오류 {len(results) - len(ok)})")
    print(f"상한 초과(over-cap) 문서: {len(over_cap)}개  ← 선택이 바뀔 수 있는 모집단")
    print(f"선택이 바뀐 문서: {len(changed)}개, 바뀐 페이지 합 {total_changed_pages}")
    if not_neutral:
        print(f"[경고] 비용중립 깨진 문서 {len(not_neutral)}개 — 게이트 재현 오류 가능")
    print("판정: 편입(added) 페이지의 fill이 진짜 도식이면 신호가 도움, "
          "데코 밴드/음영 표면 backfire. --show-pages로 눈으로 확인 후 가드 설계.")
    print("=" * 60)

    if args.out:
        Path(args.out).write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"리포트 저장: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main_cli())
