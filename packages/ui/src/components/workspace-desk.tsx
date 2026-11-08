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
      className="workspace-desk"
      data-open={open || undefined}
      data-expanded={(open && expanded) || undefined}
      data-dock={dock}
      data-card-open={(!open && cardOpen) || undefined}
    >
      <div className="workspace-desk-layout">{children}</div>
    </div>
  );
}

/** Measures the floating input so the final notebook entry can always clear it. */

function Notebook({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const pane = root.current;
    const viewport = pane?.querySelector<HTMLElement>('[data-notebook-scroll-host]');
    const composer = pane?.querySelector<HTMLElement>('.workspace-desk-floating-composer');

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
    <div ref={root} className="workspace-desk-notebook">
      {children}
    </div>
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
          <ArrowLeft size={16} aria-hidden="true" />
        </Button>
        <Tabs.List className="workspace-desk-tabs" aria-label={closeLabel}>
          {tabs.map((tab) => (
            <div
              className="workspace-desk-tab"
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
        <div className="workspace-desk-panel-controls">
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
        <FileText size={20} aria-hidden="true" />
      </span>
      <span className="workspace-desk-page-copy">
        <span className="workspace-desk-page-title">{title}</span>
        {preview && <span className="workspace-desk-page-preview">{preview}</span>}
        {meta && <span className="workspace-desk-page-meta">{meta}</span>}
      </span>
      <span className="workspace-desk-page-open" aria-hidden="true">
        <ArrowUpRight size={16} />
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
            <ChevronRight size={14} aria-hidden="true" />
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
  FloatingComposer: part('div', 'workspace-desk-floating-composer'),
  LayoutControls: part('div', 'workspace-desk-layout-controls'),
  Drafts: part('div', 'workspace-desk-drafts'),
  Header: part('header', 'workspace-desk-header'),
  HeaderTitle: part('span', 'workspace-desk-header-title'),
  Editor: part('section', 'workspace-desk-editor'),
  PageReaderPage: part('div', 'page-editor-page'),
  SaveStatus: part('span', 'workspace-desk-save-status'),
  Recovery: part('section', 'workspace-desk-recovery')
};
