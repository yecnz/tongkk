// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ load: vi.fn(), sign: vi.fn(), invalidate: vi.fn(), user: { id: 'user' } }));
vi.mock('../../AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../services/materials', () => ({ loadCourseMaterialsFromServer: mocks.load, createCourseMaterialFileUrl: mocks.sign, invalidateMaterialsCache: mocks.invalidate }));
vi.mock('../../services/documentPreview', () => ({ createPdfPreviewFromUrl: vi.fn() }));
vi.mock('../../components/PdfViewer', () => ({ PdfViewer: (props: { initialPage: number }) => h('div', { 'data-pdf-page': props.initialPage }, 'PDF') }));
import SourcePage from './SourcePage';
import { SourceCitationContext } from './citationContext';
import { FormattedAiText } from '../../pages/summary/SummaryContent';
import { FormattedTutorText } from '../../components/AITutorDrawer';
const materials = [
  { id: 'a', name: '1강.pdf', updatedAt: 10, filePath: 'private/a.pdf', type: 'pdf', pages: 10, markdown: '<!-- p.1 -->첫째' },
  { id: 'b', name: '2강.pdf', updatedAt: 20, filePath: 'private/b.pdf', type: 'pdf', pages: 12, markdown: '<!-- p.1 -->다른 문서' },
];
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.load.mockReset().mockResolvedValue(materials);
  mocks.sign.mockReset().mockResolvedValue('https://storage.test/private?token=secret');
  mocks.invalidate.mockReset();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(url: string) { await act(async () => root.render(h(MemoryRouter, { initialEntries: [url] }, h(SourcePage)))); }

it('resolves the selected material and passes its cited page to the PDF viewer', async () => {
  await render('/source?course=과목&material=b&page=8');
  expect(mocks.sign).toHaveBeenCalledWith(materials[1]);
  expect(container.querySelector('[data-pdf-page="8"]')).not.toBeNull();
  expect(container.querySelector('a')?.href).not.toContain('token=');
  expect(mocks.invalidate).toHaveBeenCalledWith('과목');
});
it('asks which source to open without signing or opening the first PDF', async () => {
  await render('/source?course=과목&page=3&candidate=a&candidate=b');
  expect(container.querySelector('[aria-label="원문 자료 선택"]')?.textContent).toContain('1강.pdf');
  expect(container.querySelector('[aria-label="원문 자료 선택"]')?.textContent).toContain('2강.pdf');
  expect(mocks.sign).not.toHaveBeenCalled();
});
it('reports deleted materials and invalid pages without falling back to another PDF', async () => {
  await render('/source?course=과목&material=deleted&page=8');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('삭제되었거나');
  expect(mocks.sign).not.toHaveBeenCalled();
});
it('announces a changed file and an out-of-range citation', async () => {
  await render('/source?course=과목&material=a&page=99&version=5');
  expect(container.textContent).toContain('자료가 변경되었어요');
  expect(container.textContent).toContain('범위를 벗어나');
  expect(container.querySelector('[data-pdf-page="1"]')).not.toBeNull();
});
it('shows only the matching extracted page when no original file was saved', async () => {
  mocks.load.mockResolvedValue([{ ...materials[0], filePath: null, markdown: '<!-- p.1 -->첫째 원문<!-- p.2 -->둘째 원문' }]);
  await render('/source?course=과목&material=a&page=2');
  expect(container.textContent).toContain('둘째 원문');
  expect(container.textContent).not.toContain('첫째 원문');
  expect(mocks.sign).not.toHaveBeenCalled();
});
it('keeps source links in both summary and tutor source-note renderers', async () => {
  await act(async () => root.render(h(SourceCitationContext.Provider, { value: { courseName: '과목', materials, materialIds: ['a', 'b'] } },
    h(FormattedAiText, { content: '근거로 본 자료: 2강.pdf, p.8' }),
    h(FormattedTutorText, { content: '근거로 본 자료: 1강.pdf, p.3' }))));
  const links = [...container.querySelectorAll('a')];
  expect(links).toHaveLength(2);
  expect(new URL(links[0].href).searchParams.get('material')).toBe('b');
  expect(new URL(links[1].href).searchParams.get('material')).toBe('a');
  expect(links.every(link => link.target === '_blank')).toBe(true);
});
