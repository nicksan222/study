import { useRender } from '@base-ui/react/use-render';
import { Button } from '@study/ui/button';
import {
  Combobox,
  ComboboxTrigger,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty
} from '@study/ui/combobox';
import type { InputProps } from '@study/ui/input';
import { Tooltip, TooltipTrigger, TooltipPopup } from '@study/ui/tooltip';
import { cn } from '@study/ui/utils';
import { PanelLeft, X, ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { SearchField as SharedSearchField } from './search-field';
import { useSidebarShortcuts } from './sidebar-shortcuts';

const frameClasses = { default: '', 'note-entry': 'study-shell-note-entry' } as const;

/** Owns persisted sidebar resizing within the content and sidebar width constraints. */

function Frame({
  collapsed,
  variant = 'default',
  defaultWidth = 320,
  minWidth = 208,
  minContentWidth = 640,
  storageKey,
  resizeLabel,
  resizeHint,
  className,
  children,
  ...props
}: ComponentProps<'div'> & {
  collapsed: boolean;
  variant?: 'default' | 'note-entry';
  defaultWidth?: number;
  minWidth?: number;
  minContentWidth?: number;
  storageKey?: string;
  resizeLabel: string;
  resizeHint: string;
}) {
  const [preferredWidth, setWidth] = useState(() => {
    if (storageKey && typeof window !== 'undefined') {
      try {
        const saved = Number(window.localStorage.getItem(storageKey));

        if (Number.isFinite(saved) && saved >= minWidth) return saved;
      } catch {
        /* Storage is optional. */
      }
    }

    return defaultWidth;
  });
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? defaultWidth + minContentWidth : window.innerWidth
  );
  const width = Math.min(
    Math.max(minWidth, preferredWidth),
    Math.max(minWidth, viewportWidth - minContentWidth)
  );

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);

    window.addEventListener('resize', onResize);

    return () => window.removeEventListener('resize', onResize);
  }, []);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: number; width: number; next: number; frame?: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const maximum = () =>
    Math.max(
      minWidth,
      (frame.current?.getBoundingClientRect().width ||
        (typeof window === 'undefined' ? defaultWidth + minContentWidth : window.innerWidth)) -
        minContentWidth
    );
  const clamp = (value: number) => Math.round(Math.min(maximum(), Math.max(minWidth, value)));
  const commit = (value: number) => {
    const next = clamp(value);

    setWidth(next);
    frame.current?.style.setProperty('--sidebar-width', `${next}px`);

    if (storageKey) {
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        /* Storage is optional. */
      }
    }
  };
  const finish = () => {
    const current = drag.current;

    if (!current) return;

    if (current.frame !== undefined) cancelAnimationFrame(current.frame);

    drag.current = null;
    setResizing(false);
    commit(current.next);
  };

  useEffect(() => {
    if (collapsed && drag.current) {
      if (drag.current.frame !== undefined) cancelAnimationFrame(drag.current.frame);

      drag.current = null;
      setResizing(false);
    }

    return () => {
      if (drag.current?.frame !== undefined) cancelAnimationFrame(drag.current.frame);
    };
  }, [collapsed]);

  return (
    <div
      {...props}
      ref={frame}
      className={cn('study-shell', frameClasses[variant], className)}
      data-sidebar-collapsed={collapsed}
      data-resizing={resizing || undefined}
      style={{ ...props.style, '--sidebar-width': `${width}px` } as CSSProperties}
    >
      {children}
      {!collapsed && (
        <button
          type="button"
          className="study-sidebar-resizer"
          aria-label={resizeLabel}
          title={resizeHint}
          role="separator"
          aria-orientation="vertical"
          aria-valuemin={minWidth}
          aria-valuemax={Math.round(maximum())}
          aria-valuenow={width}
          onPointerDown={(event) => {
            if (event.button !== 0 || event.isPrimary === false) return;

            event.preventDefault();
            event.currentTarget.setPointerCapture?.(event.pointerId);
            drag.current = { start: event.clientX, width, next: width };
            setResizing(true);
          }}
          onPointerMove={(event) => {
            const current = drag.current;

            if (!current) return;

            current.next = clamp(current.width + event.clientX - current.start);

            if (current.frame !== undefined) cancelAnimationFrame(current.frame);

            current.frame = requestAnimationFrame(() =>
              frame.current?.style.setProperty('--sidebar-width', `${current.next}px`)
            );
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
          onLostPointerCapture={finish}
          onBlur={finish}
          onDoubleClick={() => commit(defaultWidth)}
          onKeyDown={(event) => {
            const value =
              event.key === 'ArrowLeft'
                ? width - 16
                : event.key === 'ArrowRight'
                  ? width + 16
                  : event.key === 'Home'
                    ? minWidth
                    : event.key === 'End'
                      ? maximum()
                      : undefined;

            if (value !== undefined) {
              event.preventDefault();
              commit(value);
            }
          }}
        />
      )}
    </div>
  );
}

function Root({ className, ref, ...props }: ComponentProps<'aside'>) {
  const root = useSidebarShortcuts();

  useImperativeHandle(ref, () => root.current!);

  return <aside {...props} ref={root} className={cn('study-sidebar', className)} />;
}

function Header({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cn('study-sidebar-header', className)} />;
}

function Toolbar({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cn('study-sidebar-toolbar', className)} />;
}

function Content({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cn('study-sidebar-scroll', className)} />;
}

function Footer({
  className,
  children,
  trailing,
  ...props
}: ComponentProps<'nav'> & {
  trailing?: ReactNode;
}) {
  return (
    <nav {...props} className={cn('study-sidebar-footer', className)}>
      {children}
      {trailing && <div className="study-sidebar-footer-trailing">{trailing}</div>}
    </nav>
  );
}

function Navigation({ className, ...props }: ComponentProps<'nav'>) {
  return <nav {...props} className={cn('study-sidebar-navigation', className)} />;
}

function NavigationItem({
  label,
  count,
  unresolved = false,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children'> & {
  label: string;
  count?: number;
  unresolved?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      {...props}
      variant="ghost-muted"
      layout="navigation"
      aria-label={label}
      title={label}
      className={cn('study-sidebar-navigation-item', props.className)}
    >
      {children}
      <span className="study-sidebar-navigation-label">{label}</span>
      {count !== undefined && (
        <span className="study-sidebar-navigation-count" data-unresolved={unresolved || undefined}>
          {count}
        </span>
      )}
    </Button>
  );
}

function Items({ className, ...props }: ComponentProps<'nav'>) {
  return <nav {...props} className={cn('study-note-list', className)} />;
}

function Message({ className, ...props }: ComponentProps<'p'>) {
  return <p {...props} className={cn('study-sidebar-message', className)} />;
}

function FormFields({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cn('study-sidebar-form-fields', className)} />;
}

function SwitcherActions({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cn('study-subject-actions', className)} />;
}

function PickerShortcuts({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cn('study-sidebar-picker-shortcuts', className)} />;
}

function Main({ className, ...props }: ComponentProps<'main'>) {
  return <main {...props} className={cn('study-content', className)} />;
}

function Topbar({
  parent,
  title,
  titleAction,
  children,
  ...props
}: Omit<ComponentProps<'header'>, 'title'> & {
  parent?: ReactNode;
  title: ReactNode;
  titleAction?: ReactNode;
}) {
  return (
    <header {...props} className={cn('study-workspace-header', props.className)}>
      {parent && (
        <>
          <span>{parent}</span>
          <span aria-hidden="true">/</span>
        </>
      )}
      {titleAction ? (
        <div className="study-workspace-title">
          <h1>{title}</h1>
          {titleAction}
        </div>
      ) : (
        <h1>{title}</h1>
      )}
      {children}
    </header>
  );
}

/** Exposes sidebar expansion with optional placement for hidden note navigation. */

function Toggle({
  label,
  expanded,
  placement = 'default',
  ...props
}: Omit<ComponentProps<typeof Button>, 'children'> & {
  label: string;
  expanded: boolean;
  placement?: 'default' | 'reveal';
}) {
  return (
    <Button
      {...props}
      className={cn(
        'study-sidebar-toggle',
        placement === 'reveal' && 'study-entry-navigation-toggle',
        props.className
      )}
      size="icon"
      variant="ghost-muted"
      aria-label={label}
      title={label}
      aria-expanded={expanded}
    >
      <PanelLeft aria-hidden="true" />
    </Button>
  );
}

function Utility({
  title,
  variant = 'ghost-muted',
  ...props
}: Omit<ComponentProps<typeof Button>, 'size'>) {
  const control = (
    <Button
      {...props}
      aria-label={props['aria-label'] ?? title}
      className={cn('study-sidebar-utility', props.className)}
      size="icon"
      variant={variant}
    />
  );

  return title ? (
    <Tooltip>
      <TooltipTrigger render={control} />
      <TooltipPopup>{title}</TooltipPopup>
    </Tooltip>
  ) : (
    control
  );
}

function Identity({ label }: { label: string }) {
  return (
    <span className="study-subject-mark" aria-hidden="true">
      {label.slice(0, 1).toLocaleUpperCase()}
    </span>
  );
}

function Switcher({
  icon,
  label,
  trailing,
  description,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children'> & {
  icon: ReactNode;
  label: ReactNode;
  trailing: ReactNode;
  description?: ReactNode;
}) {
  return (
    <Button
      {...props}
      className={cn('study-subject-switcher', props.className)}
      variant="ghost-muted"
    >
      <span className="study-subject-switcher-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="study-subject-name">
        <span className="study-subject-label">{label}</span>
        {description && <span className="study-subject-description">{description}</span>}
      </span>
      {trailing}
    </Button>
  );
}

function SearchField({
  clearLabel,
  onClear,
  ...props
}: InputProps & { clearLabel: string; onClear: () => void }) {
  return (
    <SharedSearchField
      {...props}
      className={cn('study-sidebar-search', props.className)}
      trailing={
        props.value ? (
          <Button size="icon-xs" variant="ghost-muted" aria-label={clearLabel} onClick={onClear}>
            <X aria-hidden="true" />
          </Button>
        ) : undefined
      }
    />
  );
}

function NoteActivity({ running, ...props }: ComponentProps<'span'> & { running?: boolean }) {
  return <span {...props} className="study-note-activity" data-running={running || undefined} />;
}

function NoteCount(props: ComponentProps<'span'>) {
  return <span {...props} className="study-note-page-count" />;
}

function NoteRowActions({
  className,
  placement = 'bottom',
  ...props
}: ComponentProps<'div'> & { placement?: 'top' | 'bottom' }) {
  return (
    <div
      {...props}
      data-placement={placement}
      className={cn('study-note-row-actions', className)}
    />
  );
}

function SettleAction(props: ComponentProps<typeof Button>) {
  return <Button {...props} size="sm" variant="ghost-muted" className="study-note-settle" />;
}

/** Floats contextual actions beside their sidebar without changing its list geometry. */

function SelectionBar({ ref, style, ...props }: ComponentProps<'div'>) {
  const anchor = useRef<HTMLSpanElement>(null);
  const element = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 64 });

  useImperativeHandle(ref, () => element.current!);
  useLayoutEffect(() => {
    const sidebar = anchor.current?.closest('.study-sidebar');
    const measure = () => {
      const width = element.current?.getBoundingClientRect().width || 440;
      const sidebarEnd = sidebar?.getBoundingClientRect().right ?? 0;
      const headerEnd =
        document.querySelector('.study-workspace-header')?.getBoundingClientRect().bottom ?? 52;
      const next = {
        left: Math.max(12, Math.min(sidebarEnd + 12, window.innerWidth - width - 12)),
        top: Math.max(12, headerEnd + 12)
      };

      setPosition((current) =>
        current.left === next.left && current.top === next.top ? current : next
      );
    };

    measure();
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);

    if (sidebar) observer?.observe(sidebar);

    if (element.current) observer?.observe(element.current);

    window.addEventListener('resize', measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <>
      <span ref={anchor} className="study-note-selection-anchor" aria-hidden="true" />
      {typeof document !== 'undefined' &&
        createPortal(
          <div
            {...props}
            ref={element}
            style={{ ...style, ...position }}
            className="study-note-selection-bar"
          />,
          document.body
        )}
    </>
  );
}

function SelectionCount({ count, label }: { count: number; label: string }) {
  return (
    <span className="study-note-selection-count" role="status" aria-label={label}>
      <span>{label}</span>
      <span aria-hidden="true">{count}</span>
    </span>
  );
}

function SettledRows(props: ComponentProps<'div'>) {
  return <div {...props} className="study-settled-rows" />;
}

function NoteMore(props: ComponentProps<typeof Button>) {
  return <Button {...props} size="sm" variant="ghost-muted" className="study-note-more" />;
}

function NoteEntry({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cn('study-note-entry', className)} />;
}

/** Cap expanded sections equally while letting short sections keep their natural height. */
function NoteGroups({ className, ref, ...props }: ComponentProps<'div'>) {
  const root = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => root.current!);
  useLayoutEffect(() => {
    const element = root.current;
    const boundary = element?.closest<HTMLElement>('.study-sidebar-scroll');

    if (!element || !boundary || typeof ResizeObserver === 'undefined') return;

    const resize = new ResizeObserver(measure);

    function measure() {
      if (!element || !boundary) return;

      const children = Array.from(element.children) as HTMLElement[];
      const groups = children.filter((child) => child.classList.contains('study-note-group'));
      const expanded = groups.filter(
        (group) => group.hasAttribute('open') && !group.hasAttribute('data-empty')
      );
      const fixed = reservedSectionSpace(boundary, children, expanded, resize);
      const share = Math.max(0, boundary.clientHeight - fixed) / Math.max(1, expanded.length);

      for (const group of groups) {
        const summary = group.querySelector<HTMLElement>(':scope > summary');
        const maximum = expanded.includes(group)
          ? Math.max(0, share - (summary?.getBoundingClientRect().height ?? 0))
          : 0;

        group.style.setProperty('--sidebar-group-content-max', `${maximum}px`);
      }
    }

    const mutations = new MutationObserver(measure);

    resize.observe(boundary);
    mutations.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open', 'data-empty']
    });
    measure();

    return () => {
      resize.disconnect();
      mutations.disconnect();
    };
  }, []);

  return <div {...props} ref={root} className={cn('study-note-groups', className)} />;
}

function reservedSectionSpace(
  boundary: HTMLElement,
  children: HTMLElement[],
  expanded: HTMLElement[],
  resize: ResizeObserver
) {
  const style = getComputedStyle(boundary);
  const gap = Number.parseFloat(style.rowGap) || 0;
  let fixed =
    (Number.parseFloat(style.paddingTop) || 0) +
    (Number.parseFloat(style.paddingBottom) || 0) +
    gap * Math.max(0, children.length - 1);

  for (const child of children) {
    const summary = child.querySelector<HTMLElement>(':scope > summary');
    const fixedElement = summary ?? child;

    resize.observe(fixedElement);

    if (!expanded.includes(child)) fixed += fixedElement.getBoundingClientRect().height;
  }

  return fixed;
}

type NoteGroupProps = {
  title: string;
  count: number;
  children: ReactNode;
  defaultOpen?: boolean;
  variant?: 'settled';
};

function NoteGroup(props: NoteGroupProps) {
  return props.variant === 'settled' ? (
    <SlidingNoteGroup {...props} />
  ) : (
    <NativeNoteGroup {...props} />
  );
}

function NativeNoteGroup({ title, count, children, defaultOpen = false, variant }: NoteGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="study-note-group"
      data-variant={variant}
      data-empty={count === 0 || undefined}
    >
      <summary aria-label={title}>
        <span>{title}</span>
        <span>{count}</span>
        <ChevronRight aria-hidden="true" />
      </summary>
      <div>{children}</div>
    </details>
  );
}

/** Keep native details mounted until the closing height transition has finished. */

function useSlidingDisclosure(defaultOpen: boolean) {
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState(defaultOpen);
  const phase = useRef<'idle' | 'opening' | 'closing'>('idle');
  const frame = useRef<number | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clear = () => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);

    if (timer.current !== undefined) clearTimeout(timer.current);
  };

  useEffect(() => clear, []);
  const finish = () => {
    if (phase.current !== 'closing') return;

    clear();
    phase.current = 'idle';
    setOpen(false);
  };
  const toggle = () => {
    clear();
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    if (expanded) {
      setExpanded(false);
      phase.current = 'closing';

      if (reduced) finish();
      else timer.current = setTimeout(finish, 220);

      return;
    }

    setOpen(true);
    phase.current = 'opening';

    if (reduced) {
      setExpanded(true);
      phase.current = 'idle';
    } else
      frame.current = requestAnimationFrame(() => {
        frame.current = requestAnimationFrame(() => {
          setExpanded(true);
          phase.current = 'idle';
        });
      });
  };

  return { open, expanded, toggle, finish };
}

function SlidingNoteGroup({ title, count, children, defaultOpen = false }: NoteGroupProps) {
  const disclosure = useSlidingDisclosure(defaultOpen);

  return (
    <details
      open={disclosure.open}
      className="study-note-group"
      data-variant="settled"
      data-empty={count === 0 || undefined}
    >
      <summary
        aria-label={title}
        aria-expanded={disclosure.expanded}
        onClick={(event) => {
          event.preventDefault();
          disclosure.toggle();
        }}
      >
        <span>{title}</span>
        <span>{count}</span>
        <ChevronRight aria-hidden="true" />
      </summary>
      <div
        className="study-note-group-slide"
        data-expanded={disclosure.expanded || undefined}
        onTransitionEnd={(event) => {
          if (event.target === event.currentTarget) disclosure.finish();
        }}
      >
        <div
          className="study-note-group-body"
          aria-hidden={!disclosure.expanded}
          inert={!disclosure.expanded}
        >
          {children}
        </div>
      </div>
    </details>
  );
}

function Item({
  label,
  layout = 'detailed',
  icon,
  context,
  timestamp,
  description,
  selection,
  render,
  className,
  ...props
}: useRender.ComponentProps<'button'> & {
  label: ReactNode;
  layout?: 'compact' | 'detailed' | 'summary';
  icon: ReactNode;
  context?: ReactNode;
  timestamp?: ReactNode;
  description?: ReactNode;
  selection?: boolean;
}) {
  return useRender({
    defaultTagName: 'button',
    render,
    props: {
      ...props,
      'data-layout': layout,
      'data-selecting': selection !== undefined || undefined,
      'aria-pressed': selection,
      type: render ? undefined : 'button',
      className: cn('study-note-row', className),
      children:
        layout !== 'detailed' ? (
          <>
            <span className="study-note-row-icon">{icon}</span>
            <span className="study-note-title">{label}</span>
            {description && <span className="study-item-kind">{description}</span>}
            {timestamp}
          </>
        ) : (
          <>
            <span className="study-note-meta">
              {icon}
              <span>{context}</span>
              {timestamp}
            </span>
            <span className="study-note-title">{label}</span>
            {description && <span className="study-item-kind">{description}</span>}
          </>
        )
    }
  });
}

type PickerProps<T> = {
  items: T[];
  value: T | null;
  getLabel: (item: T) => string;
  getValue: (item: T) => string;
  getDescription?: (item: T) => string | undefined;
  getIcon?: (item: T) => ReactNode;
  listLabel?: ReactNode;
  onValueChange: (item: T) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collapsed: boolean;
  label: string;
  fallbackIcon?: ReactNode;
  searchLabel: string;
  empty?: ReactNode;
  status?: ReactNode;
  children?: ReactNode;
};

function PickerSelection<T>({
  value,
  getLabel,
  label,
  fallbackIcon,
  getIcon
}: Pick<PickerProps<T>, 'value' | 'getLabel' | 'label' | 'fallbackIcon' | 'getIcon'>) {
  const selectedLabel = value ? getLabel(value) : label;
  const initial = selectedLabel.slice(0, 1).toLocaleUpperCase();

  return (
    <ComboboxTrigger
      aria-label={selectedLabel}
      title={selectedLabel}
      render={
        <Switcher
          icon={value ? (getIcon?.(value) ?? initial) : (fallbackIcon ?? initial)}
          label={selectedLabel}
          trailing={<ChevronDown className="study-subject-chevron" aria-hidden="true" />}
        />
      }
    />
  );
}

function PickerOption<T>({
  item,
  label,
  description,
  icon
}: {
  item: T;
  label: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <ComboboxItem value={item} aria-description={description} className="study-sidebar-picker-item">
      <span className="study-sidebar-picker-option">
        {icon ?? <Identity label={label} />}
        <span className="study-sidebar-picker-copy">
          <span className="study-sidebar-picker-name">{label}</span>
          {description && (
            <span className="study-sidebar-picker-description" aria-hidden="true">
              {description}
            </span>
          )}
        </span>
      </span>
    </ComboboxItem>
  );
}

/** Labels a nonempty picker group and announces its item count. */

function PickerHeading({ count, label }: { count: number; label?: ReactNode }) {
  if (!count || !label) return null;

  return (
    <div className="study-sidebar-picker-heading">
      <span>{label}</span>
      <span aria-hidden="true">{count}</span>
    </div>
  );
}

/** Provides searchable identity selection with controlled opening and optional management actions. */

function Picker<T>({
  items,
  value,
  getLabel,
  getValue,
  getDescription,
  getIcon,
  listLabel,
  onValueChange,
  open,
  onOpenChange,
  collapsed,
  label,
  fallbackIcon,
  searchLabel,
  empty,
  status,
  children
}: PickerProps<T>) {
  return (
    <Combobox
      items={items}
      value={value}
      itemToStringLabel={getLabel}
      itemToStringValue={getValue}
      isItemEqualToValue={(item, selected) => getValue(item) === getValue(selected)}
      onValueChange={(item) => {
        if (item) onValueChange(item);
      }}
      open={open}
      onOpenChange={onOpenChange}
    >
      <PickerSelection
        value={value}
        getLabel={getLabel}
        label={label}
        fallbackIcon={fallbackIcon}
        getIcon={getIcon}
      />
      <ComboboxPopup
        className="study-subject-menu"
        side={collapsed ? 'right' : 'bottom'}
        sideOffset={8}
      >
        <ComboboxSearchInput aria-label={searchLabel} placeholder={searchLabel} />
        {status}
        <PickerHeading count={items.length} label={listLabel} />
        <ComboboxEmpty>{empty}</ComboboxEmpty>
        <ComboboxList className="study-sidebar-picker-list">
          {(item: T) => (
            <PickerOption
              key={getValue(item)}
              item={item}
              label={getLabel(item)}
              description={getDescription?.(item)}
              icon={getIcon?.(item)}
            />
          )}
        </ComboboxList>
        {children && <SwitcherActions>{children}</SwitcherActions>}
      </ComboboxPopup>
    </Combobox>
  );
}

export const Sidebar = {
  Frame,
  Root,
  Header,
  Toolbar,
  Content,
  Footer,
  Navigation,
  NavigationItem,
  Items,
  Item,
  NoteGroup,
  NoteGroups,
  NoteMore,
  SettledRows,
  SelectionBar,
  SelectionCount,
  NoteEntry,
  NoteRowActions,
  NoteActivity,
  NoteCount,
  SettleAction,
  Message,
  Toggle,
  Utility,
  Switcher,
  Identity,
  Picker,
  SwitcherActions,
  PickerShortcuts,
  Search: SearchField,
  FormFields,
  Main,
  Topbar,
  ScreenReaderHeading
};

/** Preserve a page heading when note entry hides the visible topbar. */

function ScreenReaderHeading({ children, ...props }: ComponentProps<'h1'>) {
  return (
    <h1 {...props} className={cn('sr-only', props.className)}>
      {children}
    </h1>
  );
}
