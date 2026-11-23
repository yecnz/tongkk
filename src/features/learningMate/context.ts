import { createContext, useContext, useEffect, useRef } from 'react';
export type LearningScope = { courseId?: string; courseName?: string; materialId: string; title: string };
export const LearningScopeContext = createContext<{ scope: LearningScope | null; register: (owner: symbol, scope: LearningScope | null) => void }>({ scope: null, register: () => {} });
export function useLearningScope(scope: LearningScope | null) {
  const { register } = useContext(LearningScopeContext);
  const owner = useRef(Symbol('scope'));
  const courseId = scope?.courseId, courseName = scope?.courseName, materialId = scope?.materialId, title = scope?.title;
  useEffect(() => {
    const id = owner.current;
    register(id, materialId && title ? { courseId, courseName, materialId, title } : null);
    return () => register(id, null);
  }, [register, courseId, courseName, materialId, title]);
}
