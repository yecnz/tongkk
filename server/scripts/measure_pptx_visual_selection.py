#!/usr/bin/env python3
"""PPTX 시각 이미지 선택 계측 — 구버전(zip 순서 앞 N개) vs 신버전(slide-rels + sha256 중복제거 +
덱 전체 균등추출)을 실제 강의자료에서 0비용(LLM 호출 없음)으로 비교한다.

목적: '덱 후반 이미지가 통째로 누락되던' 편향이 신버전에서 해소됐는지, 그리고 신버전이 예산을
다 쓰는지(미달 없음)·중복 로고를 접는지·orphan(마스터/레이아웃 chrome)을 안 고르는지를 사람이
눈으로/수치로 확인할 수 있게 선택 diff를 덤프한다. 프로덕션 코드는 건드리지 않고 main의 신버전
함수를 그대로 호출하며, 구버전 선택만 이 스크립트 안에서 재현한다.

사용 예:
  cd server && .venv/bin/python scripts/measure_pptx_visual_selection.py --docs sample_docs
  cd server && .venv/bin/python scripts/measure_pptx_visual_selection.py --docs /경로 --out sel.json --show-slides
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

# server/ 디렉터리를 import 경로에 넣어 main을 그대로 import한다(measure_vision_cost와 동일).
SERVER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER_DIR))

import main  # noqa: E402  (경로 삽입 후 import)
from measure_vision_cost import discover_docs  # noqa: E402  (.pdf/.pptx 수집 재사용)


def _all_image_media(archive: zipfile.ZipFile) -> list[str]:
    return [
        n for n in archive.namelist()
        if n.startswith("ppt/media/") and Path(n).suffix.lower() in main.PPTX_IMAGE_EXTENSIONS
    ]


def _media_to_slide(archive: zipfile.ZipFile) -> dict[str, int]:
    """media 경로 -> 그 미디어를 처음 참조하는 슬라이드 번호(없으면 미수록=orphan)."""
    mapping: dict[str, int] = {}
    rels = sorted(
        (int(m.group(1)), name)
        for name in archive.namelist()
        if (m := main._PPTX_SLIDE_RELS_RE.match(name))
    )
    for slide_no, rels_name in rels:
        for media in main._pptx_slide_image_targets(archive, rels_name):
            mapping.setdefault(media, slide_no)
    return mapping


def _old_selected_media(archive: zipfile.ZipFile, cap: int) -> list[str]:
    """구버전: namelist() zip 순서로 image media를 앞 cap개만(중복제거·슬라이드 매핑 없음)."""
    return _all_image_media(archive)[:cap]


def _new_selected_slides(items: list[dict]) -> list[int]:
    """신버전 프로덕션 함수의 선택(라벨)을 슬라이드 번호로 환산. 폴백 라벨은 0."""
    slides: list[int] = []
    for item in items:
        m = re.search(r"슬라이드 (\d+)", item["label"])
        slides.append(int(m.group(1)) if m else 0)
    return slides


def measure_doc(path: str, cap: int) -> dict:
    res: dict = {"file": path, "error": None}
    try:
        with zipfile.ZipFile(path) as archive:
            all_media = _all_image_media(archive)
            media_slide = _media_to_slide(archive)
            n_slides = len(set(
                int(m.group(1))
                for name in archive.namelist()
                if (m := main._PPTX_SLIDE_RELS_RE.match(name))
            ))
            old_media = _old_selected_media(archive, cap)
            # 구버전이 실제로 커버한 슬라이드(앞 zip 미디어가 속한 슬라이드).
            old_slides = sorted({media_slide[m] for m in old_media if m in media_slide})
            orphans = [m for m in all_media if m not in media_slide]
        # 신버전 선택(프로덕션 함수 1회 호출)과 그 슬라이드 환산.
        new_imgs = main._extract_pptx_images_for_visual_analysis(path)
        new_slides = _new_selected_slides(new_imgs)
        res.update({
            "n_slides": n_slides,
            "n_media_files": len(all_media),
            "n_orphans": len(orphans),
            "cap": cap,
            "old_n_selected": len(old_media),
            "old_slides_covered": old_slides,
            "old_max_slide": max(old_slides) if old_slides else 0,
            "new_n_selected": len(new_imgs),
            "new_slides_covered": new_slides,
            "new_max_slide": max(new_slides) if new_slides else 0,
            # 신버전이 덱 후반(전체 슬라이드의 후반 50%)을 커버하는지.
            "new_reaches_back_half": (max(new_slides) if new_slides else 0) > n_slides / 2,
            "old_reaches_back_half": (max(old_slides) if old_slides else 0) > n_slides / 2,
        })
    except Exception as e:  # noqa: BLE001
        res["error"] = repr(e)
    return res


def main_cli() -> int:
    parser = argparse.ArgumentParser(description="PPTX 시각 이미지 선택 계측(구버전 vs 신버전)")
    parser.add_argument("--docs", nargs="+", required=True, help="디렉터리/글롭/파일 경로. .pptx만 측정")
    parser.add_argument("--limit", type=int, default=200, help="측정할 최대 문서 수(기본 200)")
    parser.add_argument("--cap", type=int, default=main.VISUAL_ANALYSIS_MAX_ITEMS,
                        help=f"이미지 상한(기본 {main.VISUAL_ANALYSIS_MAX_ITEMS})")
    parser.add_argument("--out", default=None, help="JSON 리포트 저장 경로")
    parser.add_argument("--show-slides", action="store_true", help="문서별 구/신 커버 슬라이드 출력")
    args = parser.parse_args()

    docs = [d for d in discover_docs(args.docs) if Path(d).suffix.lower() == ".pptx"][:args.limit]
    if not docs:
        print("[오류] .pptx 문서를 찾지 못했습니다.", file=sys.stderr)
        return 2

    print(f"PPTX {len(docs)}개 | 상한={args.cap}\n")
    results = [measure_doc(d, args.cap) for d in docs]

    ok = [r for r in results if not r["error"]]
    over_cap = [r for r in ok if r["n_media_files"] > r["cap"]]
    underfilled = [r for r in ok if r["n_media_files"] >= r["cap"] and r["new_n_selected"] < r["cap"]]
    old_missed_back = [r for r in over_cap if not r["old_reaches_back_half"]]
    new_missed_back = [r for r in over_cap if not r["new_reaches_back_half"]]
    orphans_selected = [r for r in ok if any(s == 0 for s in r["new_slides_covered"])]

    for r in results:
        name = Path(r["file"]).name
        if r["error"]:
            print(f"  {name}: 오류 {r['error']}")
            continue
        print(f"  {name}: {r['n_slides']}슬라이드, 이미지 {r['n_media_files']}개"
              f"(orphan {r['n_orphans']}), 상한 {r['cap']}")
        print(f"      구버전: {r['old_n_selected']}개 선택, 최대 슬라이드 {r['old_max_slide']}/{r['n_slides']}"
              f"  {'(후반 미도달)' if not r['old_reaches_back_half'] else ''}")
        print(f"      신버전: {r['new_n_selected']}개 선택, 최대 슬라이드 {r['new_max_slide']}/{r['n_slides']}"
              f"  {'[경고:후반 미도달]' if not r['new_reaches_back_half'] else '(덱 후반 커버)'}")
        if args.show_slides:
            print(f"        구 커버: {r['old_slides_covered']}")
            print(f"        신 커버: {r['new_slides_covered']}")

    print("\n" + "=" * 60)
    print(f"문서 {len(ok)}개 측정(오류 {len(results) - len(ok)})")
    print(f"상한 초과(over-cap) 문서: {len(over_cap)}개  ← 선택이 달라지는 모집단")
    print(f"구버전이 덱 후반 미도달: {len(old_missed_back)}개  ← 후반 이미지 누락 피해 문서")
    print(f"신버전이 덱 후반 미도달: {len(new_missed_back)}개  (0이어야 함)")
    print(f"신버전 예산 미달(상한 못 채움): {len(underfilled)}개  (0이어야 함)")
    print(f"신버전이 orphan(슬라이드 0)을 선택: {len(orphans_selected)}개  (0이어야 함)")
    print("=" * 60)

    if args.out:
        Path(args.out).write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"리포트 저장: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main_cli())
