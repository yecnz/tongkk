// @vitest-environment jsdom
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CourseMaterial } from '../../services/materials';
import type { CitationScope } from './sourceNavigation';
const mocks = vi.hoisted(() => ({ load: vi.fn(), sign: vi.fn(), fetchFile: vi.fn(), summaries: vi.fn(),
  user: { id: 'user' }, noop: () => {}, digest: vi.fn() }));
vi.mock('../../AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../TutorialContext', () => ({ useTutorial: () => ({ ready: mocks.noop, maybeShow: mocks.noop, open: mocks.noop }) }));
vi.mock('../../SampleDemoContext', () => ({ useSampleDemo: () => ({ openSampleDemo: mocks.noop }) }));
vi.mock('../../ToastContext', () => ({ useToast: () => ({ showToast: mocks.noop }) }));
vi.mock('../../AuthGateContext', () => ({ useAuthGate: () => ({ requireAuth: () => true, openLogin: mocks.noop }) }));
vi.mock('../../services/materials', async original => ({ ...await original<object>(), loadCourseMaterialsFromServer: mocks.load, createCourseMaterialFileUrl: mocks.sign, invalidateMaterialsCache: vi.fn(), invalidateSignedUrlCache: vi.fn() }));
vi.mock('../../services/summaries', async original => ({ ...await original<object>(), loadSummariesFromServer: mocks.summaries }));
vi.mock('../../services/quizSets', async original => ({ ...await original<object>(), loadQuizSetsFromServer: async () => [] }));
vi.mock('../../services/quizAttempts', async original => ({ ...await original<object>(), loadQuizAttemptsFromServer: async () => [] }));
vi.mock('../../services/materialFileCache', () => ({ fetchMaterialFile: mocks.fetchFile }));
vi.mock('../../services/documentPreview', () => ({ createPdfPreviewFromUrl: vi.fn() }));
vi.mock('../../services/dashboardState', () => ({ saveResumePoint: vi.fn() }));
vi.mock('../../services/pdfWorker', () => ({ initPdfWorker: vi.fn() }));
vi.mock('pdfjs-dist', () => ({
  getDocument: ({ data }: { data: ArrayBuffer }) => ({ promise: Promise.resolve({ numPages: new Uint8Array(data)[0] === 2 ? 12 : 10,
    getPage: async () => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), getTextContent: async () => ({ items: [] }) }) }), destroy: vi.fn() }),
  setLayerDimensions: vi.fn(), TextLayer: class { render() { return Promise.resolve(); } cancel() {} },
}));
import SourcePage from './SourcePage';
import Summary from '../../pages/Summary';
import { SourceCitationContext } from './citationContext';
import { FormattedAiText } from '../../pages/summary/SummaryContent';
import { FormattedTutorText } from '../../components/AITutorDrawer';
import QuizText from '../../pages/quiz/QuizText';
import { SourceLink } from './SourceLink';
const materials: CourseMaterial[] = [
  { id: 'a', name: '1강.pdf', updatedAt: 10, filePath: 'private/a.pdf', type: 'pdf', pages: 10, slides: null, size: 500, markdown: '<!-- p.1 -->첫째<!-- p.3 -->첫 자료의 세 번째 페이지' },
  { id: 'b', name: '2강.pdf', updatedAt: 20, filePath: 'private/b.pdf', type: 'pdf', pages: 12, slides: null, size: 600, markdown: '<!-- p.1 -->첫 페이지만 있는 머리말<!-- p.8 -->둘째 자료의 여덟 번째 페이지' },
];
const scope: CitationScope = { courseName: '자료 구조', materials, materialIds: ['a', 'b'] };
let root: Root;
let container: HTMLDivElement;
function Location() { const value = useLocation(); return h('output', { 'data-location': true }, value.pathname + value.search); }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('crypto', { subtle: { digest: mocks.digest } });
  mocks.digest.mockReset().mockResolvedValue(Uint8Array.from([10, 11]).buffer);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = (Number(this.dataset.pdfPage || '1') - 1) * 1000 + 16;
    return { top, left: 0, width: 800, height: 1000, right: 800, bottom: top + 1000, x: 0, y: top, toJSON: () => ({}) };
  });
  mocks.load.mockReset().mockResolvedValue(materials);
  mocks.summaries.mockReset().mockResolvedValue([]);
  mocks.sign.mockReset().mockImplementation(async (material: CourseMaterial) => `https://storage.test/${material.id}.pdf?token=private`);
  mocks.fetchFile.mockReset().mockImplementation(async (url: string) => ({ arrayBuffer: async () => Uint8Array.from([url.includes('/b.pdf') ? 2 : 1]).buffer }));
  sessionStorage.clear(); localStorage.clear();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(url = '/answer', output: ReactElement = h('p', null, '답변'), citationScope = scope) {
  await act(async () => root.render(h(MemoryRouter, { key: url, initialEntries: [url] }, h(Location),
    h(Routes, null, h(Route, { path: '/answer', element: h(SourceCitationContext.Provider, { value: citationScope }, output) }),
      h(Route, { path: '/source', element: h(SourcePage) }), h(Route, { path: '/summary', element: h(Summary) })))));
}
async function clickLink(text: string) {
  const link = [...container.querySelectorAll('a')].find(item => item.textContent?.includes(text));
  expect(link, `link ${text}`).toBeDefined();
  await act(async () => link!.click());
}
// jsdom does not create browsing contexts. Capture the real click's href and load it in a fresh router,
// matching the browser's target=_blank behavior while leaving route transitions inside that tab real.
async function openCitation() {
  const link = container.querySelector<HTMLAnchorElement>('a.source-citation');
  expect(link).not.toBeNull(); expect(link!.target).toBe('_blank');
  expect(link!.rel).toContain('noopener');
  let opened = '';
  link!.addEventListener('click', event => { event.preventDefault(); opened = link!.getAttribute('href')!; }, { once: true });
  await act(async () => link!.click());
  expect(opened).not.toContain('token=');
  await render(opened);
}
function expectPdf(material: CourseMaterial, page: number) {
  expect(container.querySelector('h1')?.textContent).toBe(material.name);
  expect(mocks.sign).toHaveBeenLastCalledWith(material);
  expect(document.activeElement?.getAttribute('data-pdf-page')).toBe(String(page));
  expect(container.querySelector('.source-viewer > div')?.scrollTop).toBeGreaterThan((page - 2) * 1000);
}

it('opens a rendered summary citation at the named PDF page and returns to that real material screen', async () => {
  await render('/answer', h(FormattedAiText, { content: '## 핵심 개념\n설명입니다. (출처: 2강.pdf, p.8)', template: 'GENERAL' }));
  await openCitation(); expectPdf(materials[1], 8);
  await clickLink('자료 화면으로');
  expect(container.querySelector('[data-location]')?.textContent).toContain('/summary?');
  expect(container.querySelector('[data-location]')?.textContent).toContain('material=b');
  expect(container.textContent).toContain('2강.pdf');
  expect(container.querySelector('.source-page')).toBeNull();
});
it('opens a bold tutor citation without losing the filename across markdown nodes', async () => {
  await render('/answer', h(FormattedTutorText, { content: '근거로 본 자료: **2강.pdf**, **p.8**' }));
  await openCitation(); expectPdf(materials[1], 8);
});
it('opens a rendered quiz explanation range at its first source page', async () => {
  await render('/answer', h(QuizText, { sources: true }, '해설: 이 조건을 확인하세요. (출처: 1강.pdf, p.3–p.5)'));
  await openCitation(); expectPdf(materials[0], 3);
});
it('requires a choice for two unnamed sources and follows the second choice to its exact page', async () => {
  await render('/answer', h(FormattedTutorText, { content: '근거로 본 자료: p.8' }));
  await openCitation();
  expect(container.querySelectorAll('.source-choice a')).toHaveLength(2);
  expect(mocks.sign).not.toHaveBeenCalled();
  await clickLink('2강.pdf'); expectPdf(materials[1], 8);
});
it('rechecks material existence when a source choice has been deleted since the choice screen loaded', async () => {
  await render('/answer', h(FormattedTutorText, { content: '근거로 본 자료: p.8' }));
  await openCitation(); mocks.load.mockResolvedValue([materials[0]]);
  await clickLink('2강.pdf');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('삭제되었거나');
  expect(mocks.sign).not.toHaveBeenCalled();
});
it('shows changed-source and actual PDF range notices after opening an old saved citation', async () => {
  await render('/answer', h(SourceLink, { courseName: scope.courseName, materialId: 'b', page: 99, updatedAt: 1 }, '원문'));
  await openCitation();
  expect(container.textContent).toContain('자료가 변경되었어요');
  expect(mocks.fetchFile).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ cacheKey: 'private/b.pdf::source-version:20' }));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('1–12');
  expectPdf(materials[1], 1);
});
it('uses the actual PDF page count even when saved page metadata is stale', async () => {
  const outdated = { ...materials[1], pages: 5 };
  mocks.load.mockResolvedValue([materials[0], outdated]);
  await render('/answer', h(SourceLink, { courseName: scope.courseName, materialId: 'b', page: 8 }, '원문'));
  await openCitation(); expectPdf(outdated, 8);
  expect(container.textContent).not.toContain('범위를 벗어나');
});
it('opens only the cited extracted page when the original file is unavailable', async () => {
  mocks.load.mockResolvedValue([{ ...materials[1], filePath: null }]);
  await render('/answer', h(SourceLink, { courseName: scope.courseName, materialId: 'b', page: 8 }, '원문'));
  await openCitation();
  expect(container.querySelector('[aria-label="변환된 원문"]')?.textContent).toContain('둘째 자료의 여덟 번째 페이지');
  expect(container.querySelector('[aria-label="변환된 원문"]')?.textContent).not.toContain('첫 페이지만 있는 머리말');
  expect(mocks.sign).not.toHaveBeenCalled();
});
it('shows the full converted text with a clear notice when page markers are absent', async () => {
  mocks.load.mockResolvedValue([{ ...materials[1], filePath: null, markdown: '페이지 표시가 없는 전체 변환 본문' }]);
  await render('/answer', h(SourceLink, { courseName: scope.courseName, materialId: 'b', page: 8 }, '원문'));
  await openCitation();
  expect(container.textContent).toContain('페이지 위치를 확인할 수 없어 전체 변환 원문');
  expect(container.textContent).toContain('페이지 표시가 없는 전체 변환 본문');
});
it('checks saved source hashes instead of silently treating a changed transcript as the original', async () => {
  await render('/answer', h(SourceLink, { courseName: scope.courseName, materialId: 'b', page: 8, sourceHash: 'old-hash' }, '원문'));
  await openCitation(); expect(mocks.digest).toHaveBeenCalled();
  expect(container.textContent).toContain('자료가 변경되었어요');
});

it('preserves deleted source IDs when reopening a saved combined summary instead of linking every bare page to the surviving file', async () => {
  mocks.load.mockResolvedValue([materials[0]]);
  mocks.summaries.mockResolvedValue([{ id: 'saved', template: 'GENERAL', content: '## 핵심\n설명입니다. (출처: p.8)', materialIds: ['a', 'b'], createdAt: 1 }]);
  sessionStorage.setItem('tongkk:summaryViewDetail', JSON.stringify({ summaryId: 'saved', template: 'GENERAL', materialIds: ['a', 'b'] }));
  await render('/summary?course=자료+구조&view=summary');
  const link = container.querySelector<HTMLAnchorElement>('a.source-citation');
  expect(link).not.toBeNull();
  const url = new URL(link!.href);
  expect(url.searchParams.get('material')).toBeNull();
  expect(url.searchParams.getAll('candidate')).toEqual(['a', 'b']);
});
