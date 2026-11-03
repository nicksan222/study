import { Button } from '@study/ui/button';
import { cn } from '@study/ui/utils';
import { SquareMenu } from 'lucide-react';
import { createContext, useContext, useId, useRef, useState } from 'react';
import type { ComponentProps, ReactNode, RefObject } from 'react';

const CardContext = createContext<{
  id: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  trigger: RefObject<HTMLButtonElement | null>;
} | null>(null);

function Provider({ children }: { children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(true);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <CardContext.Provider value={{ id, open, setOpen, trigger }}>{children}</CardContext.Provider>
  );
}

function Toggle({ label }: { label: string }) {
  const context = useContext(CardContext);
  if (!context) return null;
  return (
    <Button
      ref={context.trigger}
      size="icon-sm"
      variant="ghost-muted"
      className="ui-workspace-context-toggle"
      aria-label={label}
      title={label}
      aria-expanded={context.open}
      aria-controls={context.id}
      onClick={() => context.setOpen(!context.open)}
    >
      <SquareMenu aria-hidden="true" />
    </Button>
  );
}

function Root({
  className,
  variant,
  ...props
}: ComponentProps<'div'> & { variant: 'welcome' | 'session' }) {
  return <div className={cn('ui-workspace', className)} data-variant={variant} {...props} />;
}
function Body({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('ui-workspace-body', className)} {...props} />;
}
function Heading({ className, ...props }: ComponentProps<'header'>) {
  return <header className={cn('ui-workspace-heading', className)} {...props} />;
}
function Controls({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('ui-workspace-controls', className)} {...props} />;
}
function Dock({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('ui-workspace-dock', className)} {...props} />;
}
function Card({ className, ...props }: ComponentProps<'aside'>) {
  const context = useContext(CardContext);
  return (
    <aside
      {...props}
      id={context?.id ?? props.id}
      hidden={context ? !context.open : props.hidden}
      className={cn('ui-workspace-card', className)}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (
          context &&
          event.key === 'Escape' &&
          !event.defaultPrevented &&
          event.currentTarget.contains(event.target as Node)
        ) {
          event.preventDefault();
          context.setOpen(false);
          context.trigger.current?.focus();
        }
      }}
    />
  );
}
function Group({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('ui-workspace-card-group', className)} {...props} />;
}
function Item({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button variant="ghost-muted" className={cn('ui-workspace-card-item', className)} {...props} />
  );
}

export const WorkspaceSurface = { Root, Body, Heading, Dock, Controls };
export const WorkspaceCard = { Provider, Toggle, Root: Card, Group, Item };
