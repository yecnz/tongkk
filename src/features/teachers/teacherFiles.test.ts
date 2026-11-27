import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readTeacherFile } from './teacherFiles';

const { getDocument, initPdfWorker } = vi.hoisted(() => ({
  getDocument: vi.fn(),
  initPdfWorker: vi.fn(),
}));
vi.mock('pdfjs-dist', () => ({ getDocument }));
vi.mock('../../services/pdfWorker', () => ({ initPdfWorker }));

beforeEach(() => vi.clearAllMocks());

describe('teacher material files', () => {
  it('reads Korean text and Markdown while rejecting empty or excessive content', async () => {
    await expect(readTeacherFile(new File(['\uFEFF # 운영체제\n프로세스\n'], '강의.MD')))
      .resolves.toBe('# 운영체제\n프로세스');
    await expect(readTeacherFile(new File(['  \n'], '강의.txt'))).rejects.toThrow('텍스트가 없어요');
    await expect(readTeacherFile(new File(['가'.repeat(100_001)], '강의.txt'))).rejects.toThrow('100,000자');
    expect(getDocument).not.toHaveBeenCalled();
  });

  it('rejects unsupported and oversized files before reading them', async () => {
    await expect(readTeacherFile(new File(['x'], '강의.docx'))).rejects.toThrow('PDF, TXT, MD');
    const oversized = new File([], '강의.pdf');
    Object.defineProperty(oversized, 'size', { value: 15 * 1024 * 1024 + 1 });
    await expect(readTeacherFile(oversized)).rejects.toThrow('15MB');
    expect(getDocument).not.toHaveBeenCalled();
  });

  it('keeps PDF line and page boundaries and releases each page and loading task', async () => {
    const cleanup = vi.fn();
    const destroy = vi.fn().mockResolvedValue(undefined);
    getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: vi.fn().mockResolvedValue({
          getTextContent: vi.fn().mockResolvedValue({ items: [
            { str: '핵심 개념', hasEOL: true }, { str: '설명', hasEOL: false },
          ] }),
          cleanup,
        }),
      }),
      destroy,
    });
    await expect(readTeacherFile(new File(['pdf'], '강의.pdf')))
      .resolves.toBe('핵심 개념\n설명\n\n핵심 개념\n설명');
    expect(initPdfWorker).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('releases the task when PDF parsing fails', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    getDocument.mockReturnValue({
      promise: Promise.reject(Object.assign(new Error('encrypted'), { name: 'PasswordException' })),
      destroy,
    });
    await expect(readTeacherFile(new File(['pdf'], '강의.pdf'))).rejects.toThrow('암호를 해제');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('explains scanned PDFs and rejects more than 150 pages without extracting them', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const getPage = vi.fn().mockResolvedValue({
      getTextContent: vi.fn().mockResolvedValue({ items: [] }), cleanup: vi.fn(),
    });
    getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage }), destroy });
    await expect(readTeacherFile(new File(['pdf'], '스캔.pdf'))).rejects.toThrow('스캔한 자료');
    getPage.mockClear();
    getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 151, getPage }), destroy });
    await expect(readTeacherFile(new File(['pdf'], '강의.pdf'))).rejects.toThrow('150페이지');
    expect(getPage).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(2);
  });
});
