import { cn } from '@study/ui/utils';
import type { ComponentProps } from 'react';

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
