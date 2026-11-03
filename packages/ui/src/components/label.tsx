import { cn } from '@study/ui/utils';
import type { ComponentProps } from 'react';

export function Label({ className, htmlFor, children, ...props }: ComponentProps<'label'>) {
  return (
    <label className={cn('ui-label', className)} data-slot="label" htmlFor={htmlFor} {...props}>
      {children}
    </label>
  );
}
