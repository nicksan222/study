import type { ComponentProps } from 'react';

/** Announces durable operation state without moving focus or treating it as an error. */
export function StatusMessage(props: Omit<ComponentProps<'p'>, 'role' | 'className'>) {
  return <p aria-live="polite" aria-atomic="true" {...props} role="status" />;
}
