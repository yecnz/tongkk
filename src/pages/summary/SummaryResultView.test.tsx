// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('html2canvas', () => ({ default: vi.fn() }));
vi.mock('jspdf', () => ({ jsPDF: vi.fn() }));
vi.mock('../../components/AITutorDrawer', () => ({ AITutorDrawer: () => null }));
vi.mock('../../components/MindmapView', () => ({ MindmapView: () => null }));
import { SummaryResultView } from './SummaryResultView';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('offers a retry for an empty completed summary without showing sample content or export actions', async () => {
  const retry = vi.fn();
  await act(async () => root.render(h(SummaryResultView, {
    template: 'GENERAL', onBack: vi.fn(), backLabel: '돌아가기', contextTitle: '수학',
    realContent: '  ', isLoading: false, error: '', loadingStep: '', elapsedTime: null,
    threadId: 'thread', summaryId: null, onRetry: retry,
  })));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('생성된 요약 내용이 없습니다');
  expect(container.textContent).not.toContain('동적 프로그래밍');
  expect(container.textContent).not.toContain('PDF 다운로드');
  expect(container.textContent).not.toContain('전체 복사');
  expect(container.querySelector('.pdf-print-area')).toBeNull();
  const retryButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '같은 설정으로 다시 시도')!;
  await act(async () => retryButton.click());
  expect(retry).toHaveBeenCalledOnce();
});
