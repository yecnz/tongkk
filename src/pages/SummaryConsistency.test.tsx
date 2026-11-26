// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'learner' }, toast: vi.fn(), ready: vi.fn(), maybeShow: vi.fn(), resolve: vi.fn(),
  materials: [
    { id: 'one', name: '첫 강의.pdf', type: 'pdf', updatedAt: 1, markdown: '<!-- p.1 -->첫 자료', pages: 1 },
    { id: 'two', name: '둘째 강의.pdf', type: 'pdf', updatedAt: 2, markdown: '<!-- p.1 -->둘째 자료', pages: 1 },
  ],
}));
vi.mock('../AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../ToastContext', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock('../TutorialContext', () => ({ useTutorial: () => ({ ready: mocks.ready, maybeShow: mocks.maybeShow, open: vi.fn() }) }));
vi.mock('../SampleDemoContext', () => ({ useSampleDemo: () => ({ openSampleDemo: vi.fn() }) }));
vi.mock('../components/TutorialHelpButton', () => ({ TutorialHelpButton: () => null }));
vi.mock('../features/preparation/PreparationPanel', () => ({ PreparationOptions: () => null }));
vi.mock('../services/preparation', () => ({ prepareUploadedMaterials: vi.fn() }));
vi.mock('../services/materials', () => ({
  loadCourseMaterialsFromServer: async () => mocks.materials,
  combineMaterialsMarkdown: (materials: typeof mocks.materials) => materials.map(material => material.markdown).join('\n'),
  deleteCourseMaterialFromServer: vi.fn(), getFileMaterialId: vi.fn(), saveCourseMaterials: vi.fn(),
  uploadCourseMaterialFile: vi.fn(), MAX_ORIGINAL_FILE_BYTES: 50 * 1024 * 1024,
}));
vi.mock('../services/summaries', () => ({ loadSummariesFromServer: async () => [], saveSummaryToServer: vi.fn() }));
vi.mock('../services/summaryGeneration', () => ({ resolveSummaryRequest: mocks.resolve }));
vi.mock('../services/dashboardState', () => ({ saveResumePoint: vi.fn() }));
vi.mock('../services/pdfToMarkdown', () => ({ extractMarkdownFromPDF: vi.fn() }));
vi.mock('../services/pdfPageCount', () => ({ getPdfPageCount: vi.fn() }));
vi.mock('./summary/MaterialDetailView', () => ({ MaterialDetailView: () => null }));
vi.mock('./summary/SummaryResultView', () => ({ SummaryResultView: () => null }));
import Summary from './Summary';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear(); sessionStorage.clear(); mocks.resolve.mockReset();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render() {
  await act(async () => root.render(h(MemoryRouter, { initialEntries: [{ pathname: '/summary', state: { selectedCourse: '수학' } }] }, h(Summary))));
}
function button(text: string) { return Array.from(container.querySelectorAll('button')).find(element => element.textContent === text)!; }

it('exposes each material as a labeled checkbox with an independent checked state', async () => {
  await render();
  const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input.tongkk-checkbox'));
  expect(inputs).toHaveLength(2);
  expect(inputs[0].labels?.[0].textContent).toContain('첫 강의.pdf');
  expect(inputs.map(input => input.checked)).toEqual([false, true]);
  await act(async () => inputs[0].click());
  expect(inputs.map(input => input.checked)).toEqual([true, true]);
  await act(async () => inputs[1].click());
  expect(inputs.map(input => input.checked)).toEqual([true, false]);
});

it('labels pasted text fields and exposes the selected input mode', async () => {
  await render();
  await act(async () => button('텍스트 붙여넣기').click());
  expect(button('텍스트 붙여넣기').getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector<HTMLInputElement>('#text-material-title')!.labels?.[0].textContent).toBe('자료 이름');
  expect(container.querySelector<HTMLTextAreaElement>('#text-material-content')!.labels?.[0].textContent).toBe('자료 내용');
});

it('opens the shared dialog for an existing summary and restores focus when cancelled', async () => {
  mocks.resolve.mockResolvedValue({ identity: {}, existing: { id: 'summary', template: 'GENERAL', content: '기존 요약', createdAt: 1, materialIds: ['two'] } });
  await render();
  const template = Array.from(container.querySelectorAll('button')).find(element => element.textContent?.includes('내용을 깔끔하게 정리'))!;
  await act(async () => template.click());
  const generate = button('요약 생성하기');
  generate.focus();
  await act(async () => generate.click());
  const dialog = container.querySelector('dialog')!;
  expect(dialog.open).toBe(true);
  expect(dialog.getAttribute('aria-labelledby')).toBe('existing-summary-heading');
  await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })));
  expect(container.querySelector('dialog')).toBeNull();
  expect(document.activeElement).toBe(generate);
});
