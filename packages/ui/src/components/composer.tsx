import { cn } from '@study/ui/utils';
import type { ComponentProps, ReactNode } from 'react';

// Surface composition adapted from T3 Code's ComposerSurface and coss UI's composer.
// https://github.com/pingdotgg/t3code/blob/edc37c96c810d42761ab510c6a3e9d0a741547dc/apps/web/src/components/chat/ComposerSurface.tsx
// https://github.com/cosscom/coss/blob/b4495ad12c80742296125f4a8ebc43b6d4fa5721/packages/ui/src/components/composer.tsx
function Root({
  className,
  variant = 'default',
  ...props
}: ComponentProps<'section'> & { variant?: 'default' | 'starter' | 'notebook' }) {
  return (
    <section
      className={cn('ui-composer', variant === 'notebook' && 'session-composer', className)}
      data-variant={variant}
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
}: ComponentProps<'div'> & { variant?: 'default' | 'starter' | 'notebook' }) {
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

function Attachments(props: ComponentProps<'ul'>) {
  return <ul {...props} className="ui-composer-attachments" />;
}

function Attachment({
  name,
  size,
  status,
  state,
  icon,
  preview,
  actions,
  children
}: {
  name: string;
  size: string;
  status: string;
  state: 'uploading' | 'ready' | 'rejected' | 'uncertain';
  icon: ReactNode;
  preview?: ReactNode;
  actions: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="ui-composer-attachment" data-state={state}>
      {preview && <div className="ui-composer-attachment-preview">{preview}</div>}
      <span className="ui-composer-attachment-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="ui-composer-attachment-copy">
        <span className="ui-composer-attachment-name" title={name}>
          {name}
        </span>
        <span className="ui-composer-attachment-meta">
          <span>{size}</span>
          <span role="status">{status}</span>
        </span>
      </span>
      <span className="ui-composer-attachment-actions">{actions}</span>
      {children && <div className="ui-composer-attachment-recovery">{children}</div>}
    </li>
  );
}

export const ComposerSurface = { Root, Input, Footer, Hint, Attachments, Attachment };
