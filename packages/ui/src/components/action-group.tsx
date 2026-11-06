import type { ComponentProps } from 'react';

import { cn } from '../utils';

import './action-group.css';

/** Responsive action rows share alignment and wrapping; feature surfaces may add spacing around them. */
export function ActionGroup({
  align = 'start',
  className,
  ...props
}: ComponentProps<'div'> & { align?: 'start' | 'end' | 'between' }) {
  return <div {...props} className={cn('ui-action-group', className)} data-align={align} />;
}
