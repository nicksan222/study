import type { ComponentProps, ReactNode } from 'react';

import './field.css';

/** An implicitly associated control label with consistent spacing; callers own values and validation. */
export function Field({
  label,
  children,
  ...props
}: Omit<ComponentProps<'label'>, 'className'> & { label: ReactNode }) {
  return (
    <label {...props} className="ui-field">
      <span className="ui-field-label">{label}</span>
      {children}
    </label>
  );
}
