"""PPTX 삽입 이미지 수집(_extract_pptx_images_for_visual_analysis)과 슬라이드 태깅 테스트.

구버전의 'zip 순서로 앞 N개만 자르기' 편향을 제거한 새 수집 로직을 in-memory zip(.pptx)으로 고정한다.
검증 대상: 슬라이드 순서 라벨, 덱 전체 균등 추출(후반 누락 없음), sha256 중복제거, 다중 이미지 라벨,
suffix별 mime(webp 포함), 깨진 rels는 해당 슬라이드만 건너뜀(zip 폴백 복귀 아님), 이미지 0개 처리,
그리고 _tag_visual_pptx_slides 마커 태깅. LLM·네트워크는 쓰지 않는다.
"""

import io
import re
import zipfile

import pytest

import main

_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
_IMG = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
_LAYOUT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"


def _rels_xml(rels: list[tuple]) -> str:
    """rels: [(rId, type, target, target_mode|None), ...]"""
    parts = [f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="{_NS}">']
    for rid, rtype, target, mode in rels:
        mode_attr = f' TargetMode="{mode}"' if mode else ""
        parts.append(f'<Relationship Id="{rid}" Type="{rtype}" Target="{target}"{mode_attr}/>')
    parts.append("</Relationships>")
    return "".join(parts)


def _build_pptx(path, slides: dict[int, list[tuple]], media: dict[str, bytes], extra: dict[str, str] | None = None) -> None:
    """최소 .pptx를 만든다. slides: {slide_no: rels리스트}, media: {'image1.png': bytes}.

    수집 함수는 ppt/slides/_rels/slideN.xml.rels와 ppt/media/*만 읽으므로 슬라이드 본문 XML은 생략한다.
    extra: 임의 경로->문자열(깨진 rels 등 raw 작성용).
    """
    with zipfile.ZipFile(path, "w") as z:
        for slide_no, rels in slides.items():
            z.writestr(f"ppt/slides/_rels/slide{slide_no}.xml.rels", _rels_xml(rels))
        for name, data in media.items():
            z.writestr(f"ppt/media/{name}", data)
        for name, raw in (extra or {}).items():
            z.writestr(name, raw)


def _img_rel(rid: str, media: str, mode: str | None = None) -> tuple:
    return (rid, _IMG, f"../media/{media}", mode)


def _slides(label: str) -> list[int]:
    """라벨 목록에서 슬라이드 번호를 뽑는다."""
    out = []
    for l in label:
        m = re.search(r"슬라이드 (\d+)", l)
        out.append(int(m.group(1)) if m else -1)
    return out


class TestLabelHelper:
    def test_single_image_slide_label(self):
        assert main._pptx_visual_label(3, 1, 1) == "PPTX 슬라이드 3 이미지"

    def test_multi_image_slide_label(self):
        assert main._pptx_visual_label(3, 2, 4) == "PPTX 슬라이드 3 이미지 (4개 중 2번째)"

    def test_single_label_is_not_prefix_of_a_numbered_form(self):
        # 동결 규칙: 단일은 맨숫자형('이미지 1')을 쓰지 않는다(접두 충돌 방지).
        assert main._pptx_visual_label(3, 1, 1) == "PPTX 슬라이드 3 이미지"
        assert "번째" in main._pptx_visual_label(3, 1, 2)


class TestSlideOrderAndCoverage:
    def test_labels_in_slide_order_under_cap(self, tmp_path, monkeypatch):
        monkeypatch.setattr(main, "VISUAL_ANALYSIS_MAX_ITEMS", 12)
        pptx = tmp_path / "t.pptx"
        _build_pptx(
            pptx,
            slides={
                1: [_img_rel("rId1", "image1.png")],
                5: [_img_rel("rId1", "image5.jpg")],
                3: [_img_rel("rId1", "image3.png")],
            },
            media={"image1.png": b"A", "image3.png": b"B", "image5.jpg": b"C"},
        )
        labels = [i["label"] for i in main._extract_pptx_images_for_visual_analysis(str(pptx))]
        assert _slides(labels) == [1, 3, 5]

    def test_over_cap_covers_whole_deck_no_back_half_drop(self, tmp_path, monkeypatch):
        # 핵심 회귀 테스트: 20슬라이드 각 1이미지, 상한 5 → 앞 5개가 아니라 덱 전체에 분포해야 한다.
        monkeypatch.setattr(main, "VISUAL_ANALYSIS_MAX_ITEMS", 5)
        slides = {n: [_img_rel("rId1", f"image{n}.png")] for n in range(1, 21)}
        media = {f"image{n}.png": bytes([n]) for n in range(1, 21)}
        pptx = tmp_path / "t.pptx"
        _build_pptx(pptx, slides=slides, media=media)
        picked = _slides([i["label"] for i in main._extract_pptx_images_for_visual_analysis(str(pptx))])
        assert len(picked) == 5  # 전 예산 사용
        assert picked == sorted(picked)  # 슬라이드 오름차순
        assert max(picked) >= 16  # 덱 후반(16~20)에서 최소 하나 — 앞부분만 자르지 않음
        assert min(picked) == 1

    def test_full_budget_used_not_underfilled(self, tmp_path, monkeypatch):
        # ceil 방식이면 40개·상한 12에서 10개만 선택되는 미달 버그가 났다. i*n//cap은 12개를 채워야 한다.
        monkeypatch.setattr(main, "VISUAL_ANALYSIS_MAX_ITEMS", 12)
        slides = {n: [_img_rel("rId1", f"image{n}.png")] for n in range(1, 41)}
        media = {f"image{n}.png": bytes([n]) for n in range(1, 41)}
        pptx = tmp_path / "t.pptx"
        _build_pptx(pptx, slides=slides, media=media)
        imgs = main._extract_pptx_images_for_visual_analysis(str(pptx))
        assert len(imgs) == 12


class TestDedup:
    def test_byte_identical_images_collapsed(self, tmp_path, monkeypatch):
        monkeypatch.setattr(main, "VISUAL_ANALYSIS_MAX_ITEMS", 12)
        # 같은 로고(b'LOGO')가 슬라이드 1·2·3에, 고유 이미지가 슬라이드 2에.
        pptx = tmp_path / "t.pptx"
        _build_pptx(
            pptx,
            slides={
                1: [_img_rel("rId1", "logo_a.png")],
                2: [_img_rel("rId1", "logo_b.png"), _img_rel("rId2", "real.jpg")],
                3: [_img_rel("rId1", "logo_c.png")],
            },
            media={"logo_a.png": b"LOGO", "logo_b.png": b"LOGO", "logo_c.png": b"LOGO", "real.jpg": b"UNIQUE"},
        )
        labels = [i["label"] for i in main._extract_pptx_images_for_visual_analysis(str(pptx))]
        # 로고는 첫 등장(슬라이드 1)만, real은 슬라이드 2. 총 2개.
        assert len(labels) == 2
        assert _slides(labels) == [1, 2]


class TestMultiImageLabeling:
    def test_multi_image_slide_uses_count_and_index(self, tmp_path, monkeypatch):
        monkeypatch.setattr(main, "VISUAL_ANALYSIS_MAX_ITEMS", 12)
        pptx = tmp_path / "t.pptx"
        _build_pptx(
            pptx,
            slides={
                1: [_img_rel("rId1", "a.png")],
                2: [_img_rel("rId1", "b.png"), _img_rel("rId2", "c.png"), _img_rel("rId3", "d.png")],
            },
            media={"a.png": b"1", "b.png": b"2", "c.png": b"3", "d.png": b"4"},
        )
        labels = [i["label"] for i in main._extract_pptx_images_for_visual_analysis(str(pptx))]
        assert labels[0] == "PPTX 슬라이드 1 이미지"
        assert labels[1] == "PPTX 슬라이드 2 이미지 (3개 중 1번째)"
        assert labels[2] == "PPTX 슬라이드 2 이미지 (3개 중 2번째)"
        assert labels[3] == "PPTX 슬라이드 2 이미지 (3개 중 3번째)"

    def test_rid_order_within_slide(self, tmp_path, monkeypatch):
        monkeypatch.setattr(main, "VISUAL_ANALYSIS_MAX_ITEMS", 12)
        # rId10이 rId2보다 뒤(자연 정렬)여야 한다.
        pptx = tmp_path / "t.pptx"
        _build_pptx(
            pptx,
            slides={1: [_img_rel("rId10", "x.png"), _img_rel("rId2", "y.png")]},
            media={"x.png": b"X", "y.png": b"Y"},
        )
        urls = [i["data_url"] for i in main._extract_pptx_images_for_visual_analysis(str(pptx))]
        import base64
        first = base64.b64decode(urls[0].split(",", 1)[1])
        assert first == b"Y"  # rId2 먼저


class TestMime:
    def test_mime_per_suffix_including_webp(self, tmp_path, monkeypatch):
        monkeypatch.setattr(main, "VISUAL_ANALYSIS_MAX_ITEMS", 12)
        pptx = tmp_path / "t.pptx"
        _build_pptx(
            pptx,
            slides={
                1: [_img_rel("rId1", "a.png")],
                2: [_img_rel("rId1", "b.jpg")],
                3: [_img_rel("rId1", "c.jpeg")],
                4: [_img_rel("rId1", "d.webp")],
            },
            media={"a.png": b"1", "b.jpg": b"2", "c.jpeg": b"3", "d.webp": b"4"},
        )
        urls = [i["data_url"] for i in main._extract_pptx_images_for_visual_analysis(str(pptx))]
        prefixes = [u[: u.index(";")] for u in urls]
        assert prefixes == ["data:image/png", "data:image/jpeg", "data:image/jpeg", "data:image/webp"]

    def test_helper_webp(self):
        assert main._pptx_image_mime(".webp") == "image/webp"
        assert main._pptx_image_mime(".jpg") == "image/jpeg"
        assert main._pptx_image_mime(".png") == "image/png"


class TestRobustness:
    def test_malformed_rels_skips_slide_not_zip_revert(self, tmp_path, monkeypatch):
        # 슬라이드 2 rels가 깨졌어도 슬라이드 1·3은 정상 수집되고, 라벨은 여전히 슬라이드 기준이어야 한다
        # (zip 폴백으로 복귀하면 'PPTX 삽입 이미지 N' 카운터 라벨이 나오므로 그걸로 회귀 검출).
        monkeypatch.setattr(main, "VISUAL_ANALYSIS_MAX_ITEMS", 12)
        pptx = tmp_path / "t.pptx"
        _build_pptx(
            pptx,
            slides={
                1: [_img_rel("rId1", "a.png")],
                3: [_img_rel("rId1", "c.png")],
            },
            media={"a.png": b"1", "c.png": b"3", "orphan.png": b"9"},
            extra={"ppt/slides/_rels/slide2.xml.rels": "<<<not valid xml"},
        )
        labels = [i["label"] for i in main._extract_pptx_images_for_visual_analysis(str(pptx))]
        assert _slides(labels) == [1, 3]
        assert all(l.startswith("PPTX 슬라이드") for l in labels)

    def test_zip_fallback_only_when_no_slide_rels(self, tmp_path, monkeypatch):
        # slide rels가 전무하면(구조 비정상) zip 순서 폴백 + 카운터 라벨로 동작한다.
        monkeypatch.setattr(main, "VISUAL_ANALYSIS_MAX_ITEMS", 12)
        pptx = tmp_path / "t.pptx"
        _build_pptx(pptx, slides={}, media={"image1.png": b"1", "image2.png": b"2"})
        labels = [i["label"] for i in main._extract_pptx_images_for_visual_analysis(str(pptx))]
        assert labels == ["PPTX 삽입 이미지 1", "PPTX 삽입 이미지 2"]

    def test_non_image_and_external_rels_excluded(self, tmp_path, monkeypatch):
        monkeypatch.setattr(main, "VISUAL_ANALYSIS_MAX_ITEMS", 12)
        pptx = tmp_path / "t.pptx"
        _build_pptx(
            pptx,
            slides={
                1: [
                    ("rId1", _LAYOUT, "../slideLayouts/slideLayout1.xml", None),  # 이미지 아님
                    _img_rel("rId2", "ext.png", mode="External"),  # 외부 링크(바이트 없음)
                    _img_rel("rId3", "real.png"),  # 유효
                ],
            },
            media={"real.png": b"R"},
        )
        labels = [i["label"] for i in main._extract_pptx_images_for_visual_analysis(str(pptx))]
        assert labels == ["PPTX 슬라이드 1 이미지"]

    def test_zero_images_returns_empty(self, tmp_path, monkeypatch):
        monkeypatch.setattr(main, "VISUAL_ANALYSIS_MAX_ITEMS", 12)
        pptx = tmp_path / "t.pptx"
        _build_pptx(pptx, slides={1: [("rId1", _LAYOUT, "../slideLayouts/slideLayout1.xml", None)]}, media={})
        assert main._extract_pptx_images_for_visual_analysis(str(pptx)) == []

    def test_unsupported_extension_skipped(self, tmp_path, monkeypatch):
        monkeypatch.setattr(main, "VISUAL_ANALYSIS_MAX_ITEMS", 12)
        pptx = tmp_path / "t.pptx"
        _build_pptx(
            pptx,
            slides={1: [_img_rel("rId1", "vec.emf"), _img_rel("rId2", "ok.png")]},
            media={"vec.emf": b"E", "ok.png": b"P"},
        )
        labels = [i["label"] for i in main._extract_pptx_images_for_visual_analysis(str(pptx))]
        assert labels == ["PPTX 슬라이드 1 이미지"]


class TestPptxSlideTagging:
    def test_tags_single_label_heading(self):
        md = "## PPTX 슬라이드 3 이미지\n본문"
        assert main._tag_visual_pptx_slides(md) == "<!-- Slide number: 3 -->\n## PPTX 슬라이드 3 이미지\n본문"

    def test_tags_multi_label_heading(self):
        md = "## PPTX 슬라이드 7 이미지 (2개 중 1번째)\n본문"
        out = main._tag_visual_pptx_slides(md)
        assert out.startswith("<!-- Slide number: 7 -->\n")

    def test_does_not_tag_legacy_counter_label(self):
        md = "## PPTX 삽입 이미지 1\n본문"
        assert main._tag_visual_pptx_slides(md) == md

    def test_leaves_paraphrased_heading_untouched(self):
        md = "## 그림 분석 (세 번째 슬라이드)\n본문"
        assert main._tag_visual_pptx_slides(md) == md

    def test_partial_miss_tags_only_matched(self):
        md = "## PPTX 슬라이드 1 이미지\nA\n\n## 두 번째 그림\nB\n\n## PPTX 슬라이드 4 이미지\nC"
        out = main._tag_visual_pptx_slides(md)
        assert out.count("<!-- Slide number:") == 2
        assert "<!-- Slide number: 1 -->" in out
        assert "<!-- Slide number: 4 -->" in out
        assert "## 두 번째 그림" in out  # 미매치는 그대로


class TestFilterInteraction:
    def test_tagged_pptx_visual_distributes_by_slide(self):
        # 본문(슬라이드 1,2) + 태깅된 시각 섹션(슬라이드 2) → 슬라이드 2만 선택 시 본문 1은 빠지고
        # 시각 섹션은 마커가 있으므로 trailing 보존 분기가 아니라 일반 페이지 필터를 탄다.
        body = "<!-- Slide number: 1 -->\n슬라이드1 본문\n\n<!-- Slide number: 2 -->\n슬라이드2 본문"
        visual = main._tag_visual_pptx_slides(
            main._VISUAL_SECTION_HEADING + "\n\n## PPTX 슬라이드 2 이미지\n그림설명"
        )
        md = body + "\n\n---\n\n" + visual
        filtered = main._filter_markdown_by_pages(md, "2")
        assert "슬라이드1 본문" not in filtered
        assert "슬라이드2 본문" in filtered
        assert "그림설명" in filtered
