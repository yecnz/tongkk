import type { ComponentProps } from 'react';
import './Sources.css';
export function SourceCitationAnchor({ href, children, title }: ComponentProps<'a'>) {
  const source = href?.startsWith('/source?');
  return <a href={href} title={title} {...(source ? { target: '_blank', rel: 'noopener noreferrer', className: 'source-citation' } : {})}>{children}</a>;
}
