import { useEffect, useRef, useState } from 'react';
import { AUDIO_ACCEPT, formatAudioTime, transcribeAudio, validateAudioFile, type Transcript } from '../../services/audio';
import { useAudioRecorder } from './useAudioRecorder';
import './AudioStudy.css';

type Props = { disabled?: boolean; onTranscript: (result: Transcript, name: string) => void; onBusyChange?: (busy: boolean) => void };
export default function AudioCapture({ disabled = false, onTranscript, onBusyChange }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const recorder = useAudioRecorder(value => { setFile(value); setError(''); });
  const cancelRecording = recorder.cancel;
  const active = processing || recorder.recording || recorder.requesting;

  useEffect(() => { onBusyChange?.(active); }, [active, onBusyChange]);
  useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => () => { sequence.current++; controller.current?.abort(); }, []);
  useEffect(() => {
    if (disabled) { sequence.current++; controller.current?.abort(); cancelRecording(); setProcessing(false); }
  }, [disabled, cancelRecording]);

  function cancel() {
    sequence.current++; controller.current?.abort(); recorder.cancel(); setProcessing(false); setError('');
  }
  async function transcribe() {
    if (!file || active || disabled) return;
    const request = ++sequence.current;
    const abort = new AbortController(); controller.current = abort;
    setProcessing(true); setError('');
    try {
      const result = await transcribeAudio(file, abort.signal);
      if (request === sequence.current && !abort.signal.aborted) onTranscript(result, file.name);
    } catch (reason) {
      if (request === sequence.current && !abort.signal.aborted) setError(reason instanceof Error ? reason.message : '전사하지 못했어요. 다시 시도해주세요.');
    } finally { if (request === sequence.current) setProcessing(false); }
  }

  return <div className="audio-capture">
    <p className="learning-caption">한 번에 10분·20MB까지. 녹음과 파일은 전사 처리에만 사용하며 원본 음성을 저장하지 않아요.</p>
    <div className="learning-row">
      {recorder.recording
        ? <button type="button" onClick={recorder.stop}>녹음 마치기 · {formatAudioTime(recorder.elapsed)}</button>
        : <button type="button" disabled={disabled || active} onClick={() => { void recorder.start(); }}>{recorder.requesting ? '마이크 연결 중…' : '마이크로 녹음'}</button>}
      <label className={`audio-file-button${disabled || active ? ' is-disabled' : ''}`}>
        음성 파일 선택
        <input type="file" aria-label="음성 파일 선택" accept={AUDIO_ACCEPT} disabled={disabled || active} onChange={event => {
          const next = event.target.files?.[0]; event.target.value = '';
          if (!next) return;
          try { validateAudioFile(next); setFile(next); setError(''); } catch (reason) { setError((reason as Error).message); }
        }} />
      </label>
      {active && <button type="button" onClick={cancel}>취소</button>}
    </div>
    {recorder.recording && <p role="status" className="audio-recording">● 녹음 중 · {formatAudioTime(recorder.elapsed)} / 10:00</p>}
    {file && !recorder.recording && <div className="audio-preview">
      <p>{file.name} · {(file.size / 1024 / 1024).toFixed(1)}MB</p>
      {preview && <audio controls src={preview} aria-label="전사할 음성 미리 듣기" />}
      <div className="learning-row">
        <button type="button" className="primary" disabled={disabled || active} onClick={() => { void transcribe(); }}>{processing ? '전사 중…' : error ? '전사 다시 시도' : '전사하기'}</button>
        <button type="button" disabled={disabled || active} onClick={() => { setFile(null); setError(''); }}>파일 지우기</button>
      </div>
    </div>}
    {processing && <p role="status">음성을 텍스트로 바꾸고 있어요. 완료 후 문장을 수정할 수 있어요.</p>}
    {(error || recorder.error) && <p className="learning-notice learning-error" role="alert">{error || recorder.error}</p>}
  </div>;
}
