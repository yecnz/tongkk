import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let files: Map<string, Map<string, Response>>;
let api: typeof import('./materialFileCache');
let network: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  files = new Map();
  vi.stubGlobal('caches', {
    keys: async () => [...files.keys()],
    delete: async (name: string) => files.delete(name),
    open: async (name: string) => {
      if (!files.has(name)) files.set(name, new Map());
      const entries = files.get(name)!;
      return {
        match: async (key: string) => entries.get(key)?.clone(),
        put: async (key: string, response: Response) => { entries.set(key, response); },
        delete: async (key: string) => entries.delete(key),
      };
    },
  });
  network = vi.fn(async () => new Response('private document'));
  vi.stubGlobal('fetch', network);
  api = await import('./materialFileCache');
});
afterEach(() => vi.unstubAllGlobals());

describe('private material cache isolation', () => {
  it('reuses only the signed-in owner cache and removes it on logout', async () => {
    await api.syncMaterialFileCacheUser('alice');
    const options = { cacheKey: 'alice/course/file.pdf' };
    expect(await (await api.fetchMaterialFile('https://storage.test/file?token=one', options)).text()).toBe('private document');
    expect(await (await api.fetchMaterialFile('https://storage.test/file?token=two', options)).text()).toBe('private document');
    expect(network).toHaveBeenCalledTimes(1);
    expect(network).toHaveBeenCalledWith('https://storage.test/file?token=one', { cache: 'no-store' });
    await api.syncMaterialFileCacheUser(null);
    expect(files.size).toBe(0);
    await expect(api.fetchMaterialFile('https://storage.test/file?token=one', options)).rejects.toMatchObject({ name: 'AbortError' });
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('rejects another account path even with a still-valid signed URL', async () => {
    await api.syncMaterialFileCacheUser('bob');
    await expect(api.fetchMaterialFile('https://storage.test/private?token=secret', { cacheKey: 'alice/course/file' }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(network).not.toHaveBeenCalled();
  });

  it('purges legacy and other-user caches on startup while preserving this owner and unrelated caches', async () => {
    for (const name of ['tongkk-material-files-v1', 'tongkk-material-files-v2:alice', 'tongkk-material-files-v2:bob', 'other-app']) files.set(name, new Map());
    await api.syncMaterialFileCacheUser('bob');
    expect([...files.keys()]).toEqual(['tongkk-material-files-v2:bob', 'other-app']);
  });

  it('does not return or restore a response that finishes after an account switch', async () => {
    await api.syncMaterialFileCacheUser('alice');
    let finish!: (response: Response) => void;
    network.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const pending = api.fetchMaterialFile('https://storage.test/private', { cacheKey: 'alice/course/file' });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(1));
    await api.syncMaterialFileCacheUser('bob');
    finish(new Response('alice private bytes'));
    await rejected;
    expect(files.has('tongkk-material-files-v2:alice')).toBe(false);
  });

  it('continues fetching for the current owner if browser caching is disabled', async () => {
    vi.stubGlobal('caches', undefined);
    await api.syncMaterialFileCacheUser('alice');
    expect(await (await api.fetchMaterialFile('https://storage.test/private', { cacheKey: 'alice/course/file' })).text()).toBe('private document');
  });
});
