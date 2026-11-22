import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { learningRequest, readLocalDraft, removeLocalDraft, writeLocalDraft, type LearningSession } from '../../services/learningSessions';

type Props = { session: LearningSession; userId: string; busy: boolean; disabled: boolean;
  onSave: (view: LearningSession) => void; onSubmit: (text: string) => Promise<unknown>;
  flushRef: RefObject<(() => Promise<void>) | null> };

export default function RecallInput({ session, userId, busy, disabled, onSave, onSubmit, flushRef }: Props) {
  const item = session.current!;
  const initial = useRef(readLocalDraft(userId, session.id, item.id));
  const [text, setText] = useState(initial.current?.text ?? item.draft);
  const [conflict, setConflict] = useState(Boolean(initial.current && initial.current.text !== item.draft && initial.current.revision !== item.revision));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [composing, setComposing] = useState(false);
  const latest = useRef(text);
  const revision = useRef(item.revision);
  const serverText = useRef(item.draft);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    // An external edit must not silently overwrite local work or be overwritten by it.
    if (item.revision > revision.current) {
      if (latest.current !== serverText.current && latest.current !== item.draft) setConflict(true);
      else { latest.current = item.draft; setText(item.draft); }
      revision.current = item.revision;
      serverText.current = item.draft;
    }
  }, [item.revision, item.draft]);

  const save = useCallback(() => {
    queue.current = queue.current.catch(() => undefined).then(async () => {
        if (!alive.current || latest.current === serverText.current) return;
        const submitted = latest.current;
        setSaving(true);
        try {
          const value = await learningRequest<LearningSession>(`/${session.id}/draft`, 'PATCH', {
            item_id: item.id, expected_item_revision: revision.current, text: submitted,
          });
          revision.current = value.current!.revision;
          serverText.current = submitted;
          if (alive.current) {
            writeLocalDraft(userId, session.id, item.id, { text: latest.current, revision: revision.current });
            onSave(value); setSaveError('');
          }
        } catch (e) {
          if (alive.current) setSaveError(e instanceof Error ? e.message : '서버 저장에 실패했습니다.');
          throw e;
        } finally { if (alive.current) setSaving(false); }
    });
    return queue.current;
  }, [session.id, item.id, userId, onSave]);

  useEffect(() => {
    flushRef.current = async () => {
      if (conflict || composing) throw new Error('답변 충돌 또는 입력을 먼저 마무리해주세요.');
      await save();
    };
    return () => { flushRef.current = null; };
  }, [flushRef, save, conflict, composing]);

  useEffect(() => {
    if (composing || conflict || disabled || text === serverText.current) return;
    const timer = window.setTimeout(() => { void save().catch(() => undefined); }, 800);
    return () => window.clearTimeout(timer);
  }, [text, composing, conflict, disabled, save]);

  function edit(value: string) {
    latest.current = value;
    setText(value);
    if (!writeLocalDraft(userId, session.id, item.id, { text: value, revision: revision.current })) {
      setSaveError('이 기기에 임시 저장할 수 없습니다. 화면을 떠나기 전에 서버 저장을 확인해주세요.');
    }
  }

  async function submit() {
    await queue.current.catch(() => undefined);
    try {
      await onSubmit(latest.current);
      removeLocalDraft(userId, session.id, item.id);
    } catch { /* Parent shows the request error; keep the local draft. */ }
  }

  return <>
    {conflict && <div className="learning-notice" role="alert">
      <strong>이 기기의 초안과 서버 답변이 다릅니다.</strong>
      <p>서버 답변: {item.draft || '(비어 있음)'}</p>
      <div className="learning-row">
        <button type="button" onClick={() => { edit(item.draft); setConflict(false); }}>서버 답변 사용</button>
        <button type="button" onClick={() => { setConflict(false); edit(latest.current); }}>현재 초안 사용</button>
      </div>
    </div>}
    <label htmlFor="recall-answer"><p>자료를 보지 않고 핵심을 설명해주세요.</p></label>
    <textarea id="recall-answer" value={text} maxLength={4000} disabled={busy || disabled}
      onChange={event => edit(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} />
    <p className="learning-muted" aria-live="polite" style={{ fontSize: 13 }}>
      {text.length.toLocaleString()} / 4,000자 · {saveError || (saving ? '저장 중…' : text === item.draft ? '저장됨' : '임시 저장됨')}
    </p>
    <button type="button" className="primary" disabled={busy || disabled || composing || conflict || !text.trim()} onClick={() => { void submit(); }}>설명 제출</button>
  </>;
}
