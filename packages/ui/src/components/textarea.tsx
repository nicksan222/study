import { cn } from '@study/ui/utils';
import type { ComponentProps } from 'react';

import { CONTROL_SURFACE_CLASS } from './control-styles';

export function Textarea({
  className,
  font = 'default',
  ...props
}: ComponentProps<'textarea'> & { font?: 'default' | 'mono' }) {
  return (
    <span
      className={cn(CONTROL_SURFACE_CLASS, font === 'mono' && 'font-mono tabular-nums')}
      data-slot="textarea-control"
    >
      <textarea
        className={cn(
          'block min-h-44 w-full resize-y rounded-[inherit] bg-transparent p-3 text-sm leading-5 outline-none placeholder:text-placeholder disabled:cursor-not-allowed',
          font === 'mono' && 'text-xs',
          className
        )}
        data-slot="textarea"
        {...props}
      />
    </span>
  );
}
