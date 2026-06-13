// '반영할 페이지'는 변환 시점에 심는 페이지 마커(<!-- p.N -->, <!-- Slide number: N -->)에
// 의존한다. 마커가 없는(기능 추가 전 변환된) 자료는 페이지 선택이 동작하지 않는다.
// 자료 요약·퀴즈 생성이 같은 게이트를 쓰도록 공용 모듈로 둔다(백엔드 _filter_markdown_by_pages와 대응).
export const PAGE_MARKER_PATTERN = /<!--\s*(?:p\.|Slide number:\s*)\d+\s*-->/;

export const hasPageMarkers = (markdown: string) => PAGE_MARKER_PATTERN.test(markdown);
