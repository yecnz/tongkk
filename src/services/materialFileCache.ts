// 원본 파일(서명 URL로 받는 PDF/PPT/DOCX/이미지)을 브라우저 Cache Storage에 filePath 기준으로
// 보관해, 새로고침·재방문 때 같은 파일을 다시 내려받지 않도록(Supabase Storage Egress 절감) 한다.
//
// 왜 filePath를 키로 쓰나: 서명 URL(createSignedUrl)은 호출마다 토큰이 바뀌어 URL이 매번 달라진다.
// 그래서 브라우저 HTTP 캐시는 새로고침(=새 토큰)마다 캐시 미스가 나 파일 전체를 재다운로드했다.
// filePath는 같은 파일이면 항상 동일하므로, 이를 캐시 키로 삼으면 토큰이 바뀌어도 캐시가 적중한다.
//
// 재업로드(upsert)·삭제 시에는 바이트가 달라지므로 반드시 evictMaterialFile로 비운다(materials.ts).

const CACHE_PREFIX = 'tongkk-material-files-';
let cacheOwner: string | null | undefined;
let generation = 0;
let cleanup: Promise<void> = Promise.resolve();
const cacheName = (owner: string) => `${CACHE_PREFIX}v2:${owner}`;

// Auth changes invalidate pending reads immediately. Cleanup is serialized so a
// delayed logout cannot delete a newly signed-in user's freshly cached files.
export function syncMaterialFileCacheUser(owner: string | null): Promise<void> {
  if (cacheOwner === owner) return cleanup;
  cacheOwner = owner;
  generation++;
  cleanup = cleanup.then(async () => {
    if (!cacheSupported()) return;
    const keep = owner ? cacheName(owner) : null;
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== keep)
      .map(name => caches.delete(name)));
  }).catch(() => { /* Cache Storage may be unavailable. */ });
  return cleanup;
}

function assertCurrentOwner(started: number, cacheKey?: string | null): void {
  if (started !== generation || cacheKey && (!cacheOwner || !cacheKey.startsWith(`${cacheOwner}/`))) {
    throw new DOMException('The material session has changed.', 'AbortError');
  }
}

// Cache Storage 키로만 쓰는 합성 URL(절대 네트워크로 나가지 않는다). 파일 경로만 식별한다.
const cacheKeyUrl = (cacheKey: string) => `https://material-cache.tongkk.local/${encodeURIComponent(cacheKey)}`;

// Cache Storage는 보안 컨텍스트(https·localhost)에서만 쓸 수 있고, 프라이빗 모드 등에서 없을 수 있다.
const cacheSupported = () => typeof caches !== 'undefined';

// 서명 URL로 원본을 받되, cacheKey(=filePath)가 있으면 Cache Storage를 먼저 본다.
// 캐시에 있으면 네트워크(Egress) 없이 그 사본을 돌려준다. 없으면 한 번만 받아 캐시에 저장한다.
// blob: URL(이미 로컬인 변환 미리보기 등)이나 캐시 미지원 환경에서는 일반 fetch로 동작한다.
export async function fetchMaterialFile(
  url: string,
  options: { cacheKey?: string | null; signal?: AbortSignal } = {},
): Promise<Blob> {
  const { cacheKey, signal } = options;
  const started = generation;
  assertCurrentOwner(started, cacheKey);
  await cleanup;
  assertCurrentOwner(started, cacheKey);
  const canCache = Boolean(cacheKey) && !url.startsWith('blob:') && cacheSupported();

  let cache: Cache | undefined;
  let key: string | undefined;
  if (canCache) {
    try {
      cache = await caches.open(cacheName(cacheOwner!));
      key = cacheKeyUrl(cacheKey as string);
      const hit = await cache.match(key);
      if (hit) {
        const blob = await hit.blob();
        assertCurrentOwner(started, cacheKey);
        return blob;
      }
    } catch {
      // Cache Storage 접근 실패(프라이빗 모드·정책 등)는 치명적이지 않다 → 캐시 없이 그냥 받는다.
      cache = undefined;
    }
  }

  assertCurrentOwner(started, cacheKey);
  // Only the account-scoped Cache Storage copy may persist; the browser's
  // independent HTTP cache cannot be cleared when this app signs out.
  const response = await fetch(url, { cache: 'no-store', ...(signal ? { signal } : {}) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  assertCurrentOwner(started, cacheKey);

  if (cache && key) {
    // 저장은 베스트에포트: 용량 초과 등으로 실패해도 본문 반환에는 지장이 없다(다음에 다시 받을 뿐).
    try {
      await cache.put(key, response.clone());
    } catch {
      /* 무시 */
    }
  }

  const blob = await response.blob();
  assertCurrentOwner(started, cacheKey);
  return blob;
}

// 재업로드·삭제로 내용이 바뀐 파일의 캐시 사본을 비운다(stale 방지).
export async function evictMaterialFile(cacheKey?: string | null): Promise<void> {
  if (!cacheKey || !cacheOwner || !cacheKey.startsWith(`${cacheOwner}/`) || !cacheSupported()) return;
  const owner = cacheOwner;
  try {
    await cleanup;
    if (cacheOwner !== owner) return;
    const cache = await caches.open(cacheName(owner));
    await cache.delete(cacheKeyUrl(cacheKey));
  } catch {
    /* 무시 */
  }
}
