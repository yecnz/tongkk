import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { loadDashboardState, saveDashboardState } from '../services/dashboardState';
import type { Dday, Plan } from '../services/studyPlanner';
import type { PacePlan } from '../services/pace';

type CalendarData = { ddays: Dday[]; plans: Plan[]; pacePlans: PacePlan[] };
type CalendarKey = keyof CalendarData;
type PendingChange = { key: CalendarKey; value: CalendarData[CalendarKey] };
const emptyData = (): CalendarData => ({ ddays: [], plans: [], pacePlans: [] });

/** Load before editing, and keep a failed change available for an explicit retry. */
export function useCalendarState(userId: string | undefined) {
  const [data, setData] = useState<CalendarData>(emptyData);
  const [owner, setOwner] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const dataRef = useRef(data);
  const generation = useRef(0);
  const writable = useRef(false);
  const pending = useRef<PendingChange | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    writable.current = false;
    pending.current = null;
    inFlight.current = false;
    dataRef.current = emptyData();
    setData(dataRef.current);
    setOwner(userId);
    setLoaded(false);
    setSaving(false);
    setLoadError('');
    setSaveError('');
    setLoading(Boolean(userId));
    if (!userId) return;
    Promise.all([
      loadDashboardState<Dday[]>('ddays', []),
      loadDashboardState<Plan[]>('plans', []),
      loadDashboardState<PacePlan[]>('pacePlans', []),
    ]).then(([ddays, plans, pacePlans]) => {
      if (current !== generation.current) return;
      dataRef.current = { ddays: ddays.map(item => ({ ...item, type: item.type || 'assignment' })), plans, pacePlans };
      setData(dataRef.current);
      writable.current = true;
      setLoaded(true);
    }).catch(() => {
      if (current === generation.current) setLoadError('학습 캘린더를 불러오지 못했어요. 다시 불러온 뒤 일정을 편집해 주세요.');
    }).finally(() => {
      if (current === generation.current) setLoading(false);
    });
    return () => { generation.current = current + 1; writable.current = false; };
  }, [userId, loadAttempt]);

  const persist = async (change: PendingChange) => {
    if (inFlight.current) return;
    const current = generation.current;
    inFlight.current = true;
    setSaving(true);
    setSaveError('');
    try {
      await saveDashboardState(change.key, change.value);
      if (current !== generation.current) return;
      pending.current = null;
      writable.current = true;
    } catch {
      if (current === generation.current) setSaveError('변경 사항을 저장하지 못했어요. 입력한 내용은 이 화면에 남아 있어요. 다시 저장해 주세요.');
    } finally {
      if (current === generation.current) { inFlight.current = false; setSaving(false); }
    }
  };

  const update = <K extends CalendarKey>(key: K, action: SetStateAction<CalendarData[K]>) => {
    if (!userId || owner !== userId || !writable.current || inFlight.current) return;
    const value = typeof action === 'function' ? action(dataRef.current[key]) : action;
    const change = { key, value };
    dataRef.current = { ...dataRef.current, [key]: value };
    writable.current = false;
    pending.current = change;
    setData(dataRef.current);
    void persist(change);
  };

  return {
    ...(owner === userId ? data : emptyData()),
    loaded: owner === userId && loaded,
    loading: Boolean(userId) && (owner !== userId || loading),
    saving, loadError, saveError,
    canEdit: Boolean(userId) && owner === userId && loaded && !saving && !saveError,
    setDdays: (action: SetStateAction<Dday[]>) => update('ddays', action),
    setPlans: (action: SetStateAction<Plan[]>) => update('plans', action),
    setPacePlans: (action: SetStateAction<PacePlan[]>) => update('pacePlans', action),
    retryLoad: () => setLoadAttempt(attempt => attempt + 1),
    retrySave: () => { if (pending.current && !inFlight.current) void persist(pending.current); },
  };
}
