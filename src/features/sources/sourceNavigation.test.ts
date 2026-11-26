import { describe, expect, it } from 'vitest';
import { buildSourceUrl, parseSourcePage, resolveCitationTarget, sourcePageExcerpt, remarkSourceCitations, type CitationScope } from './sourceNavigation';
const materials = [{ id: 'a:1', name: '1강.pdf', updatedAt: 100 }, { id: 'b&2', name: '2강.pdf', updatedAt: 200 }];
const scope: CitationScope = { courseName: '자료 구조 & 알고리즘', materials, materialIds: materials.map(m => m.id) };

describe('source navigation', () => {
  it('encodes stable source identity, never a storage URL, and validates page values', () => {
    const query = new URL(buildSourceUrl({ courseName: scope.courseName, materialId: 'b&2', page: 8, sourceHash: 'abc' }), 'https://tongkk.test').searchParams;
    expect(query.get('course')).toBe(scope.courseName);
    expect(query.get('material')).toBe('b&2');
    expect(query.get('page')).toBe('8');
    expect(query.get('hash')).toBe('abc');
    for (const value of [null, '', '0', '-1', '1.5', '1e3', '1000001', 'NaN']) expect(parseSourcePage(value)).toBeNull();
    expect(parseSourcePage('25')).toBe(25);
  });
  it('resolves a named file but asks for a choice for unnamed combined citations', () => {
    expect(resolveCitationTarget('(출처: 2강.pdf, ', 3, scope)).toMatchObject({ materialId: 'b&2', page: 3 });
    expect(resolveCitationTarget('(출처: ', 3, scope)).toEqual({ courseName: scope.courseName, page: 3, candidates: ['a:1', 'b&2'] });
  });
  it('never remaps a deleted source to the only surviving material', () => {
    const missing = { ...scope, materials: [materials[0]] };
    expect(resolveCitationTarget('2강.pdf, ', 7, missing)?.materialId).toBeUndefined();
    expect(resolveCitationTarget('', 7, missing)?.materialId).toBeUndefined();
    expect(resolveCitationTarget('', 7, { ...missing, materialIds: ['a:1'] })?.materialId).toBe('a:1');
  });
  it('does not match a filename suffix or reuse a previous file for a later unknown citation', () => {
    expect(resolveCitationTarget('(출처: 11강.pdf, ', 3, scope)?.materialId).toBeUndefined();
    expect(resolveCitationTarget('1강.pdf, p.2, 사라진.pdf, ', 3, scope)?.materialId).toBeUndefined();
    expect(resolveCitationTarget('(출처: 1강.pdf, p.2) 다음 설명 (출처: ', 3, scope)?.materialId).toBeUndefined();
    expect(resolveCitationTarget('1강.pdf, p.2, 2강.pdf, ', 3, scope)?.materialId).toBe('b&2');
  });
  it('does not rewrite code, math, or existing links, and links a range to its first page', () => {
    const tree = { type: 'root', children: [
      { type: 'paragraph', children: [{ type: 'text', value: '2강.pdf, p.8~p.9' }] },
      { type: 'inlineCode', value: 'p.12' },
      { type: 'inlineMath', value: 'p.13' },
      { type: 'link', url: 'https://example.test', children: [{ type: 'text', value: 'p.2' }] },
    ] };
    remarkSourceCitations(scope)(tree);
    const serialized = JSON.stringify(tree);
    expect(serialized).toContain('page=8');
    expect(serialized).not.toContain('page=9');
    expect(serialized).not.toContain('page=12');
    expect(serialized).not.toContain('page=13');
    expect(tree.children[3].url).toBe('https://example.test');
    expect(tree.children[3].children).toEqual([{ type: 'text', value: 'p.2' }]);
  });
  it('finds the correct extracted page without treating missing markers as page one', () => {
    const markdown = '<!-- p.1 -->\n첫 페이지\n<!-- p.2 -->\n둘째\n<!-- Slide number: 3 -->\n셋째';
    expect(sourcePageExcerpt(markdown, 2)).toBe('둘째');
    expect(sourcePageExcerpt(markdown, 3)).toBe('셋째');
    expect(sourcePageExcerpt(markdown, 4)).toBeNull();
    expect(sourcePageExcerpt('마커 없는 문서', 1)).toBeNull();
  });
});
