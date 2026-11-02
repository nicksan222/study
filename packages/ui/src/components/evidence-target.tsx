import type { ReactNode } from 'react';

export function EvidenceExcerpt({
  kind,
  children,
  'aria-label': label
}: {
  kind: 'preview' | 'retained';
  children: ReactNode;
  'aria-label'?: string;
}) {
  const style = {
    whiteSpace: 'pre-wrap' as const,
    maxHeight: kind === 'preview' ? '12rem' : '24rem',
    overflow: 'auto'
  };

  return kind === 'preview' ? (
    <blockquote aria-label={label} style={style}>
      {children}
    </blockquote>
  ) : (
    <p aria-label={label} style={style}>
      {children}
    </p>
  );
}
