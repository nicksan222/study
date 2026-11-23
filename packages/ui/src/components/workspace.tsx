import { OpenIcon, MenuIcon } from '@study/icons';
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
import type { ComponentProps, ReactNode, RefObject } from 'react';

import { cn } from '../utils.ts';
import { Button } from './button.tsx';
import { ComposerSurface } from './composer.tsx';
import { semanticPart as part } from './semantic-part';
import { AttachmentIcon } from './workspace-desk';

/** Follows the inline size of an unpadded page workspace at the split-layout breakpoint. */
export function useWorkspaceWide(
  workspace: RefObject<HTMLElement | null>,
  onBeforeNarrow?: () => void
): boolean {
  const [wide, setWide] = useState(false);
  const beforeNarrow = useEffectEvent(() => onBeforeNarrow?.());

  useLayoutEffect(() => {
    const element = workspace.current;

    if (!element) return;

    let wasWide = false;
    const measure = () => {
      const width = getComputedStyle(element).width;
      const pixels = width.endsWith('px') ? Number.parseFloat(width) : element.clientWidth;
      const isWide = pixels >= 960;

      if (isWide === wasWide) return;

      if (!isWide) beforeNarrow();

      wasWide = isWide;
      setWide(isWide);
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);

      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);

    observer.observe(element);

    return () => observer.disconnect();
  }, [workspace]);

  return wide;
}

const CardContext = createContext<{
  id: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  trigger: RefObject<HTMLButtonElement | null>;
} | null>(null);

/** Shares panel visibility and its focus-return target, supporting controlled workspaces. */
function Provider({
  children,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  triggerRef
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  const id = useId();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);

    onOpenChange?.(nextOpen);
  };
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <CardContext.Provider value={{ id, open, setOpen, trigger: triggerRef ?? trigger }}>
      {children}
    </CardContext.Provider>
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
      <MenuIcon aria-hidden="true" />
    </Button>
  );
}

/** Frames a page or notebook within the shared workspace surface. */

function Root({
  className,
  variant,
  ...props
}: ComponentProps<'div'> & { variant: 'welcome' | 'note' | 'desk' | 'page' | 'flow' }) {
  return (
    <div
      className={cn('ui-workspace', variant !== 'welcome' && 'note-canvas', className)}
      data-variant={variant}
      {...props}
    />
  );
}

function Content({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('ui-workspace-content', className)} {...props} />;
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
}: ComponentProps<'aside'> & { variant?: 'context'; onDismiss?: () => void }) {
  const context = useContext(CardContext);

  const element = useRef<HTMLElement>(null);
  const hidden = props.hidden ?? (context ? !context.open : undefined);

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
      hidden={hidden}
      className={cn(
        'ui-workspace-card',
        variant === 'context' && 'note-workspace-context',
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
  Content,
  Body,
  Heading,
  Dock,
  Controls,
  Container: part('section', 'note-workspace'),
  Section: part('div', 'note-section'),
  Deletion: part('section', 'note-delete'),
  ContextDialogBody: part('div', 'note-context-dialog-body'),
  SubjectIdentity: part('span', 'note-subject-identity'),
  Footer: part('div', 'note-workspace-meta'),
  ComposerHint,
  ComposerSubmit
};

export const WorkspaceChanges = {
  Actions: part('div', 'note-context-actions')
};

function AttachmentItem({
  label,
  meta,
  icon,
  tone,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children'> & {
  label: string;
  meta: ReactNode;
  icon: ReactNode;
  tone?: ComponentProps<typeof AttachmentIcon>['tone'];
}) {
  return (
    <Item {...props} size="sm" className={cn('note-attachment-item', className)}>
      <AttachmentIcon tone={tone} size="compact">
        {icon}
      </AttachmentIcon>
      <span className="note-attachment-copy">
        <span className="note-attachment-name">{label}</span>
        <span className="note-attachment-meta">{meta}</span>
      </span>
      <OpenIcon className="note-attachment-open" aria-hidden="true" />
    </Item>
  );
}

function OutlineItem({
  children,
  icon,
  ...props
}: ComponentProps<typeof Button> & { icon: ReactNode }) {
  return (
    <Item {...props} size="sm" className="note-outline-item">
      {icon}
      <span>{children}</span>
    </Item>
  );
}

export const WorkspaceAttachments = {
  Section: part('section', 'note-attachment-section'),
  Heading: part('header', 'note-page-index-heading'),
  Outline: part('nav', 'note-outline'),
  OutlineList: part('ol', 'note-outline-list'),
  OutlineItem,
  OutlineScope: part('p', 'note-outline-scope'),
  OutlineFeedback: part('div', 'note-outline-feedback'),
  Empty: part('p', 'note-page-index-empty'),
  List: part('div', 'note-page-index'),
  Rows: part('div', 'note-attachment-rows'),
  Item: AttachmentItem
};

function Primary(props: ComponentProps<typeof Button>) {
  return <Button {...props} size="sm" className="ui-workspace-card-primary" />;
}

export const WorkspaceCard = {
  Provider,
  Toggle,
  Root: Card,
  Group,
  Item,
  Primary,
  Caption: part('p', 'ui-workspace-card-caption')
};

export const WorkspaceWork = {
  Icon: AttachmentIcon,
  Root: part('section', 'ui-workspace-work'),
  Heading: part('header', 'ui-workspace-work-heading'),
  List: part('ul', 'ui-workspace-work-list'),
  Row: part('li', 'ui-workspace-work-row'),
  ItemIcon: part('span', 'ui-workspace-work-icon'),
  Copy: part('div', 'ui-workspace-work-copy'),
  Status: part('span', 'ui-workspace-work-status'),
  Progress: part('div', 'ui-workspace-work-progress'),
  Empty: part('p', 'ui-workspace-work-empty'),
  Error: part('div', 'ui-workspace-work-error')
};
