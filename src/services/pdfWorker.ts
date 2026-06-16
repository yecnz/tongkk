import { GlobalWorkerOptions } from "pdfjs-dist";
import PdfWorker from "./pdfWorkerEntry?worker";

// pdfjs worker는 전역 싱글톤이라 한 번만 지정하면 된다. 페이지 수 계산(pdfPageCount)과
// 원본 뷰어(PdfViewer) 등 여러 진입점에서 안전하게 호출할 수 있도록 멱등 함수로 감싼다.
//
// URL(workerSrc) 대신 직접 만든 Worker(workerPort)를 쓰는 이유: 워커 번들 맨 앞에 폴리필을 끼워
// 넣어야(pdfWorkerEntry) 구버전 브라우저에서 toHex/fromBase64가 동작한다. 하나의 워커를 모든 문서가
// 공유한다 — pdfjs가 docId로 메시지를 구분하고 PDFWorker.create()가 같은 포트엔 캐시 인스턴스를
// 반환하므로 동시 사용(뷰어+페이지 수 계산)도 안전하다. 워커는 앱 수명 동안 유지(파기 금지).
export function initPdfWorker(): void {
  if (!GlobalWorkerOptions.workerPort) {
    GlobalWorkerOptions.workerPort = new PdfWorker();
  }
}
