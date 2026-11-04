import { mergeProps } from '@base-ui/react/merge-props';
import { Tabs } from '@base-ui/react/tabs';
import { useRender } from '@base-ui/react/use-render';
import {
  FileText,
  X,
  PanelRightClose,
  Maximize2,
  Minimize2,
  Plus,
  ArrowLeft,
  ChevronRight,
  ArrowUpRight
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { Button } from './button';
import { semanticPart as part } from './semantic-part';

function Root({
  open,
  expanded,
  dock = 'side',
  cardOpen = false,
  children
}: {
  open: boolean;
  expanded: boolean;
  dock?: 'side' | 'bottom';
  cardOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="session-desk"
      data-open={open || undefined}
      data-expanded={(open && expanded) || undefined}
      data-dock={dock}
      data-card-open={(!open && cardOpen) || undefined}
    >
      <div className="session-desk-layout">{children}</div>
    </div>
  );
}

/** Measures the floating input so the final notebook entry can always clear it. */
function Notebook({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const pane = root.current;
    const viewport = pane?.querySelector<HTMLElement>('[data-notebook-scroll-host]');
    const composer = pane?.querySelector<HTMLElement>('.session-desk-floating-composer');
    if (!pane || !viewport || !composer) return;
    const measure = () => {
      pane.style.setProperty(
        '--notebook-scrollbar-width',
        String(viewport.offsetWidth - viewport.clientWidth) + 'px'
      );
      pane.style.setProperty('--notebook-composer-height', String(composer.offsetHeight) + 'px');
      if (viewport.clientHeight)
        pane.style.setProperty('--notebook-viewport-height', String(viewport.clientHeight) + 'px');
    };
    measure();
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(viewport);
    observer?.observe(composer);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  return (
    <div ref={root} className="session-desk-notebook">
      {children}
    </div>
  );
}

function ScrollArea({ children }: { children: ReactNode }) {
  return (
    <div className="session-desk-scroll" data-notebook-scroll-host>
      {children}
    </div>
  );
}

function NavigationHost() {
  return <div className="session-desk-navigation-host" data-notebook-navigation-host />;
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
  onCreate,
  createLabel,
  children
}: {
  tabs: { id: string; label: ReactNode; closeLabel: string }[];
  active: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onHide: () => void;
  onCreate: () => void;
  createLabel: string;
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
      className="session-desk-panel"
      value={active}
      onValueChange={(value) => {
        if (typeof value === 'string') onSelect(value);
      }}
    >
      <div className="session-desk-tab-header">
        <Button
          className="session-desk-back"
          variant="ghost-muted"
          size="icon-sm"
          aria-label={hideLabel}
          title={hideLabel}
          onClick={onHide}
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </Button>
        <Tabs.List className="session-desk-tabs" aria-label={closeLabel}>
          {tabs.map((tab) => (
            <div
              className="session-desk-tab"
              key={tab.id}
              ref={tab.id === active ? activeTab : undefined}
            >
              <Tabs.Tab value={tab.id}>
                <FileText size={14} aria-hidden="true" />
                <span>{tab.label}</span>
              </Tabs.Tab>
              <button
                type="button"
                aria-label={tab.closeLabel}
                title={tab.closeLabel}
                onClick={() => onClose(tab.id)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          ))}
        </Tabs.List>
        <Button
          variant="ghost-muted"
          size="icon-sm"
          aria-label={createLabel}
          title={createLabel}
          onClick={onCreate}
        >
          <Plus size={16} aria-hidden="true" />
        </Button>
        <div className="session-desk-panel-controls">
          <Button
            variant="ghost-muted"
            size="icon-sm"
            aria-label={expandLabel}
            title={expandLabel}
            onClick={onExpand}
          >
            {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </Button>
          <Button
            variant="ghost-muted"
            size="icon-sm"
            aria-label={hideLabel}
            title={hideLabel}
            onClick={onHide}
          >
            <PanelRightClose size={15} />
          </Button>
        </div>
      </div>
      <Tabs.Panel className="session-desk-tab-panel" value={active}>
        {children}
      </Tabs.Panel>
    </Tabs.Root>
  );
}

function DocumentCard({
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
      className="session-desk-document"
      type="button"
      data-active={active || undefined}
      onClick={onOpen}
    >
      <span className="session-desk-document-icon">
        <FileText size={20} aria-hidden="true" />
      </span>
      <span className="session-desk-document-copy">
        <span className="session-desk-document-title">{title}</span>
        {preview && <span className="session-desk-document-preview">{preview}</span>}
        {meta && <span className="session-desk-document-meta">{meta}</span>}
      </span>
      <span className="session-desk-document-open" aria-hidden="true">
        <ArrowUpRight size={16} />
      </span>
    </button>
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
  tone?: 'neutral' | 'blue' | 'violet' | 'amber' | 'teal' | 'red';
}) {
  const link = useRender({
    defaultTagName: 'a',
    render,
    props: mergeProps<'a'>(
      {
        className: 'session-desk-attachment-row',
        title: name,
        children: (
          <>
            <span className="session-desk-attachment-icon" data-tone={tone} aria-hidden="true">
              {icon}
            </span>
            <span className="session-desk-attachment-copy">
              <span className="session-desk-attachment-name">{name}</span>
              <span className="session-desk-attachment-meta">{meta}</span>
            </span>
            <ChevronRight size={14} aria-hidden="true" />
          </>
        )
      },
      props
    )
  });

  return (
    <div className="session-desk-attachment">
      {preview && <div className="session-desk-attachment-preview">{preview}</div>}
      {link}
    </div>
  );
}

export const SessionDeskSurface = {
  Root,
  Panel,
  DocumentCard,
  AttachmentCard,
  Attachments: part('div', 'session-desk-attachments'),
  QuickText: part('div', 'session-desk-quick-text'),
  Board: part('div', 'session-desk-board'),
  BoardBody: part('div', 'session-desk-board-body'),
  Notebook,
  ScrollArea,
  NavigationHost,
  NotebookLayout: part('div', 'session-desk-notebook-layout'),
  FloatingComposer: part('div', 'session-desk-floating-composer'),
  LayoutControls: part('div', 'session-desk-layout-controls'),
  Drafts: part('div', 'session-desk-drafts'),
  Header: part('header', 'session-desk-header'),
  HeaderTitle: part('span', 'session-desk-header-title'),
  Editor: part('section', 'session-desk-editor'),
  SaveStatus: part('span', 'session-desk-save-status'),
  Recovery: part('section', 'session-desk-recovery')
};
