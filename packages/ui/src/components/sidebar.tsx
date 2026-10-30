import { useRender } from '@base-ui/react/use-render';
import { Button } from '@study/ui/button';
import {
  Combobox,
  ComboboxTrigger,
  ComboboxPopup,
  ComboboxInput,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty
} from '@study/ui/combobox';
import { Input } from '@study/ui/input';
import type { InputProps } from '@study/ui/input';
import { Tooltip, TooltipTrigger, TooltipPopup } from '@study/ui/tooltip';
import { cn } from '@study/ui/utils';
import { PanelLeft, Search, X, ChevronsUpDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';

function Frame({
  collapsed,
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
      className={cn('study-shell', className)}
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

function Root({ className, ...props }: ComponentProps<'aside'>) {
  return <aside {...props} className={cn('study-sidebar', className)} />;
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

function Items({ className, ...props }: ComponentProps<'nav'>) {
  return <nav {...props} className={cn('study-session-list', className)} />;
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

function Main({ className, ...props }: ComponentProps<'main'>) {
  return <main {...props} className={cn('study-content', className)} />;
}

function Topbar({
  parent,
  title,
  children,
  ...props
}: Omit<ComponentProps<'header'>, 'title'> & { parent?: ReactNode; title: ReactNode }) {
  return (
    <header {...props} className={cn('study-workspace-header', props.className)}>
      {parent && (
        <>
          <span>{parent}</span>
          <span aria-hidden="true">/</span>
        </>
      )}
      <h1>{title}</h1>
      {children}
    </header>
  );
}

function Toggle({
  label,
  expanded,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children'> & { label: string; expanded: boolean }) {
  return (
    <Button
      {...props}
      className={cn('study-sidebar-toggle', props.className)}
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

function Switcher({
  icon,
  label,
  trailing,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children'> & {
  icon: ReactNode;
  label: ReactNode;
  trailing: ReactNode;
}) {
  return (
    <Button
      {...props}
      className={cn('study-subject-switcher', props.className)}
      variant="ghost-muted"
    >
      <span className="study-subject-mark" aria-hidden="true">
        {icon}
      </span>
      <span className="study-subject-name">{label}</span>
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
    <div className="study-sidebar-search">
      <Search aria-hidden="true" />
      <Input {...props} unstyled type="search" />
      {props.value && (
        <Button size="icon-xs" variant="ghost-muted" aria-label={clearLabel} onClick={onClear}>
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

function Item({
  label,
  icon,
  context,
  timestamp,
  description,
  render,
  className,
  ...props
}: useRender.ComponentProps<'button'> & {
  label: ReactNode;
  icon: ReactNode;
  context?: ReactNode;
  timestamp?: ReactNode;
  description?: ReactNode;
}) {
  return useRender({
    defaultTagName: 'button',
    render,
    props: {
      ...props,
      type: render ? undefined : 'button',
      className: cn('study-session-row', className),
      children: (
        <>
          <span className="study-session-meta">
            {icon}
            <span>{context}</span>
            {timestamp}
          </span>
          <span className="study-session-title">{label}</span>
          {description && <span className="study-item-kind">{description}</span>}
        </>
      )
    }
  });
}

function Picker<T>({
  items,
  value,
  getLabel,
  getValue,
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
}: {
  items: T[];
  value: T | null;
  getLabel: (item: T) => string;
  getValue: (item: T) => string;
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
}) {
  const selectedLabel = value ? getLabel(value) : label;

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
      <ComboboxTrigger
        aria-label={selectedLabel}
        render={
          <Switcher
            icon={
              value
                ? selectedLabel.slice(0, 1).toLocaleUpperCase()
                : (fallbackIcon ?? selectedLabel.slice(0, 1).toLocaleUpperCase())
            }
            label={selectedLabel}
            trailing={<ChevronsUpDown className="study-subject-chevron" aria-hidden="true" />}
          />
        }
      />
      <ComboboxPopup
        className="study-subject-menu"
        side={collapsed ? 'right' : 'bottom'}
        sideOffset={8}
      >
        <div className="study-sidebar-picker-search">
          <ComboboxInput aria-label={searchLabel} placeholder={searchLabel} />
        </div>
        {status}
        <ComboboxEmpty>{empty}</ComboboxEmpty>
        <ComboboxList className="study-sidebar-picker-list">
          {(item: T) => (
            <ComboboxItem key={getValue(item)} value={item} className="study-sidebar-picker-item">
              <span className="study-sidebar-picker-option">
                <span className="study-subject-mark" aria-hidden="true">
                  {getLabel(item).slice(0, 1).toLocaleUpperCase()}
                </span>
                <span>{getLabel(item)}</span>
              </span>
            </ComboboxItem>
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
  Items,
  Item,
  Message,
  Toggle,
  Utility,
  Switcher,
  Picker,
  SwitcherActions,
  Search: SearchField,
  FormFields,
  Main,
  Topbar
};
