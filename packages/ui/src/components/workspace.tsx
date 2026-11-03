import { Button } from '@study/ui/button';
import { ComposerSurface } from '@study/ui/composer';
import { DialogPopup } from '@study/ui/dialog';
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

/** Applies the welcome or session canvas layout through the shared workspace surface. */
function Root({
  className,
  variant,
  ...props
}: ComponentProps<'div'> & { variant: 'welcome' | 'session' }) {
  return (
    <div
      className={cn('ui-workspace', variant === 'session' && 'session-canvas', className)}
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
function Card({ className, variant, ...props }: ComponentProps<'aside'> & { variant?: 'changes' }) {
  const context = useContext(CardContext);

  const element = useRef<HTMLElement>(null);

  useImperativeHandle(props.ref, () => element.current!);

  // Escape is scoped to descendants so another workspace's panel keeps its state.
  useEffect(() => {
    const panel = element.current;

    if (!context || !panel) return;

    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !panel.contains(event.target as Node))
        return;

      event.preventDefault();
      context.setOpen(false);
      context.trigger.current?.focus();
    };

    document.addEventListener('keydown', close);

    return () => document.removeEventListener('keydown', close);
  }, [context]);

  return (
    <aside
      {...props}
      ref={element}
      id={context?.id ?? props.id}
      hidden={context ? !context.open : props.hidden}
      className={cn('ui-workspace-card', variant === 'changes' && 'session-changes', className)}
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

function ChangeDialog(
  props: Omit<ComponentProps<typeof DialogPopup>, 'className' | 'bottomStickOnMobile'>
) {
  return <DialogPopup {...props} className="session-change-dialog" bottomStickOnMobile={false} />;
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

function ContextAction(props: Omit<ComponentProps<typeof Button>, 'className' | 'variant'>) {
  return <Button {...props} variant="outline" className="session-context-action" />;
}

export const WorkspaceChanges = {
  Actions: part('div', 'session-context-actions'),
  Summary: part('p', 'session-muted'),
  Action: ContextAction,
  Heading: part('header', 'session-changes-heading'),
  Empty: part('p', 'session-changes-empty'),
  List: part('div', 'session-changes-list'),
  More: part('div', 'session-changes-more'),
  Label: part('span', 'session-change-label'),
  Preview: part('div', 'session-change-preview'),
  Versions: part('div', 'session-change-versions'),
  Text: part('div', 'session-change-text'),
  Dialog: ChangeDialog
};

export const WorkspaceCard = { Provider, Toggle, Root: Card, Group, Item };
