// 과목별 서버 조회 결과를 잠깐 메모리에 보관해 같은 데이터의 반복 다운로드(Egress)를 줄이는 TTL 캐시.
// 키는 `${course}::${variant}` 형태로 쓴다(variant = 본문 포함 여부 등). invalidate(course)는
// 해당 과목의 모든 variant를, invalidate()는 전체를 비운다. 데이터를 바꾸는 곳에서 반드시 무효화한다.
//
// staleTtlMs > 0이면 stale-while-revalidate: 만료 후에도 staleTtlMs 동안 항목을 유지해
// getStale()이 만료 데이터를 돌려주고, 호출부는 revalidate()로 백그라운드 갱신을 건다.
// invalidate()는 stale까지 즉시 삭제한다 — syncCourseMaterials처럼 "무효화 직후 읽기는
// 반드시 서버 최신"을 전제로 diff·삭제하는 경로가 있어 이 invariant가 정합성의 핵심이다.

// SWR을 쓰는 목록/개수 캐시가 공유하는 stale 유지 시간(30분).
export const SWR_STALE_TTL_MS = 30 * 60_000;

export function createTtlCache<T>(ttlMs: number, staleTtlMs = 0) {
  const store = new Map<string, { data: T; expiry: number }>();
  const inflight = new Set<string>();

  const read = (key: string, allowStale: boolean): T | undefined => {
    const hit = store.get(key);
    if (!hit) return undefined;
    const now = Date.now();
    if (now >= hit.expiry + staleTtlMs) {
      store.delete(key);
      return undefined;
    }
    if (now >= hit.expiry && !allowStale) return undefined;
    return hit.data;
  };

  return {
    get(key: string): T | undefined {
      return read(key, false);
    },
    // 만료됐지만 staleTtlMs 이내인 데이터도 반환한다(fresh면 get과 동일).
    getStale(key: string): T | undefined {
      return read(key, true);
    },
    set(key: string, data: T): void {
      store.set(key, { data, expiry: Date.now() + ttlMs });
    },
    invalidate(course?: string): void {
      if (course === undefined) {
        store.clear();
        return;
      }
      const prefix = `${course}::`;
      for (const key of store.keys()) {
        if (key === course || key.startsWith(prefix)) store.delete(key);
      }
    },
    // stale 반환 후 백그라운드 갱신. 같은 키 갱신이 이미 진행 중이면 무시한다.
    // 캐시 set은 fetcher가 직접 한다(기존 load 함수들이 성공 경로에서만 set하는 관례 유지).
    // 실패는 경고만 남기고 삼킨다(백그라운드라 unhandled rejection 금지).
    revalidate(key: string, fetcher: () => Promise<T>): void {
      if (inflight.has(key)) return;
      inflight.add(key);
      fetcher()
        .catch(error => console.warn('cache revalidate failed', error))
        .finally(() => inflight.delete(key));
    },
  };
}

// createTtlCache 항목들이 공유하는 SWR 읽기 패턴. fetcher는 성공 경로에서 직접 cache.set을 한다.
type SwrCache<T> = {
  get(key: string): T | undefined;
  getStale(key: string): T | undefined;
  revalidate(key: string, fetcher: () => Promise<T>): void;
};

// 목록/개수 조회의 공통 SWR 흐름을 한 곳에 모은다:
//   fresh가 있으면 그대로, 없고 stale 윈도우 안이면 stale을 즉시 돌려주고 백그라운드 갱신,
//   둘 다 없으면 fetcher로 동기 조회. count 캐시는 0이 유효값이라 truthy가 아닌 !== undefined로 판정한다.
export async function readThroughCache<T>(
  cache: SwrCache<T>,
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const fresh = cache.get(key);
  if (fresh !== undefined) return fresh;

  const stale = cache.getStale(key);
  if (stale !== undefined) {
    cache.revalidate(key, fetcher);
    return stale;
  }

  return fetcher();
}
