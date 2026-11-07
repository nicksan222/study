import type { ComponentProps, ReactNode } from 'react';

import './disclosure.css';

/** Native keyboard and open-state behavior with one shared summary treatment. */
export function Disclosure({
  summary,
  variant,
  children,
  ...props
}: Omit<ComponentProps<'details'>, 'className'> & { summary: ReactNode; variant?: 'activity' }) {
  return (
    <details {...props} className="ui-disclosure" data-variant={variant}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
