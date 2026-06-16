import { describe, expect, it } from 'vitest';
import { splitMarkdownIntoChunks } from './summaryStream';

// 구간 분할의 시각 섹션 처리(버그 #2)를 고정한다.
// - 구버전 PPTX: 마커 없는 trailing 시각 섹션을 별도 마지막 구간으로 떼어 항상 보존(페이지 선택 무관).
// - 신버전 PPTX/PDF: 시각 섹션에 슬라이드/페이지 마커가 있으면 떼지 않고 일반 분배(페이지 선택 적용).

const VISUAL_HEADING = '# 이미지/손글씨 분석 결과';

function joined(chunks: { markdown: string }[]): string {
  return chunks.map(c => c.markdown).join('\n\n');
}

const LEGACY_PPTX = [
  '<!-- Slide number: 1 -->',
  '슬라이드1 본문',
  '',
  '<!-- Slide number: 2 -->',
  '슬라이드2 본문',
  '',
  '---',
  '',
  VISUAL_HEADING,
  '',
  '## PPTX 삽입 이미지 1',
  '그림 설명 A',
].join('\n');

const TAGGED_PPTX = [
  '<!-- Slide number: 1 -->',
  '슬라이드1 본문',
  '',
  '<!-- Slide number: 2 -->',
  '슬라이드2 본문',
  '',
  '---',
  '',
  VISUAL_HEADING,
  '',
  '<!-- Slide number: 2 -->',
  '## PPTX 슬라이드 2 이미지',
  '그림 설명 B',
].join('\n');

describe('splitMarkdownIntoChunks — 시각 섹션 처리', () => {
  it('구버전 PPTX: 마커 없는 시각 섹션을 별도 마지막 구간으로 분리', () => {
    const chunks = splitMarkdownIntoChunks(LEGACY_PPTX);
    const last = chunks[chunks.length - 1];
    expect(last.markdown).toContain(VISUAL_HEADING);
    expect(last.markdown).toContain('그림 설명 A');
    // 본문 구간에는 시각 섹션이 섞이지 않는다.
    expect(chunks.slice(0, -1).some(c => c.markdown.includes('그림 설명 A'))).toBe(false);
    // 본문 끝의 '---' 구분자는 제거된다(빈 구분자 잔류 방지).
    expect(chunks.slice(0, -1).some(c => /-{3,}\s*$/.test(c.markdown.trim()))).toBe(false);
  });

  it('구버전 PPTX: 마지막 슬라이드를 페이지 선택에서 빼도 시각 섹션은 보존', () => {
    const all = joined(splitMarkdownIntoChunks(LEGACY_PPTX, '1'));
    expect(all).toContain('그림 설명 A');     // 시각 섹션 보존
    expect(all).not.toContain('슬라이드2 본문'); // 슬라이드 2 본문은 필터됨
  });

  it('신버전 PPTX: 마커 달린 시각 섹션은 분리하지 않고 슬라이드 단위로 분배', () => {
    expect(joined(splitMarkdownIntoChunks(TAGGED_PPTX))).toContain('그림 설명 B');
    // 슬라이드 1만 선택하면 슬라이드 2로 태깅된 시각 분석도 함께 제외된다(구버전과 대비되는 동작).
    const onlySlide1 = joined(splitMarkdownIntoChunks(TAGGED_PPTX, '1'));
    expect(onlySlide1).toContain('슬라이드1 본문');
    expect(onlySlide1).not.toContain('그림 설명 B');
  });

  it('마커 없는 자료의 trailing 시각 섹션도 별도 구간으로 보존', () => {
    const noMarker = ['일반 본문 문단 1', '', '일반 본문 문단 2', '', VISUAL_HEADING, '', '## 업로드 이미지', '설명 텍스트'].join('\n');
    const chunks = splitMarkdownIntoChunks(noMarker);
    expect(chunks[chunks.length - 1].markdown).toContain('설명 텍스트');
    expect(joined(chunks)).toContain('일반 본문 문단 1');
  });

  it('시각 섹션이 없으면 기존 분배 동작 유지', () => {
    const md = '<!-- Slide number: 1 -->\n본문1\n\n<!-- Slide number: 2 -->\n본문2';
    const chunks = splitMarkdownIntoChunks(md);
    expect(chunks.every(c => !c.markdown.includes(VISUAL_HEADING))).toBe(true);
    expect(joined(chunks)).toContain('본문1');
    expect(joined(chunks)).toContain('본문2');
  });

  it('큰 시각 섹션은 문단 기준으로 쪼개고 둘째 조각부터 이어짐 표시', () => {
    const big = Array.from({ length: 60 }, (_, i) => `## 그림 ${i}\n${'가'.repeat(400)}`).join('\n\n');
    const md = `<!-- Slide number: 1 -->\n본문\n\n---\n\n${VISUAL_HEADING}\n\n${big}`;
    const chunks = splitMarkdownIntoChunks(md);
    const visualChunks = chunks.slice(1); // chunks[0]은 본문(슬라이드 1)
    expect(visualChunks.length).toBeGreaterThan(1);
    expect(visualChunks[0].isContinuation).toBe(false);
    expect(visualChunks.slice(1).every(c => c.isContinuation)).toBe(true);
  });
});
