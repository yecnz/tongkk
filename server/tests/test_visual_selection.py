"""시각 분석 페이지 선택·표 추출 헬퍼 테스트.

`_render_pdf_pages_for_visual_analysis`가 상한을 넘는 후보에서 시각 풍부도가 높은
페이지를 고르는지(문서 순서 앞부분을 그냥 자르지 않는지)와, 보조 헬퍼가 예외 없이
동작하는지를 in-memory로 생성한 PDF로 고정한다. LLM·네트워크는 쓰지 않는다.
"""

import fitz
import pytest

import main


def _png_bytes(width: int = 64, height: int = 64, color=(10, 20, 30)) -> bytes:
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, width, height))
    pix.set_rect(pix.irect, color)
    return pix.tobytes("png")


def _make_pdf(path, page_count: int, image_pages: set[int]) -> None:
    """page_count장짜리 PDF를 만든다. image_pages(0-base)에는 큰 이미지를 넣어
    시각 풍부도를 높이고, 나머지는 긴 텍스트만 채운다."""
    doc = fitz.open()
    img = _png_bytes()
    for i in range(page_count):
        page = doc.new_page()
        # 텍스트 페이지로 분류되지 않도록 본문 텍스트를 충분히 채운다.
        page.insert_text((36, 72), ("본문 텍스트 " * 60), fontsize=11)
        if i in image_pages:
            page.insert_image(fitz.Rect(50, 200, 550, 700), stream=img)
    doc.save(str(path))
    doc.close()


class TestImageCoverage:
    def test_text_only_page_is_zero(self, tmp_path):
        pdf = tmp_path / "t.pdf"
        _make_pdf(pdf, page_count=1, image_pages=set())
        doc = fitz.open(str(pdf))
        try:
            assert main._pdf_page_image_coverage(doc.load_page(0)) == 0.0
        finally:
            doc.close()

    def test_image_page_is_positive(self, tmp_path):
        pdf = tmp_path / "t.pdf"
        _make_pdf(pdf, page_count=1, image_pages={0})
        doc = fitz.open(str(pdf))
        try:
            assert main._pdf_page_image_coverage(doc.load_page(0)) > 0.0
        finally:
            doc.close()


class TestTableExtraction:
    def test_text_only_page_returns_empty_without_raising(self, tmp_path):
        pdf = tmp_path / "t.pdf"
        _make_pdf(pdf, page_count=1, image_pages=set())
        doc = fitz.open(str(pdf))
        try:
            assert main._extract_page_tables_markdown(doc.load_page(0)) == ""
        finally:
            doc.close()


class TestRenderSelection:
    def test_prefers_high_coverage_pages_when_over_cap(self, tmp_path, monkeypatch):
        # 6페이지 중 이미지는 뒤쪽(3,4,5: 0-base)에 둔다. 상한이 2면 문서 순서로 앞을
        # 자르던 기존 동작은 1·2페이지를 골랐겠지만, 풍부도 정렬은 이미지가 있는
        # 뒤쪽 페이지를 골라야 한다.
        pdf = tmp_path / "t.pdf"
        _make_pdf(pdf, page_count=6, image_pages={3, 4, 5})
        monkeypatch.setattr(main, "VISUAL_ANALYSIS_MAX_ITEMS", 2)

        result = main._render_pdf_pages_for_visual_analysis(str(pdf))
        labels = [item["label"] for item in result]

        assert len(result) == 2
        # 라벨은 1-base 페이지 번호. 이미지가 있는 4~6페이지 중에서 골라야 한다.
        picked = {int(label.split("PDF ")[1].split("페이지")[0]) for label in labels}
        assert picked <= {4, 5, 6}
        # 출력은 페이지 번호 오름차순이어야 한다(마커 정합).
        assert labels == sorted(labels, key=lambda x: int(x.split("PDF ")[1].split("페이지")[0]))

    def test_under_cap_keeps_all_candidates_in_page_order(self, tmp_path, monkeypatch):
        pdf = tmp_path / "t.pdf"
        _make_pdf(pdf, page_count=3, image_pages={0, 2})
        monkeypatch.setattr(main, "VISUAL_ANALYSIS_MAX_ITEMS", 12)

        result = main._render_pdf_pages_for_visual_analysis(str(pdf))
        labels = [item["label"] for item in result]
        # 이미지가 있는 1·3페이지는 반드시 포함되고, 순서는 오름차순.
        picked = [int(label.split("PDF ")[1].split("페이지")[0]) for label in labels]
        assert 1 in picked and 3 in picked
        assert picked == sorted(picked)
