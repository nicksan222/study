import { Spinner } from '@study/ui/spinner';
import { cn } from '@study/ui/utils';
import type { ComponentPropsWithRef, ReactNode } from 'react';

type LoadingProps = Omit<ComponentPropsWithRef<'span'>, 'children' | 'role'> & {
  label: string;
  layout?: 'inline' | 'panel' | 'sidebar';
};

function Loading({ label, layout = 'inline', className, ...props }: LoadingProps) {
  return (
    <span
      {...props}
      role="status"
      aria-atomic="true"
      data-slot="loading"
      data-layout={layout}
      className={cn('study-loading', className)}
    >
      <Spinner label={label} size="md" aria-hidden="true" role="presentation" />
      <span>{label}</span>
    </span>
  );
}

function LoadingSkeleton({
  label,
  layout = 'panel',
  action,
  className,
  ...props
}: Omit<ComponentPropsWithRef<'div'>, 'children' | 'role'> & {
  label: string;
  layout?: 'panel' | 'sidebar';
  action?: ReactNode;
}) {
  return (
    <div
      {...props}
      role="status"
      aria-atomic="true"
      data-slot="loading-skeleton"
      data-layout={layout}
      className={cn('study-loading-skeleton', className)}
    >
      <div className="study-loading-skeleton-heading">
        <span className="sr-only">{label}</span>
        {action}
      </div>
      <div aria-hidden="true" data-slot="loading-placeholder" className="study-loading-placeholder">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function Thinking({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <div className="study-thinking">
      <span role="status" aria-atomic="true" className="study-thinking-label">
        <span className="study-thinking-dot" aria-hidden="true" />
        {label}
      </span>
      {action}
    </div>
  );
}

export { Loading, LoadingSkeleton, Thinking };
export type { LoadingProps };
