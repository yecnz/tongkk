import { useCallback, useEffect, useRef, useState } from 'react';
import { AUDIO_MAX_BYTES, AUDIO_MAX_SECONDS } from '../../services/audio';

export function useAudioRecorder(onFile: (file: File) => void) {
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const generation = useRef(0);
  const onFileRef = useRef(onFile);
  useEffect(() => { onFileRef.current = onFile; }, [onFile]);

  const cleanup = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
  }, []);
  const cancel = useCallback(() => {
    generation.current++;
    if (recorder.current) {
      recorder.current.ondataavailable = null;
      recorder.current.onstop = null;
      recorder.current.onerror = null;
      if (recorder.current.state !== 'inactive') recorder.current.stop();
    }
    recorder.current = null; cleanup();
    setRecording(false); setRequesting(false);
  }, [cleanup]);
  useEffect(() => () => {
    generation.current++;
    if (recorder.current) {
      recorder.current.ondataavailable = null; recorder.current.onstop = null; recorder.current.onerror = null;
      if (recorder.current.state !== 'inactive') recorder.current.stop();
    }
    cleanup();
  }, [cleanup]);

  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
    cleanup(); setRecording(false);
  }, [cleanup]);

  async function start() {
    if (recording || requesting) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('이 브라우저에서는 마이크 녹음을 지원하지 않아요. 음성 파일을 올리거나 직접 입력해주세요.'); return;
    }
    const current = ++generation.current;
    setError(''); setRequesting(true); setElapsed(0);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (current !== generation.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media;
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']
        .find(value => MediaRecorder.isTypeSupported(value));
      if (!mime) throw new Error('이 브라우저에서는 지원하는 녹음 형식이 없어요. 음성 파일을 올려주세요.');
      const instance = new MediaRecorder(media, { mimeType: mime, audioBitsPerSecond: 64000 });
      recorder.current = instance;
      const chunks: Blob[] = [];
      let bytes = 0;
      instance.ondataavailable = event => {
        if (event.data.size && current === generation.current) {
          chunks.push(event.data); bytes += event.data.size;
          if (bytes > AUDIO_MAX_BYTES) stop();
        }
      };
      instance.onerror = () => { if (current === generation.current) { cancel(); setError('녹음이 중단됐어요. 마이크를 확인하고 다시 시도해주세요.'); } };
      instance.onstop = () => {
        if (current !== generation.current) return;
        cleanup();
        setRecording(false); recorder.current = null;
        const extension = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
        const file = new File(chunks, `녹음.${extension}`, { type: mime.split(';')[0] });
        if (file.size) onFileRef.current(file); else setError('녹음된 음성이 없어요. 다시 시도해주세요.');
      };
      const started = Date.now();
      instance.start(1000); setRecording(true); setRequesting(false);
      timer.current = setInterval(() => {
        if (current !== generation.current) return;
        const seconds = Math.floor((Date.now() - started) / 1000);
        setElapsed(Math.min(seconds, AUDIO_MAX_SECONDS));
        // Leave a small margin for MediaRecorder final-frame padding.
        if (seconds >= AUDIO_MAX_SECONDS - 1) stop();
      }, 250);
    } catch (reason) {
      if (current !== generation.current) return;
      cleanup();
      setRequesting(false); setRecording(false);
      setError(reason instanceof DOMException && reason.name === 'NotAllowedError'
        ? '마이크 권한이 꺼져 있어요. 브라우저 권한을 허용하거나 음성 파일을 올려주세요.'
        : reason instanceof Error ? reason.message : '마이크를 시작하지 못했어요.');
    }
  }
  return { recording, requesting, elapsed, error, start, stop, cancel };
}
