import type { ComponentProps, ReactNode } from 'react';

import './field.css';

/** A label and control with consistent spacing; explicit association keeps toolbar actions outside the label. */
export function Field({
  label,
  children,
  ...props
}: Omit<ComponentProps<'label'>, 'className'> & { label: ReactNode }) {
  const text = <span className="ui-field-label">{label}</span>;

  if (props.htmlFor) {
    return (
      <div className="ui-field">
        <label {...props}>{text}</label>
        {children}
      </div>
    );
  }

  return (
    <label {...props} className="ui-field">
      {text}
      {children}
    </label>
  );
}
