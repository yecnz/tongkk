import { BACKEND_URL, getAuthRequestHeaders, parseApiError } from './backend';
import { fetchCourses } from './courses';
import { invalidateMaterialsCache, type CourseMaterial } from './materials';
import { formatSupabaseError, requireSupabaseUser, supabase } from './supabase';

export const AUDIO_MAX_SECONDS = 600;
export const AUDIO_MAX_BYTES = 20 * 1024 * 1024;
export const AUDIO_ACCEPT = '.mp3,.m4a,.mp4,.wav,.webm,.ogg,.flac,audio/*';
export type Transcript = { text: string; duration_seconds: number };

export function validateAudioFile(file: File) {
  if (!file.size) throw new Error('비어 있는 음성 파일이에요.');
  if (file.size > AUDIO_MAX_BYTES) throw new Error('음성 파일은 20MB까지 지원해요. 파일을 나눠 올려주세요.');
  if (!/\.(mp3|m4a|mp4|wav|webm|ogg|flac)$/i.test(file.name)) {
    throw new Error('MP3, M4A, MP4, WAV, WebM, OGG, FLAC 음성을 선택해주세요.');
  }
}

function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

/** Canonical 16kHz mono PCM lets the server enforce duration without trusting metadata. */
export function encodePcmWav(samples: Float32Array, sampleRate = 16000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((letter, i) => view.setUint8(offset + i, letter.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  });
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function normalizeAudio(file: File, signal?: AbortSignal): Promise<Blob> {
  validateAudioFile(file); abortIfNeeded(signal);
  if (typeof AudioContext === 'undefined' || typeof OfflineAudioContext === 'undefined') {
    throw new Error('이 브라우저에서는 음성을 변환할 수 없어요. 최신 Chrome, Edge 또는 Safari를 이용해주세요.');
  }
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    abortIfNeeded(signal);
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > AUDIO_MAX_SECONDS) {
      throw new Error('음성은 한 번에 10분까지 지원해요. 긴 강의는 나눠 올려주세요.');
    }
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded; source.connect(offline.destination); source.start();
    const rendered = await offline.startRendering();
    abortIfNeeded(signal);
    return encodePcmWav(rendered.getChannelData(0));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'EncodingError') {
      throw new Error('이 브라우저에서 읽을 수 없는 음성이에요. MP3 또는 WAV 파일로 바꿔 올려주세요.');
    }
    throw error;
  } finally { await context.close().catch(() => undefined); }
}

export async function transcribeAudio(file: File, signal?: AbortSignal): Promise<Transcript> {
  const audio = await normalizeAudio(file, signal);
  abortIfNeeded(signal);
  const form = new FormData();
  form.append('file', audio, 'recording.wav');
  const headers = await getAuthRequestHeaders();
  abortIfNeeded(signal);
  // Do not retry paid provider calls automatically.
  const response = await fetch(`${BACKEND_URL}/audio/transcriptions`, { method: 'POST', headers, body: form, signal });
  if (!response.ok) throw new Error(await parseApiError(response));
  const result = await response.json() as Transcript;
  if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('음성을 찾지 못했어요. 다시 녹음하거나 직접 입력해주세요.');
  return result;
}

export async function saveTranscriptMaterial(course: string, title: string, text: string, id: string): Promise<CourseMaterial> {
  if (!title.trim() || !text.trim()) throw new Error('자료 이름과 전사문을 입력해주세요.');
  if (text.length > 100000) throw new Error('전사문은 100,000자까지 저장할 수 있어요.');
  const user = await requireSupabaseUser();
  const courseId = (await fetchCourses()).find(value => value.name === course)?.id;
  if (!courseId) throw new Error('저장할 과목을 선택해주세요.');
  const material: CourseMaterial = {
    id, name: title.trim(), type: 'file', size: null, pages: null, slides: null,
    markdown: text.trim(), filePath: null, mimeType: 'text/plain', updatedAt: Date.now(),
  };
  // Insert/upsert only this row; syncCourseMaterials deletes omitted materials.
  const { error } = await supabase.from('materials').upsert({
    id: material.id, user_id: user.id, course_id: courseId, name: material.name,
    type: 'file', size: null, pages: null, slides: null, markdown: material.markdown,
    file_path: null, mime_type: 'text/plain',
  }, { onConflict: 'course_id,id' });
  if (error) throw new Error(formatSupabaseError(error));
  invalidateMaterialsCache(course);
  return material;
}

export function formatAudioTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}
