import { useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { AITutorDrawer } from '../../components/AITutorDrawer';
import { workflowRequest } from '../../services/workflow';
import { fetchCourses } from '../../services/courses';
import { LearningScopeContext } from './context';
import type { MateScope } from '../../services/agent';
export default function LearningMateHost() {
  const { user } = useAuth(); const { scope } = useContext(LearningScopeContext); const location = useLocation();
  const [open, setOpen] = useState(false); const [context, setContext] = useState<(MateScope & { title: string }) | null>(null);
  const [error, setError] = useState(''); const [retry, setRetry] = useState(0); const button = useRef<HTMLButtonElement>(null);
  const restricted = location.pathname.startsWith('/learn') || location.pathname === '/quiz';
  useEffect(() => {
    setContext(null); setError('');
    if (!user || !open || !scope || restricted) return;
    let active = true;
    async function load() {
      const courseId = scope!.courseId || (await fetchCourses()).find(c => c.name === scope!.courseName)?.id;
      if (!courseId) throw new Error('과목을 다시 선택하세요.');
      const value = await workflowRequest<MateScope & { title: string }>(`/learning-mate/context?${new URLSearchParams({ course_id: courseId, material_id: scope!.materialId })}`);
      if (active) setContext(value);
    }
    void load().catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [user, open, scope, restricted, retry]);
  if (!user || restricted) return null;
  function close() { setOpen(false); button.current?.focus(); }
  return <>
    <button ref={button} type="button" className="learning-mate-launch" aria-expanded={open} aria-controls="learning-mate-panel" onClick={() => setOpen(v => !v)}>학습 메이트</button>
    {open && <section id="learning-mate-panel" className="learning-mate-panel" aria-label="학습 메이트">
      <header><div><strong>학습 메이트</strong><p>{scope ? `연결 자료: ${scope.title}` : '질문할 자료를 여세요.'}</p></div><button type="button" className="workflow-button" onClick={close} aria-label="학습 메이트 닫기">닫기</button></header>
      {error ? <p role="alert">{error} <button type="button" onClick={() => setRetry(n => n + 1)}>다시 연결</button></p>
        : !scope ? <p>자료나 학습 이슈를 열고 질문하세요.</p>
          : !context ? <p role="status">자료를 확인하는 중…</p>
            : <div className="learning-mate-chat"><AITutorDrawer key={`${context.courseId}:${context.materialId}:${context.sourceHash}`} scope={context} contextTitle={context.title}
              materialId={context.materialId} contextMarkdown="현재 자료를 바탕으로 답변합니다." layout="embedded" fill open
              onOpenChange={nextOpen => { if (!nextOpen) close(); }} /></div>}
    </section>}
  </>;
}
