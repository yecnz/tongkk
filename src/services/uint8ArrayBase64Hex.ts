// 구버전 브라우저(특히 Chrome 140 미만)에는 TC39 "Uint8Array ↔ base64/hex" 메서드가 없다.
// pdfjs 5.6이 이를 직접 호출(워커 fingerprint의 toHex, XFA·서명의 base64)하므로, 없으면 PDF 로드가
// "hashOriginal.toHex is not a function" 등으로 전부 실패한다.
// 네이티브가 있으면(최신 브라우저) 절대 덮어쓰지 않는다 → 동작 변화 0. 워커·메인 양쪽에서 import한다.

type Base64Options = { alphabet?: "base64" | "base64url"; omitPadding?: boolean };

function bytesToBase64(bytes: Uint8Array, options?: Base64Options): string {
  let binary = "";
  const CHUNK = 0x8000; // fromCharCode 인자 한도를 피하려 청크 단위로 이어 붙인다(큰 폰트/이미지 대비).
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  let result = btoa(binary); // btoa/atob는 window·Worker 양쪽 전역에 있다.
  if (options?.alphabet === "base64url") result = result.replace(/\+/g, "-").replace(/\//g, "_");
  if (options?.omitPadding) result = result.replace(/=+$/, "");
  return result;
}

function base64ToBytes(input: string, options?: Base64Options): Uint8Array {
  let text = input.replace(/\s/g, "");
  if (options?.alphabet === "base64url") text = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// toHex 등은 ES2022 lib에 없어 직접 프로퍼티 접근 시 타입 에러가 나므로 인덱스 접근으로 가드한다.
function ensure(target: object, name: string, value: unknown): void {
  if (typeof (target as Record<string, unknown>)[name] !== "function") {
    Object.defineProperty(target, name, { value, writable: true, configurable: true });
  }
}

ensure(Uint8Array.prototype, "toHex", function toHex(this: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < this.length; i += 1) hex += this[i].toString(16).padStart(2, "0");
  return hex;
});

ensure(Uint8Array.prototype, "toBase64", function toBase64(this: Uint8Array, options?: Base64Options): string {
  return bytesToBase64(this, options);
});

ensure(Uint8Array, "fromBase64", function fromBase64(input: string, options?: Base64Options): Uint8Array {
  return base64ToBytes(input, options);
});
