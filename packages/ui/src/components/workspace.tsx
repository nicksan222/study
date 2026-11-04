import { Button } from '@study/ui/button';
import { ComposerSurface } from '@study/ui/composer';
import { cn } from '@study/ui/utils';
import { SquareMenu } from 'lucide-react';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState
} from 'react';
import type { ComponentProps, ReactNode, RefObject } from 'react';

import { semanticPart as part } from './semantic-part';

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

/** Toggles the workspace context panel using its shared visibility state. */

function Toggle({
  label,
  open,
  onOpenChange
}: {
  label: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const context = useContext(CardContext);

  if (!context) return null;

  return (
    <Button
      ref={context.trigger}
      size="icon-sm"
      variant={(open ?? context.open) ? 'secondary' : 'ghost-muted'}
      className="ui-workspace-context-toggle"
      aria-label={label}
      title={label}
      aria-expanded={open ?? context.open}
      aria-pressed={open ?? context.open}
      aria-controls={context.id}
      onClick={() => (onOpenChange ?? context.setOpen)(!(open ?? context.open))}
    >
      <SquareMenu aria-hidden="true" />
    </Button>
  );
}

/** Applies the welcome or session canvas layout through the shared workspace surface. */

function Root({
  className,
  variant,
  ...props
}: ComponentProps<'div'> & { variant: 'welcome' | 'session' | 'desk' }) {
  return (
    <div
      className={cn('ui-workspace', variant !== 'welcome' && 'session-canvas', className)}
      data-variant={variant}
      {...props}
    />
  );
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

/** Styles a workspace context card with the optional changes presentation. */

function Card({
  className,
  variant,
  onDismiss,
  ...props
}: ComponentProps<'aside'> & { variant?: 'attachments'; onDismiss?: () => void }) {
  const context = useContext(CardContext);

  const element = useRef<HTMLElement>(null);

  useImperativeHandle(props.ref, () => element.current!);

  // Escape is scoped to descendants so another workspace's panel keeps its state.
  useEffect(() => {
    const panel = element.current;

    if (!panel || (!context && !onDismiss)) return;

    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !panel.contains(event.target as Node))
        return;

      event.preventDefault();

      if (onDismiss) onDismiss();
      else context?.setOpen(false);

      context?.trigger.current?.focus();
    };

    document.addEventListener('keydown', close);

    return () => document.removeEventListener('keydown', close);
  }, [context, onDismiss]);

  return (
    <aside
      {...props}
      ref={element}
      id={context?.id ?? props.id}
      hidden={props.hidden ?? (context ? !context.open : undefined)}
      className={cn(
        'ui-workspace-card',
        variant === 'attachments' && 'session-attachments-card',
        className
      )}
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

function ComposerHint(props: Omit<ComponentProps<typeof ComposerSurface.Hint>, 'className'>) {
  return <ComposerSurface.Hint {...props} className="sr-only" />;
}

function ComposerSubmit(props: Omit<ComponentProps<typeof Button>, 'className' | 'size'>) {
  return <Button {...props} size="icon" className="ui-composer-submit" />;
}

export const WorkspaceSurface = {
  Root,
  Body,
  Heading,
  Dock,
  Controls,
  Container: part('section', 'session-workspace'),
  Section: part('div', 'session-section'),
  Deletion: part('section', 'session-delete'),
  ContextDialogBody: part('div', 'session-context-dialog-body'),
  SubjectIdentity: part('span', 'session-subject-identity'),
  Footer: part('div', 'session-workspace-meta'),
  ComposerHint,
  ComposerSubmit
};

export const WorkspaceChanges = {
  Actions: part('div', 'session-context-actions')
};

function AttachmentItem(props: ComponentProps<typeof Button>) {
  return <Button {...props} size="sm" variant="ghost-muted" className="session-attachment-item" />;
}

export const WorkspaceAttachments = {
  Heading: part('header', 'session-page-index-heading'),
  Empty: part('p', 'session-page-index-empty'),
  List: part('div', 'session-page-index'),
  Rows: part('div', 'session-attachment-rows'),
  Item: AttachmentItem
};

function Primary(props: ComponentProps<typeof Button>) {
  return <Button {...props} size="sm" className="ui-workspace-card-primary" />;
}

export const WorkspaceCard = { Provider, Toggle, Root: Card, Group, Item, Primary };
