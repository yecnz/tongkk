import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTtlCache, readThroughCache } from './cache';

describe('createTtlCache — TTL/stale', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fresh 동안 get이 값을 돌려준다', () => {
    const cache = createTtlCache<number>(1000);
    cache.set('a', 5);
    expect(cache.get('a')).toBe(5);
  });

  it('ttl이 지나고 stale 윈도우가 없으면 get/getStale 모두 undefined', () => {
    const cache = createTtlCache<number>(1000);
    cache.set('a', 5);
    vi.advanceTimersByTime(1000);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.getStale('a')).toBeUndefined();
  });

  it('만료됐지만 stale 윈도우 안이면 getStale만 값을 준다', () => {
    const cache = createTtlCache<number>(1000, 5000);
    cache.set('a', 5);
    vi.advanceTimersByTime(1500); // expiry(1000) 경과, stale(6000) 이내
    expect(cache.get('a')).toBeUndefined();
    expect(cache.getStale('a')).toBe(5);
  });

  it('stale 윈도우까지 지나면 완전히 사라진다', () => {
    const cache = createTtlCache<number>(1000, 5000);
    cache.set('a', 5);
    vi.advanceTimersByTime(6000); // expiry(1000) + stale(5000)
    expect(cache.getStale('a')).toBeUndefined();
  });

  it("invalidate(course)는 'course'와 'course::*' 키만 비운다", () => {
    const cache = createTtlCache<number>(1000);
    cache.set('수학', 1);
    cache.set('수학::full', 2);
    cache.set('영어::full', 3);
    cache.invalidate('수학');
    expect(cache.get('수학')).toBeUndefined();
    expect(cache.get('수학::full')).toBeUndefined();
    expect(cache.get('영어::full')).toBe(3);
  });

  it('invalidate()는 전체를 비운다', () => {
    const cache = createTtlCache<number>(1000);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.invalidate();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });
});

describe('createTtlCache.revalidate', () => {
  it('같은 키 갱신이 진행 중이면 중복 실행하지 않는다', async () => {
    const cache = createTtlCache<number>(1000);
    let resolve!: (value: number) => void;
    const pending = new Promise<number>(r => {
      resolve = r;
    });
    const fetcher = vi.fn(() => pending);

    cache.revalidate('a', fetcher);
    cache.revalidate('a', fetcher); // inflight라 무시
    expect(fetcher).toHaveBeenCalledTimes(1);

    resolve(1);
    await pending;
    await new Promise(r => setTimeout(r, 0)); // .finally가 inflight를 비울 시간

    cache.revalidate('a', fetcher); // 끝났으니 다시 실행
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('readThroughCache', () => {
  it('fresh가 있으면 fetcher 없이 그 값을 반환', async () => {
    const cache = createTtlCache<number>(1000);
    cache.set('a', 7);
    const fetcher = vi.fn(async () => 99);
    expect(await readThroughCache(cache, 'a', fetcher)).toBe(7);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fresh/stale 둘 다 없으면 fetcher로 동기 조회', async () => {
    const cache = createTtlCache<number>(1000);
    const fetcher = vi.fn(async () => 42);
    expect(await readThroughCache(cache, 'missing', fetcher)).toBe(42);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('값이 0이어도 fresh로 취급한다(개수 캐시 정합성)', async () => {
    const cache = createTtlCache<number>(1000);
    cache.set('cnt', 0);
    const fetcher = vi.fn(async () => 5);
    expect(await readThroughCache(cache, 'cnt', fetcher)).toBe(0);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('stale만 있으면 stale을 반환하고 백그라운드로 revalidate', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const cache = createTtlCache<number>(1000, 5000);
      cache.set('a', 3);
      vi.advanceTimersByTime(1500); // stale 윈도우
      const fetcher = vi.fn(async () => 9);
      expect(await readThroughCache(cache, 'a', fetcher)).toBe(3);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
