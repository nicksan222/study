import type { ComponentProps } from 'react';

import { cn } from '../utils.ts';

/** Presents a decorative identity badge while leaving its accessible name to the surrounding control. */
export function Identity({
  text,
  children,
  className,
  ...props
}: ComponentProps<'span'> & { text?: string }) {
  return (
    <span className={cn('ui-identity', className)} aria-hidden="true" {...props}>
      {children ?? text}
    </span>
  );
}
