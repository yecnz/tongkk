import { useCallback, useRef, useState, type ReactNode } from 'react';
import { LearningScopeContext, type LearningScope } from './context';
export default function LearningContextProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<LearningScope | null>(null);
  const currentOwner = useRef<symbol | null>(null);
  const register = useCallback((owner: symbol, value: LearningScope | null) => {
    if (value) { currentOwner.current = owner; setScope(value); }
    else if (currentOwner.current === owner) { currentOwner.current = null; setScope(null); }
  }, []);
  return <LearningScopeContext.Provider value={{ scope, register }}>{children}</LearningScopeContext.Provider>;
}
