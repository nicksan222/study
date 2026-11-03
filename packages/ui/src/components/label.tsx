import { cn } from '@study/ui/utils';
import type { ComponentProps } from 'react';

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('ui-label', className)} data-slot="label" {...props} />;
}
