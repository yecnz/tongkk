import type { ReactNode } from 'react';
import { buildSourceUrl, parseSourcePage, type SourceTarget } from './sourceNavigation';
import './Sources.css';

export function SourceLink({ children, ...target }: SourceTarget & { children?: ReactNode }) {
  if (!target.courseName || !target.materialId || !parseSourcePage(target.page)) return null;
  return <a className="source-citation" href={buildSourceUrl(target)} target="_blank" rel="noopener noreferrer" title="원문 열기 (새 탭)">{children || `원문 p.${target.page}`}</a>;
}
