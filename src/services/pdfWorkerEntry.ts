// pdfjs 워커 진입점: 워커 스코프에서 pdf.worker가 평가되기 전에 폴리필을 먼저 설치한다.
// (워커에서 fingerprint의 Uint8Array.prototype.toHex, XFA의 Uint8Array.fromBase64를 호출하므로
//  구버전 브라우저에서도 동작하도록 import 순서를 반드시 폴리필 → pdf.worker로 둔다.)
import "./uint8ArrayBase64Hex";
import "pdfjs-dist/build/pdf.worker.mjs";
