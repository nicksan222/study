import type { ComponentProps, ReactNode } from 'react';

import './disclosure.css';

/** Native keyboard and open-state behavior with one shared summary treatment. */
export function Disclosure({
  summary,
  children,
  ...props
}: Omit<ComponentProps<'details'>, 'className'> & { summary: ReactNode }) {
  return (
    <details {...props} className="ui-disclosure">
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
