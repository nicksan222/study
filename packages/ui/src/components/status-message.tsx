import type { ComponentProps } from 'react';

const variants = {
  default: undefined,
  hint: 'text-sm text-muted-foreground'
} as const;

/** Announces operation state without moving focus or treating it as an error. */
export function StatusMessage({
  variant = 'default',
  ...props
}: Omit<ComponentProps<'p'>, 'role' | 'className'> & { variant?: keyof typeof variants }) {
  return (
    <p
      aria-live="polite"
      aria-atomic="true"
      {...props}
      role="status"
      className={variants[variant]}
    />
  );
}
