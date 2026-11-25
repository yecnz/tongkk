// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const transcribe = vi.hoisted(() => vi.fn());
vi.mock('../../services/audio', () => ({
  AUDIO_ACCEPT: '.webm', AUDIO_MAX_BYTES: 20 * 1024 * 1024, AUDIO_MAX_SECONDS: 600,
  formatAudioTime: (value: number) => String(value), validateAudioFile: () => undefined, transcribeAudio: transcribe,
}));
vi.mock('../../services/learningSessions', () => ({
  readLocalDraft: () => null, writeLocalDraft: () => true, removeLocalDraft: () => undefined, learningRequest: vi.fn(),
}));
import AudioCapture from './AudioCapture';
import RecallInput from '../learningSession/RecallInput';
let root: Root, container: HTMLDivElement;
const trackStop = vi.fn();
const getUserMedia = vi.fn();
class Recorder {
  static instances: Recorder[] = [];
  constructor() { Recorder.instances.push(this); }
  static isTypeSupported = () => true;
  state = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.(); }
}
const transcript = vi.fn(), busy = vi.fn();
async function click(text: string) { await act(async () => [...container.querySelectorAll('button')].find(value => value.textContent?.startsWith(text))!.click()); }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] });
  trackStop.mockClear(); transcript.mockClear(); busy.mockClear(); transcribe.mockReset().mockResolvedValue({ text: '음성 설명', duration_seconds: 2 });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(h(AudioCapture, { onTranscript: transcript, onBusyChange: busy })));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it('releases the microphone when recording ends and transcribes only on explicit action', async () => {
  await click('마이크로 녹음'); expect(container.textContent).toContain('녹음 중');
  await click('녹음 마치기'); expect(trackStop).toHaveBeenCalled(); expect(transcribe).not.toHaveBeenCalled();
  await click('전사하기'); expect(transcript).toHaveBeenCalledWith({ text: '음성 설명', duration_seconds: 2 }, '녹음.webm');
});
it('reports denied microphone permission with a file fallback', async () => {
  getUserMedia.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
  await click('마이크로 녹음'); expect(container.textContent).toContain('마이크 권한이 꺼져');
  expect(container.querySelector('input[type=file]')).not.toBeNull();
});
it('ignores a late transcript after cancel and allows retry', async () => {
  let resolve!: (value: unknown) => void;
  transcribe.mockImplementation(() => new Promise(value => { resolve = value; }));
  await click('마이크로 녹음'); await click('녹음 마치기'); await click('전사하기');
  await click('취소');
  await act(async () => resolve({ text: 'late', duration_seconds: 1 }));
  expect(transcript).not.toHaveBeenCalled(); expect(busy).toHaveBeenLastCalledWith(false);
});
it('stops a microphone that grants permission after the user cancels', async () => {
  let resolve!: (value: unknown) => void;
  getUserMedia.mockImplementation(() => new Promise(value => { resolve = value; }));
  await click('마이크로 녹음'); await click('취소');
  await act(async () => resolve({ getTracks: () => [{ stop: trackStop }] }));
  expect(trackStop).toHaveBeenCalled(); expect(container.textContent).not.toContain('녹음 중');
});
it('unmount cleans up tracks and the busy indicator', async () => {
  await click('마이크로 녹음');
  await act(async () => root.unmount());
  expect(trackStop).toHaveBeenCalled(); expect(busy).toHaveBeenLastCalledWith(false);
  root = createRoot(container);
});

it('voice work stays active in RecallInput and only edited text is submitted explicitly', async () => {
  const submit = vi.fn(async () => undefined);
  await act(async () => root.render(h(RecallInput, {
    session: { id: 's', current: { id: 'i', draft: '기존 설명', revision: 1 } } as unknown as import('../../services/learningSessions').LearningSession,
    userId: 'u', busy: false, disabled: false, onSave: vi.fn(), onSubmit: submit, flushRef: { current: null },
  })));
  await click('말로 설명하기 열기');
  await click('마이크로 녹음');
  expect(container.textContent).toContain('녹음 중');
  expect([...container.querySelectorAll('button')].find(value => value.textContent === '설명 제출')!.disabled).toBe(true);
  await click('녹음 마치기'); await click('전사하기');
  const editor = container.querySelector('[aria-label="음성 전사문 수정"]') as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editor, '고친 설명');
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('수정한 전사문을 답변에 넣기');
  expect((container.querySelector('#recall-answer') as HTMLTextAreaElement).value).toBe('기존 설명\n\n고친 설명');
  expect(submit).not.toHaveBeenCalled();
  await click('설명 제출');
  expect(submit).toHaveBeenCalledWith('기존 설명\n\n고친 설명');
});

it('ignores late recorder stop callbacks from a cancelled recording', async () => {
  await click('마이크로 녹음');
  const staleStop = Recorder.instances.at(-1)!.onstop!;
  await click('취소'); await click('마이크로 녹음');
  const stopsBefore = trackStop.mock.calls.length;
  await act(async () => staleStop());
  expect(trackStop).toHaveBeenCalledTimes(stopsBefore);
  expect(container.textContent).toContain('녹음 중');
});

it('ignores an old permission failure after a new microphone session starts', async () => {
  let reject!: (value: unknown) => void;
  getUserMedia.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  await click('마이크로 녹음'); await click('취소'); await click('마이크로 녹음');
  await act(async () => reject(new DOMException('late rejection', 'NotAllowedError')));
  expect(trackStop).not.toHaveBeenCalled();
  expect(container.textContent).toContain('녹음 중');
  expect(container.textContent).not.toContain('마이크 권한이 꺼져');
});
