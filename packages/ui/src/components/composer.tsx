import { cn } from '@study/ui/utils';
import type { ComponentProps } from 'react';

// Surface composition adapted from T3 Code's ComposerSurface and coss UI's composer.
// https://github.com/pingdotgg/t3code/blob/edc37c96c810d42761ab510c6a3e9d0a741547dc/apps/web/src/components/chat/ComposerSurface.tsx
// https://github.com/cosscom/coss/blob/b4495ad12c80742296125f4a8ebc43b6d4fa5721/packages/ui/src/components/composer.tsx
function Root({
  className,
  variant = 'default',
  ...props
}: ComponentProps<'section'> & { variant?: 'default' | 'notebook' }) {
  return (
    <section
      className={cn('ui-composer', variant === 'notebook' && 'session-composer', className)}
      {...props}
    />
  );
}

function Input({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn('ui-composer-input', className)} {...props} />;
}

function Footer({
  className,
  variant = 'default',
  ...props
}: ComponentProps<'div'> & { variant?: 'default' | 'notebook' }) {
  return (
    <div
      className={cn(
        'ui-composer-footer',
        variant === 'notebook' && 'session-composer-footer',
        className
      )}
      {...props}
    />
  );
}

function Hint({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('ui-composer-hint', className)} {...props} />;
}

export const ComposerSurface = { Root, Input, Footer, Hint };
