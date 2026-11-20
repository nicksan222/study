import { mergeProps } from '@base-ui/react/merge-props';
import { Tabs } from '@base-ui/react/tabs';
import { useRender } from '@base-ui/react/use-render';
import {
  PageIcon,
  CloseIcon,
  ClosePanelIcon,
  MaximizeIcon,
  MinimizeIcon,
  BackIcon,
  AddIcon,
  DisclosureIcon,
  OpenIcon
} from '@study/icons';
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { Button } from './button';
import { semanticPart as part } from './semantic-part';

function Root({
  open,
  expanded,
  dock = 'side',
  cardOpen = false,
  contentWidth,
  children
}: {
  open: boolean;
  expanded: boolean;
  dock?: 'side' | 'bottom';
  cardOpen?: boolean;
  contentWidth?: 'comfortable' | 'wide' | 'full';
  children: ReactNode;
}) {
  return (
    <div
      className="workspace-desk"
      data-open={open || undefined}
      data-expanded={(open && expanded) || undefined}
      data-dock={dock}
      data-card-open={(!open && cardOpen) || undefined}
      data-content-width={contentWidth}
    >
      <div className="workspace-desk-layout">{children}</div>
    </div>
  );
}

/** Keeps the notebook viewport dimensions available to its reading and navigation surfaces. */

function Notebook({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const pane = root.current;
    const viewport = pane?.querySelector<HTMLElement>('[data-notebook-scroll-host]');
    const composer = pane?.querySelector<HTMLElement>('.workspace-desk-floating-composer');

    if (!pane || !viewport) return;

    const measure = () => {
      pane.style.setProperty(
        '--notebook-scrollbar-width',
        String(viewport.offsetWidth - viewport.clientWidth) + 'px'
      );

      pane.style.setProperty(
        '--notebook-composer-height',
        String(composer?.offsetHeight ?? 0) + 'px'
      );

      if (viewport.clientHeight)
        pane.style.setProperty('--notebook-viewport-height', String(viewport.clientHeight) + 'px');
    };

    measure();
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);

    observer?.observe(viewport);

    if (composer) observer?.observe(composer);

    window.addEventListener('resize', measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <div ref={root} className="workspace-desk-notebook">
      {children}
    </div>
  );
}

/** Reveals capture in the notebook flow and moves keyboard focus into the opened input. */
function Capture({
  open,
  onOpenChange,
  label,
  closeLabel,
  children
}: {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  label: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const contentId = useId();
  const content = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const previousOpen = useRef(open);

  useLayoutEffect(() => {
    if (open && !previousOpen.current) {
      content.current?.querySelector('textarea')?.focus({ preventScroll: true });

      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
        content.current?.scrollIntoView({ block: 'nearest' });
    }

    if (
      !open &&
      previousOpen.current &&
      (content.current?.contains(document.activeElement) ||
        document.activeElement === document.body)
    )
      trigger.current?.focus();

    previousOpen.current = open;
  }, [open]);

  return (
    <section className="workspace-desk-capture">
      <Button
        ref={trigger}
        variant="ghost-muted"
        size="sm"
        aria-expanded={open}
        aria-controls={contentId}
        disabled={!onOpenChange}
        onClick={() => onOpenChange?.(!open)}
      >
        {open ? (
          <CloseIcon size={16} aria-hidden="true" />
        ) : (
          <AddIcon size={16} aria-hidden="true" />
        )}
        {open ? closeLabel : label}
      </Button>
      <div
        ref={content}
        id={contentId}
        inert={!open}
        aria-hidden={!open}
        data-open={open || undefined}
        className="workspace-desk-capture-content"
        onTransitionEnd={(event) => {
          if (
            event.target === event.currentTarget &&
            event.propertyName === 'grid-template-rows' &&
            open &&
            content.current?.contains(document.activeElement)
          )
            content.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }}
      >
        <div className="workspace-desk-capture-inner">
          <div className="workspace-desk-capture-body">{children}</div>
        </div>
      </div>
    </section>
  );
}

function ScrollArea({ children }: { children: ReactNode }) {
  return (
    <div className="workspace-desk-scroll" data-notebook-scroll-host>
      {children}
    </div>
  );
}

function NavigationHost() {
  return <div className="workspace-desk-navigation-host" data-notebook-navigation-host />;
}

/** Uses native tab semantics and keyboard navigation while keeping close controls separate from tab buttons. */

function Panel({
  tabs,
  active,
  onSelect,
  onClose,
  closeLabel,
  hideLabel,
  expandLabel,
  expanded,
  onExpand,
  onHide,
  children
}: {
  tabs: { id: string; label: ReactNode; closeLabel: string }[];
  active: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onHide: () => void;
  closeLabel: string;
  hideLabel: string;
  expandLabel: string;
  expanded: boolean;
  onExpand: () => void;
  children: ReactNode;
}) {
  const activeTab = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeTab.current?.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'instant'
    });
  }, [active]);

  return (
    <Tabs.Root
      className="workspace-desk-panel"
      value={active}
      onValueChange={(value) => {
        if (typeof value === 'string') onSelect(value);
      }}
    >
      <div className="workspace-desk-tab-header">
        <Button
          className="workspace-desk-back"
          variant="ghost-muted"
          size="icon-sm"
          aria-label={hideLabel}
          title={hideLabel}
          onClick={onHide}
        >
          <BackIcon size={16} aria-hidden="true" />
        </Button>
        <Tabs.List className="workspace-desk-tabs" aria-label={closeLabel}>
          {tabs.map((tab) => (
            <div
              className="workspace-desk-tab"
              key={tab.id}
              ref={tab.id === active ? activeTab : undefined}
            >
              <Tabs.Tab value={tab.id}>
                <PageIcon size={14} aria-hidden="true" />
                <span>{tab.label}</span>
              </Tabs.Tab>
              <button
                type="button"
                aria-label={tab.closeLabel}
                title={tab.closeLabel}
                onClick={() => onClose(tab.id)}
              >
                <CloseIcon size={13} aria-hidden="true" />
              </button>
            </div>
          ))}
        </Tabs.List>
        <div className="workspace-desk-panel-controls">
          <Button
            variant="ghost-muted"
            size="icon-sm"
            aria-label={expandLabel}
            title={expandLabel}
            onClick={onExpand}
          >
            {expanded ? <MinimizeIcon size={15} /> : <MaximizeIcon size={15} />}
          </Button>
          <Button
            variant="ghost-muted"
            size="icon-sm"
            aria-label={hideLabel}
            title={hideLabel}
            onClick={onHide}
          >
            <ClosePanelIcon size={15} />
          </Button>
        </div>
      </div>
      <Tabs.Panel className="workspace-desk-tab-panel" value={active}>
        {children}
      </Tabs.Panel>
    </Tabs.Root>
  );
}

function PageCard({
  title,
  meta,
  preview,
  active = false,
  onOpen,
  openLabel
}: {
  title: ReactNode;
  meta?: string;
  preview?: ReactNode;
  active?: boolean;
  onOpen: () => void;
  openLabel?: string;
}) {
  const card = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (active) card.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  return (
    <button
      ref={card}
      title={openLabel}
      className="workspace-desk-page"
      type="button"
      data-active={active || undefined}
      onClick={onOpen}
    >
      <span className="workspace-desk-page-icon">
        <PageIcon size={20} aria-hidden="true" />
      </span>
      <span className="workspace-desk-page-copy">
        <span className="workspace-desk-page-title">{title}</span>
        {preview && <span className="workspace-desk-page-preview">{preview}</span>}
        {meta && <span className="workspace-desk-page-meta">{meta}</span>}
      </span>
      <span className="workspace-desk-page-open" aria-hidden="true">
        <OpenIcon size={16} />
      </span>
    </button>
  );
}

type AttachmentTone = 'neutral' | 'blue' | 'violet' | 'amber' | 'teal' | 'red';

/** The same file identity is used on the notebook and in its attachment panel. */
export function AttachmentIcon({
  children,
  tone = 'neutral',
  size = 'default'
}: {
  children: ReactNode;
  tone?: AttachmentTone;
  size?: 'default' | 'compact';
}) {
  return (
    <span
      className="workspace-desk-attachment-icon"
      data-tone={tone}
      data-size={size}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

function AttachmentCard({
  name,
  meta,
  icon,
  preview,
  tone = 'neutral',
  render,
  ...props
}: useRender.ComponentProps<'a'> & {
  name: string;
  meta: ReactNode;
  icon: ReactNode;
  preview?: ReactNode;
  tone?: AttachmentTone;
}) {
  const link = useRender({
    defaultTagName: 'a',
    render,
    props: mergeProps<'a'>(
      {
        className: 'workspace-desk-attachment-row',
        title: name,
        children: (
          <>
            <AttachmentIcon tone={tone}>{icon}</AttachmentIcon>
            <span className="workspace-desk-attachment-copy">
              <span className="workspace-desk-attachment-name">{name}</span>
              <span className="workspace-desk-attachment-meta">{meta}</span>
            </span>
            <DisclosureIcon size={14} aria-hidden="true" />
          </>
        )
      },
      props
    )
  });

  return (
    <div className="workspace-desk-attachment">
      {preview && <div className="workspace-desk-attachment-preview">{preview}</div>}
      {link}
    </div>
  );
}

export const WorkspaceDeskSurface = {
  Root,
  Panel,
  PageCard,
  AttachmentCard,
  Attachments: part('div', 'workspace-desk-attachments'),
  QuickText: part('div', 'workspace-desk-quick-text'),
  Board: part('div', 'workspace-desk-board'),
  BoardBody: part('div', 'workspace-desk-board-body'),
  Notebook,
  ScrollArea,
  NavigationHost,
  NotebookLayout: part('div', 'workspace-desk-notebook-layout'),
  Capture,
  FloatingComposer: part('div', 'workspace-desk-floating-composer'),
  InlineComposer: part('div', 'workspace-desk-inline-composer'),
  LayoutControls: part('div', 'workspace-desk-layout-controls'),
  DesktopControls: part('span', 'note-desktop-layout-control'),
  Drafts: part('div', 'workspace-desk-drafts'),
  Header: part('header', 'workspace-desk-header'),
  HeaderTitle: part('span', 'workspace-desk-header-title'),
  Editor: part('section', 'workspace-desk-editor'),
  PageReaderPage: part('div', 'page-editor-page'),
  SaveStatus: part('span', 'workspace-desk-save-status'),
  Recovery: part('section', 'workspace-desk-recovery')
};
