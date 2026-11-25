import { createContext, useContext } from 'react';
import type { CitationScope } from './sourceNavigation';
export const SourceCitationContext = createContext<CitationScope>({ courseName: '', materials: [], materialIds: [] });
export const useSourceCitationScope = () => useContext(SourceCitationContext);
