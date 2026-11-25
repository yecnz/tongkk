import { useState } from 'react';
import AudioCapture from './AudioCapture';

type Props = { disabled: boolean; availableCharacters: number; onInsert: (text: string) => void; onBusyChange: (busy: boolean) => void };
export default function VoiceAnswer({ disabled, availableCharacters, onInsert, onBusyChange }: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const tooLong = text.trim().length > availableCharacters;
  return <div className="audio-answer">
    <button type="button" className="learning-text-button" aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)}>말로 설명하기 {open ? '닫기' : '열기'}</button>
    {open && <>
      <AudioCapture disabled={disabled} onBusyChange={onBusyChange} onTranscript={result => setText(result.text)} />
      {text && <div className="audio-transcript">
        <label>음성으로 말한 설명 · 제출 전에 수정하세요
          <textarea aria-label="음성 전사문 수정" value={text} disabled={disabled} onChange={event => setText(event.target.value)} />
        </label>
        {tooLong && <p role="alert">기존 답변과 합쳐 4,000자까지 입력할 수 있어요. 전사문을 줄여주세요.</p>}
        <button type="button" disabled={disabled || tooLong || !text.trim()} onClick={() => { onInsert(text.trim()); setText(''); }}>수정한 전사문을 답변에 넣기</button>
        <p className="learning-caption">답변 입력란에서 다시 확인한 뒤 ‘설명 제출’을 눌러야 평가해요.</p>
      </div>}
    </>}
  </div>;
}
