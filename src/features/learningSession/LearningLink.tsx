import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useLearningNavigation } from './navigation';

export default function LearningLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  const { go } = useLearningNavigation();
  return <Link to={to} className={className} onClick={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); void go(to);
  }}>{children}</Link>;
}
