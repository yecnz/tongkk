import { GlobalWorkerOptions } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";

// pdfjs worker는 전역 싱글톤이라 한 번만 지정하면 된다. 페이지 수 계산(pdfPageCount)과
// 원본 뷰어(PdfViewer) 등 여러 진입점에서 안전하게 호출할 수 있도록 멱등 함수로 감싼다.
export function initPdfWorker(): void {
  if (!GlobalWorkerOptions.workerSrc) {
    GlobalWorkerOptions.workerSrc = workerSrc;
  }
}
