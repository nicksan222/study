import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../utils.ts';
import { CONTROL_SURFACE_CLASS } from './control-styles';

export function Textarea({
  className,
  font = 'default',
  size = 'default',
  header,
  ...props
}: ComponentProps<'textarea'> & {
  font?: 'default' | 'mono';
  size?: 'default' | 'compact';
  header?: { label: ReactNode; action: ReactNode };
}) {
  const Surface = header ? 'div' : 'span';

  return (
    <Surface
      className={cn(
        CONTROL_SURFACE_CLASS,
        'has-[>textarea:disabled]:bg-(--ui-neutral-fill) has-[>textarea:disabled]:opacity-64 has-[>textarea:disabled]:shadow-[inset_0_0_0_1px_var(--ui-field-border)]',
        header && 'flex-col',
        font === 'mono' && 'font-mono tabular-nums'
      )}
      data-slot="textarea-control"
    >
      {header && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-3 py-2">
          <span className="text-sm font-medium">{header.label}</span>
          <div className="ml-auto">{header.action}</div>
        </div>
      )}
      <textarea
        className={cn(
          'block w-full resize-y rounded-[inherit] bg-transparent p-3 leading-5 outline-none placeholder:text-placeholder disabled:cursor-not-allowed',
          size === 'compact' ? 'min-h-24' : 'min-h-44',
          font === 'mono' ? 'text-xs' : 'text-base sm:text-sm',
          className
        )}
        data-slot="textarea"
        {...props}
      />
    </Surface>
  );
}
