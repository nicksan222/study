import type { ReactNode } from 'react';

/** Displays diagnostic text with preserved line breaks in a bounded, wrapping scroll area. */
export function DiagnosticText({ children }: { children: ReactNode }) {
  return (
    <pre
      className="rounded-lg border border-border bg-muted/30 p-4 font-mono text-xs leading-relaxed"
      style={{
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        maxHeight: '50vh',
        overflow: 'auto'
      }}
    >
      {children}
    </pre>
  );
}
