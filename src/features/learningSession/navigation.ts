import { createContext, useContext, type RefObject } from 'react';

type LearningNavigation = {
  beforeLeaveRef: RefObject<(() => Promise<void>) | null>;
  go: (to: string) => Promise<void>;
};
export const LearningNavigationContext = createContext<LearningNavigation | null>(null);
export function useLearningNavigation() {
  const value = useContext(LearningNavigationContext);
  if (!value) throw new Error('학습 화면 안에서 이동해주세요.');
  return value;
}
