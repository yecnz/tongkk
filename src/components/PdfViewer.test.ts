// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ destroy: vi.fn(), getPage: vi.fn() }));
vi.mock('../services/pdfWorker', () => ({ initPdfWorker: vi.fn() }));
vi.mock('../services/materialFileCache', () => ({ fetchMaterialFile: async () => ({ arrayBuffer: async () => new ArrayBuffer(1) }) }));
vi.mock('pdfjs-dist', () => ({
  getDocument: () => ({ promise: Promise.resolve({ numPages: 3, getPage: mocks.getPage }), destroy: mocks.destroy }),
  setLayerDimensions: vi.fn(),
  TextLayer: class { render() { return Promise.resolve(); } cancel() {} },
}));
import { PdfViewer } from './PdfViewer';
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const page = Number(this.dataset.pdfPage || '1');
    return { top: (page - 1) * 1000 + 16, left: 0, width: 800, height: 1000, right: 800, bottom: 1000, x: 0, y: 0, toJSON: () => ({}) };
  });
  mocks.getPage.mockReset().mockImplementation(async () => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }), getTextContent: async () => ({ items: [] }) }));
  mocks.destroy.mockReset();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('waits for page layout, scrolls to and focuses the requested PDF page', async () => {
  await act(async () => root.render(h(PdfViewer, { url: 'https://file.test/a.pdf', initialPage: 3 })));
  expect(document.activeElement?.getAttribute('data-pdf-page')).toBe('3');
  expect((container.firstElementChild as HTMLElement).scrollTop).toBeGreaterThan(1900);
});
it('announces a citation beyond the actual PDF page count', async () => {
  await act(async () => root.render(h(PdfViewer, { url: 'https://file.test/a.pdf', initialPage: 99 })));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('1–3');
  expect(document.activeElement?.getAttribute('data-pdf-page')).toBe('1');
});
