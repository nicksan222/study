import type { ComponentProps } from 'react';

import { Button } from './button';

type ActionProps = Omit<ComponentProps<typeof Button>, 'children'> & { label: string };

/** Keeps recovery actions recognizable across inline errors, dialogs and pages. */
export function RetryButton({ label, variant = 'outline', size = 'sm', ...props }: ActionProps) {
  return (
    <Button {...props} type="button" variant={variant} size={size}>
      {label}
    </Button>
  );
}

/** Pagination retains its label and exposes busy state without shifting the list. */
export function LoadMoreButton({
  label,
  pending = false,
  disabled,
  variant = 'ghost',
  ...props
}: ActionProps & { pending?: boolean }) {
  return (
    <Button
      {...props}
      type="button"
      variant={variant}
      disabled={pending || disabled}
      aria-busy={pending}
    >
      {label}
    </Button>
  );
}
