import { cn } from '@study/ui/utils';
import type { ComponentProps } from 'react';

import { CONTROL_SURFACE_CLASS } from './control-styles';

export function Textarea({
  className,
  font = 'default',
  size = 'default',
  ...props
}: ComponentProps<'textarea'> & { font?: 'default' | 'mono'; size?: 'default' | 'compact' }) {
  return (
    <span
      className={cn(CONTROL_SURFACE_CLASS, font === 'mono' && 'font-mono tabular-nums')}
      data-slot="textarea-control"
    >
      <textarea
        className={cn(
          'block w-full resize-y rounded-[inherit] bg-transparent p-3 text-sm leading-5 outline-none placeholder:text-placeholder disabled:cursor-not-allowed',
          size === 'compact' ? 'min-h-24' : 'min-h-44',
          font === 'mono' && 'text-xs',
          className
        )}
        data-slot="textarea"
        {...props}
      />
    </span>
  );
}
