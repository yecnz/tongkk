const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_LENGTH = 100_000;
const MAX_PDF_PAGES = 150;

class TeacherFileError extends Error {}

function validateText(text: string, isPdf = false): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new TeacherFileError(isPdf
      ? 'PDF에서 텍스트를 찾지 못했어요. 스캔한 자료는 텍스트를 복사할 수 있는 PDF나 TXT 파일로 올려 주세요.'
      : '파일에 읽을 수 있는 텍스트가 없어요. 내용을 확인해 주세요.');
  }
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new TeacherFileError('자료는 텍스트 100,000자까지 읽을 수 있어요. 강의 단위로 나누어 올려 주세요.');
  }
  return trimmed;
}

export async function readTeacherFile(file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!extension || !['pdf', 'txt', 'md'].includes(extension)) {
    throw new TeacherFileError('PDF, TXT, MD 파일을 올려 주세요.');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new TeacherFileError('파일은 15MB까지 올릴 수 있어요. 자료를 나누어 올려 주세요.');
  }

  try {
    if (extension !== 'pdf') return validateText(await file.text());

    const [{ getDocument }, { initPdfWorker }] = await Promise.all([
      import('pdfjs-dist'),
      import('../../services/pdfWorker'),
    ]);
    initPdfWorker();
    const data = new Uint8Array(await file.arrayBuffer());
    const loadingTask = getDocument({
      data,
      cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
    });
    try {
      const pdf = await loadingTask.promise;
      if (pdf.numPages > MAX_PDF_PAGES) {
        throw new TeacherFileError('PDF는 150페이지까지 읽을 수 있어요. 강의 단위로 나누어 올려 주세요.');
      }
      const pages: string[] = [];
      let length = 0;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        try {
          const content = await page.getTextContent();
          const text = content.items.map((item) => (
            'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : ''
          )).join('').trim();
          if (!text) continue;
          length += text.length + (pages.length ? 2 : 0);
          if (length > MAX_TEXT_LENGTH) {
            throw new TeacherFileError('자료는 텍스트 100,000자까지 읽을 수 있어요. 강의 단위로 나누어 올려 주세요.');
          }
          pages.push(text);
        } finally {
          page.cleanup();
        }
      }
      return validateText(pages.join('\n\n'), true);
    } finally {
      await loadingTask.destroy();
    }
  } catch (error) {
    if (error instanceof TeacherFileError) throw error;
    if (error instanceof Error && error.name === 'PasswordException') {
      throw new TeacherFileError('암호가 설정된 PDF는 읽을 수 없어요. 암호를 해제한 파일을 올려 주세요.');
    }
    throw new TeacherFileError('자료를 읽지 못했어요. 파일이 정상적으로 열리는지 확인하고 다시 올려 주세요.');
  }
}

export function downloadTeacherText(name: string, text: string): void {
  const type = name.toLowerCase().endsWith('.md') ? 'text/markdown' : 'text/plain';
  const url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: `${type};charset=utf-8` }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
