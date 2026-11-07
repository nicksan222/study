import { Toggle as BaseToggle } from '@base-ui/react/toggle';
import { ToggleGroup as BaseToggleGroup } from '@base-ui/react/toggle-group';
import type { ComponentProps } from 'react';

import { cn } from '../utils';

/** Single-choice segmented controls using the same Base UI primitives as Coss. */
export function ToggleGroup({ className, ...props }: ComponentProps<typeof BaseToggleGroup>) {
  return <BaseToggleGroup {...props} className={cn('study-toggle-group', className)} />;
}

export function Toggle({ className, ...props }: ComponentProps<typeof BaseToggle>) {
  return <BaseToggle {...props} className={cn('study-toggle', className)} />;
}
