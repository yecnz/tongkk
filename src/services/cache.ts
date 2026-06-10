// 과목별 서버 조회 결과를 잠깐 메모리에 보관해 같은 데이터의 반복 다운로드(Egress)를 줄이는 TTL 캐시.
// 키는 `${course}::${variant}` 형태로 쓴다(variant = 본문 포함 여부 등). invalidate(course)는
// 해당 과목의 모든 variant를, invalidate()는 전체를 비운다. 데이터를 바꾸는 곳에서 반드시 무효화한다.
export function createTtlCache<T>(ttlMs: number) {
  const store = new Map<string, { data: T; expiry: number }>();

  return {
    get(key: string): T | undefined {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (Date.now() >= hit.expiry) {
        store.delete(key);
        return undefined;
      }
      return hit.data;
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
  };
}
