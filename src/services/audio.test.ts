import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const upsert = vi.hoisted(() => vi.fn(async () => ({ error: null })));
const invalidate = vi.hoisted(() => vi.fn());
vi.mock('./backend', () => ({ BACKEND_URL: '/api', getAuthRequestHeaders: async () => ({ Authorization: 'Bearer test' }), parseApiError: async () => '전사 실패' }));
vi.mock('./courses', () => ({ fetchCourses: async () => [{ id: 'course', name: '과목' }] }));
vi.mock('./materials', () => ({ invalidateMaterialsCache: invalidate }));
vi.mock('./supabase', () => ({ requireSupabaseUser: async () => ({ id: 'user' }), formatSupabaseError: (e: Error) => e.message, supabase: { from: () => ({ upsert }) } }));
import { encodePcmWav, normalizeAudio, saveTranscriptMaterial, transcribeAudio, validateAudioFile } from './audio';
const close = vi.fn(async () => undefined);
let duration = 1;
beforeEach(() => {
  upsert.mockClear(); invalidate.mockClear(); close.mockClear(); duration = 1;
  vi.stubGlobal('AudioContext', class { close = close; decodeAudioData = async () => ({ duration }); });
  vi.stubGlobal('OfflineAudioContext', class { destination = {}; createBufferSource = () => ({ buffer: null, connect() {}, start() {} }); startRendering = async () => ({ getChannelData: () => new Float32Array(16000) }); });
});
afterEach(() => vi.unstubAllGlobals());

it('encodes mono PCM with the exact frame duration and clips samples', async () => {
  const data = new DataView(await encodePcmWav(new Float32Array([-2, 0, 2])).arrayBuffer());
  expect(data.getUint32(24, true)).toBe(16000);
  expect(data.getUint16(22, true)).toBe(1);
  expect(data.getUint32(40, true)).toBe(6);
  expect(data.getInt16(44, true)).toBe(-32768); expect(data.getInt16(48, true)).toBe(32767);
});
it('rejects unsupported or oversized files before decoding', () => {
  expect(() => validateAudioFile(new File(['x'], 'payload.exe'))).toThrow('MP3');
  expect(() => validateAudioFile({ name: 'a.mp3', size: 21 * 1024 * 1024 } as File)).toThrow('20MB');
});
it('enforces actual decoded duration and closes the AudioContext', async () => {
  duration = 601;
  await expect(normalizeAudio(new File(['x'], 'a.mp3'))).rejects.toThrow('10분');
  expect(close).toHaveBeenCalledOnce();
});
it('cancellation prevents a paid API request', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const controller = new AbortController(); controller.abort();
  await expect(transcribeAudio(new File(['x'], 'a.mp3'), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetch).not.toHaveBeenCalled();
});
it('uses authenticated multipart and does not automatically retry errors', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('error', { status: 502 })); vi.stubGlobal('fetch', fetch);
  await expect(transcribeAudio(new File(['x'], 'a.mp3'))).rejects.toThrow('전사 실패');
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][1]!.headers).toEqual({ Authorization: 'Bearer test' });
  expect(fetch.mock.calls[0][1]!.body).toBeInstanceOf(FormData);
});
it('saves exactly one text material with a stable id without syncing or deleting other materials', async () => {
  const result = await saveTranscriptMaterial('과목', ' 전사 ', ' 수정한 내용 ', 'stable-id');
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'stable-id', markdown: '수정한 내용', user_id: 'user', course_id: 'course', file_path: null }), { onConflict: 'course_id,id' });
  expect(result.mimeType).toBe('text/plain');
  expect(invalidate).toHaveBeenCalledWith('과목');
});
