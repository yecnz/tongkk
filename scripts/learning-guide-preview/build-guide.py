"""Build the screenshot guide using the bundled document runtime's Python."""
import json
from pathlib import Path
from PIL import Image
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.section import WD_ORIENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'notes/learning-guide'
CONTENT = json.loads((DEST / 'guide-content.json').read_text())
FONT = 'Noto Sans KR'
doc = Document()
section = doc.sections[0]
section.orientation = WD_ORIENT.LANDSCAPE
section.page_width = Inches(11.69)
section.page_height = Inches(8.27)
section.top_margin = Inches(.38)
section.bottom_margin = Inches(.38)
section.left_margin = section.right_margin = Inches(.58)
section.footer_distance = Inches(.16)

for name, size in [('Normal', 11), ('Title', 30), ('Subtitle', 15), ('Heading 1', 19), ('Heading 2', 14), ('Caption', 9)]:
    style = doc.styles[name]
    style.font.name = FONT
    style.font.size = Pt(size)
    style.font.color.rgb = RGBColor(0, 0, 0)
    fonts = style.element.get_or_add_rPr().get_or_add_rFonts()
    for key in list(fonts.attrib):
        if 'theme' in key.lower():
            del fonts.attrib[key]
    for key in ['ascii', 'hAnsi', 'eastAsia', 'cs']:
        fonts.set(qn('w:' + key), FONT)
    style.paragraph_format.space_after = Pt(5)
    style.paragraph_format.line_spacing = Pt({'Title': 39, 'Subtitle': 21, 'Heading 1': 25, 'Heading 2': 19, 'Caption': 12}.get(name, 15))
    for border in style.element.xpath('./w:pPr/w:pBdr'):
        border.getparent().remove(border)
    style.font.underline = False
    style.font.italic = False
doc.styles['Caption'].font.bold = False
doc.styles['Normal'].paragraph_format.widow_control = True
doc.styles['Heading 1'].paragraph_format.space_before = Pt(0)
doc.styles['Heading 1'].paragraph_format.keep_with_next = True
doc.core_properties.title = 'Tongkk 학습 기능 화면과 사용 흐름'
doc.core_properties.author = 'Tongkk'
doc.core_properties.subject = '학습 브리핑부터 외부 자료 연결과 설명 개선까지의 화면 안내'
doc.core_properties.keywords = 'Tongkk, 학습, 사용 안내, 화면, 복습'

footer = section.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
run = footer.add_run('Tongkk 학습 기능 안내  |  ')
run.font.size = Pt(8)
field = OxmlElement('w:fldSimple')
field.set(qn('w:instr'), 'PAGE')
footer._p.append(field)

def paragraph(text, size=None, bold=False, after=5):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(after)
    r = p.add_run(text)
    r.bold = bold
    if size:
        r.font.size = Pt(size)
    return p

def next_page(title):
    p = doc.add_heading(title, 1)
    p.paragraph_format.page_break_before = True

def picture(item):
    path = DEST / 'screenshots' / item['image']
    with Image.open(path) as img:
        width, height = img.size
    left, top, right, bottom = item['crop']
    assert 0 <= left < right <= width and 0 <= top < bottom <= height, item['image']
    visible_w, visible_h = right - left, bottom - top
    scale = min(10.4 / visible_w, 4.9 / visible_h)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1
    shape = p.add_run().add_picture(str(path), width=Inches(visible_w * scale), height=Inches(visible_h * scale))
    # Word crops the embedded original screenshot to its relevant UI region.
    # The original JPEG remains untouched and is retained beside the guide.
    crop = OxmlElement('a:srcRect')
    for k, value in [('l', left / width), ('t', top / height), ('r', (width-right) / width), ('b', (height-bottom) / height)]:
        crop.set(k, str(round(value * 100000)))
    fill = shape._inline.graphic.graphicData.pic.blipFill
    fill.insert(1, crop)
    shape._inline.docPr.set('descr', item['caption'] + ' 예시 학습 데이터를 사용한 실제 구현 컴포넌트 화면')
    cap = doc.add_paragraph(item['caption'], 'Caption')
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap.paragraph_format.space_after = Pt(7)

doc.add_paragraph('Tongkk 학습 기능\n화면과 사용 흐름', 'Title')
doc.add_paragraph('자료를 준비하고 설명한 뒤 보완과 복습으로 이어가는 사용 안내', 'Subtitle')
paragraph('이 문서는 학습 브리핑, 학습 이슈, 자동 복습, 학습 메이트, 학습 준비 자동화, 장기 학습 메모리, 외부 서비스 연결, 학습 PR의 화면과 사용 순서를 설명합니다.', 13, after=14)
doc.add_heading('서비스를 사용하는 기본 흐름', 2)
paragraph('자료 가져오기 → 학습 자료 준비 → 설명 학습 → 피드백과 이슈 보완 → 설명 개선 → 예정일 복습 → 개념 기록 확인', 15, True, 14)
paragraph('시작할 때는 대시보드에서 오늘 이어갈 항목을 고릅니다. 설명이 부족한 개념은 이슈와 수정 이력으로 보완하고, 시간이 지난 뒤 새 사례 문제로 다시 설명합니다. 여러 과목의 개념은 지도에서 연결해 선수 개념부터 보완할 수 있습니다.', 12, after=16)
doc.add_heading('화면을 읽기 전에', 2)
paragraph('캡처는 실제 구현 컴포넌트에 예시 학습 데이터를 연결한 로컬 화면입니다. 실제 계정의 학습 기록이나 외부 계정 연결 결과가 아닙니다. 대시보드·자료·통계·마이페이지·캘린더는 해당 기능을 보기 쉽게 모은 설명용 주변 화면을 사용했습니다. 복습 관리·복습 풀이·설명 개선은 구현된 페이지를 사용했습니다.', 11, after=10)
paragraph('문서의 진입 위치는 실제 서비스 메뉴 기준입니다. 그림은 주요 영역을 확대해 싣고, 원본 캡처는 screenshots 폴더에 보관했습니다. 예시 과목은 운영체제와 시스템 프로그래밍이며, 일정은 2026년 11월 23일과 Asia/Seoul 기준입니다.', 11, after=12)
paragraph('작성 기준  2026년 11월 23일  |  기능 구현 기준  aa60ba3  |  화면 21개', 10)

next_page('기능별 화면 위치와 문서 순서')
paragraph('기획에서 제안한 8개 기능을 실제 화면 이름에 맞춰 정리했습니다. 다음 페이지부터 각 화면의 진입 위치, 사용 단계, 결과를 확인할 수 있습니다.', 11, after=12)
table = doc.add_table(rows=1, cols=4)
table.autofit = False
widths = [1.8, 3.3, 3.65, 1.65]
for col, width in zip(table.columns, widths):
    col.width = Inches(width)
for cell, text, w in zip(table.rows[0].cells, ['기능', '서비스에서 여는 위치', '사용 후 확인할 결과', '문서 쪽'], widths):
    cell.text = text
    cell.width = Inches(w)
rows = [
 ('학습 브리핑', '대시보드의 이어서 학습하기', '이어서 할 학습과 복습 및 보완 추천', '3'),
 ('학습 이슈 트래커', '복습 관리의 학습 이슈', '개념별 보완 상태와 원문·답변 근거', '4~5'),
 ('자동 복습 에이전트', '마이페이지 복습 설정과 복습 관리', '새 사례 풀이와 다음 복습일', '6~9'),
 ('학습 메이트 위젯', '자료 또는 개념·이슈 화면 오른쪽 아래', '현재 자료와 연결된 질문과 근거 답변', '10'),
 ('학습 준비 자동화', '자료 요약의 학습 자료 자동 준비', '요약·퀴즈·설명 학습 초안과 저장 결과', '11'),
 ('장기 학습 메모리', '학습 통계의 개념별 기록과 개념 지도', '누적 수행과 개념 관계 및 선수 개념 추천', '12~15'),
 ('외부 서비스 연동', '마이페이지 연결과 학습 캘린더', 'Calendar 일정 및 Drive·Notion 자료 버전', '16~21'),
 ('학습 PR', '설명 학습 기록의 설명 다듬기', '설명 개선의 전후 비교와 재평가 이력', '22~23'),
]
for row in rows:
    cells = table.add_row().cells
    for cell, text, w in zip(cells, row, widths):
        cell.text = text
        cell.width = Inches(w)
for i, row in enumerate(table.rows):
    for cell in row.cells:
        tcpr = cell._tc.get_or_add_tcPr()
        borders = OxmlElement('w:tcBorders')
        for edge in ['top', 'left', 'bottom', 'right']:
            e = OxmlElement('w:' + edge)
            e.set(qn('w:val'), 'single')
            e.set(qn('w:sz'), '4')
            e.set(qn('w:color'), 'D9D9D9')
            borders.append(e)
        tcpr.append(borders)
        margins = OxmlElement('w:tcMar')
        for side in ['top', 'bottom', 'left', 'right']:
            e = OxmlElement('w:' + side)
            e.set(qn('w:w'), '100')
            e.set(qn('w:type'), 'dxa')
            margins.append(e)
        tcpr.append(margins)
        if i == 0:
            shade = OxmlElement('w:shd'); shade.set(qn('w:fill'), 'F2F2F2'); tcpr.append(shade)
        for p in cell.paragraphs:
            p.paragraph_format.space_after = Pt(1)
            for r in p.runs:
                r.font.size = Pt(10)
                r.bold = i == 0
    if i == 0:
        repeat = OxmlElement('w:tblHeader'); row._tr.get_or_add_trPr().append(repeat)
paragraph('상태와 운영 조건은 마지막 24쪽에서 확인합니다. 화면의 예시 결과는 실제 모델 평가 품질이나 OAuth 연결 성공을 검증한 기록이 아닙니다.', 10, after=0)

for index, item in enumerate(CONTENT, 1):
    next_page(f'{index:02d} {item["title"]}')
    paragraph('진입  ' + item['entry'], 10, after=5)
    picture(item)
    for n, text in enumerate(item['steps'], 1):
        paragraph(f'{n}. {text}', 10.5, after=3)
    paragraph('결과  ' + item['result'], 10, after=0)

next_page('상태별 의미와 실제 사용 조건')
doc.add_heading('상태가 바뀌었을 때 확인할 내용', 2)
for title, text in [
    ('확인 필요와 보완 중', '학습 근거가 부족하거나 설명을 보완하는 상태입니다. 원문과 피드백을 확인하고 설명 개선 또는 복습으로 이어갑니다.'),
    ('재평가 대기와 수동 종료', '재평가 대기는 보완 뒤 확인을 기다리는 상태입니다. 수동 종료는 관리 상태를 닫는 동작이며 이해 완료 판정과 구분합니다.'),
    ('최근 안정', '누적된 수행에 따른 현재 상태입니다. 한 번 맞혔다는 뜻으로 장기 이해를 확정하지 않으며 이후 복습과 새로운 근거가 쌓입니다.'),
    ('원문 변경', '기존 답변은 이전 자료 버전의 근거로 남습니다. 변경된 자료로 새 학습을 진행한 뒤 현재 자료에 맞춰 다시 확인합니다.'),
    ('준비 실패 또는 평가 실패', '준비 작업은 화면의 재시도로 다시 요청합니다. 평가하지 못한 답변은 보존되며 평가 실패만으로 복습 일정을 성공 처리하지 않습니다.'),
    ('연결되지 않음 또는 다시 연결 필요', '외부 계정의 연결과 허용 범위를 확인합니다. 가져온 자료는 검토 후 저장하며 연결 해제와 원본 문서 수정은 다른 동작입니다.'),
]:
    p = paragraph(title + '  ' + text, 11, after=9)
    p.runs[0].bold = False
doc.add_heading('실제 서비스에서 사용하기 위한 조건', 2)
paragraph('사용자 로그인과 학습 데이터 저장 구성이 필요합니다. 백엔드의 학습 기능 마이그레이션과 API 및 별도 워커를 적용해야 생성 작업, 복습 문제 준비, 일정 동기화가 실제로 수행됩니다.', 11, after=8)
paragraph('Google Calendar와 Google Drive 및 Notion은 서버 OAuth 설정과 암호화 키를 구성한 뒤 각 사용자가 계정을 연결해야 합니다. 실제 모델 응답과 외부 계정의 권한·자료 형식에 따라 생성 결과와 가져오기 결과가 달라집니다.', 11, after=8)
paragraph('구성 값과 배포 순서는 저장소의 server/README.md와 .env.example에 정리되어 있습니다. 이 안내의 연결 상태와 평가 결과는 사용 흐름을 설명하기 위한 예시입니다.', 10)

output = DEST / 'Tongkk_학습기능_화면과_사용흐름.docx'
doc.save(output)
print(output)
print(f'{len(CONTENT)} screenshots embedded; expected 24 pages')
