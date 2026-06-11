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

export type TtlCache<T> = ReturnType<typeof createTtlCache<T>>;

// fresh 캐시 → stale 반환 + 백그라운드 갱신(SWR) → 직접 조회 순의 공용 읽기 경로.
// 각 서비스의 load/count 함수가 같은 분기를 반복하지 않도록 모았다.
// fetcher는 기존 관례대로 성공 경로에서 cache.set을 직접 한다.
export async function readThroughCache<T>(
  cache: TtlCache<T>,
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const fresh = cache.get(key);
  if (fresh !== undefined) return fresh;

  // 만료됐지만 stale 윈도우 안이면 일단 보여주고 백그라운드로 갱신한다(SWR).
  const stale = cache.getStale(key);
  if (stale !== undefined) {
    cache.revalidate(key, fetcher);
    return stale;
  }

  return fetcher();
}
