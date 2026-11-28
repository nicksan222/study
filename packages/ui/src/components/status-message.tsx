import type { ComponentProps } from 'react';

const variants = {
  default: 'text-sm/[1.5] text-foreground',
  hint: 'text-sm/[1.5] text-muted-foreground',
  announcement: 'sr-only'
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
