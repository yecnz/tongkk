import { useCallback, useEffect, useRef, useState } from 'react';
import { LearningApiError, learningRequest, shouldAcceptSession, type LearningSession } from '../../services/learningSessions';

export function useLearningSession(id: string | undefined, userId: string | undefined) {
  const [session, setSession] = useState<LearningSession | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const current = useRef<LearningSession | null>(null);
  const pending = useRef<{ path: string; body: Record<string, unknown> } | null>(null);
  const [pendingRetry, setPendingRetry] = useState(false);
  const mounted = useRef(true);

  const accept = useCallback((value: LearningSession) => {
    const previous = current.current;
    if (!shouldAcceptSession(previous, value)) return;
    current.current = value;
    if (mounted.current) setSession(value);
  }, []);

  const refresh = useCallback(async () => {
    if (!id || !userId) return;
    try {
      accept(await learningRequest<LearningSession>(`/${id}`));
      if (mounted.current) setError('');
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '학습을 불러오지 못했습니다.'); }
  }, [id, userId, accept]);

  useEffect(() => {
    mounted.current = true;
    current.current = null;
    pending.current = null;
    setPendingRetry(false);
    setSession(null);
    void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  const polling = Boolean(session && (session.status === 'preparing' || session.current?.phase === 'recall_evaluating')
    && session.operation?.status !== 'expired');
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => { void refresh(); }, 1500);
    return () => window.clearInterval(timer);
  }, [polling, refresh]);

  const send = useCallback(async (request: { path: string; body: Record<string, unknown> }) => {
    setBusy(true);
    setError('');
    pending.current = request;
    try {
      const value = await learningRequest<LearningSession>(request.path, 'POST', request.body);
      accept(value);
      pending.current = null;
      setPendingRetry(false);
      return value;
    } catch (e) {
      // Retain the exact command on ambiguous failures, including its old revision/key.
      const ambiguous = !(e instanceof LearningApiError) || e.status >= 500;
      if (!ambiguous) pending.current = null;
      setPendingRetry(ambiguous);
      setError(e instanceof Error ? e.message : '요청 결과를 확인하지 못했습니다.');
      if (e instanceof LearningApiError && e.status === 409) {
        try { accept(await learningRequest<LearningSession>(`/${id}`)); } catch { /* Keep the local answer. */ }
      }
      throw e;
    } finally { if (mounted.current) setBusy(false); }
  }, [accept, id]);

  const command = useCallback((suffix: string, body: Record<string, unknown> = {}) => {
    if (!id || !current.current) return Promise.reject(new Error('학습을 먼저 불러와주세요.'));
    if (pending.current) return Promise.reject(new Error('이전 요청 결과를 먼저 확인해주세요.'));
    return send({ path: `/${id}/${suffix}`, body: {
      ...body, expected_revision: current.current.revision, idempotency_key: crypto.randomUUID(),
    } });
  }, [id, send]);

  const retryPending = useCallback(async () => {
    if (pending.current) return send(pending.current);
  }, [send]);

  return { session, error, busy, pendingRetry, command, retryPending, refresh, accept };
}
