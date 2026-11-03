import { Button } from '@study/ui/button';
import { Dialog, DialogPopup, DialogTitle, DialogClose } from '@study/ui/dialog';
import { cn } from '@study/ui/utils';
import { Search as SearchIcon, X, ChevronRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ReactNode, KeyboardEvent } from 'react';

import { semanticPart } from './semantic-part';
import { SettingsGroup, SettingsRow } from './settings-group';

function Root({
  open,
  onClose,
  title,
  section,
  icon,
  closeLabel,
  search,
  navigation,
  children
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  section: string;
  icon: ReactNode;
  closeLabel: string;
  search?: ReactNode;
  navigation?: ReactNode;
  children: ReactNode;
}) {
  const popup = useRef<HTMLDivElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogPopup
        closeLabel={closeLabel}
        bottomStickOnMobile={false}
        className="settings-popup"
        viewportClassName="settings-viewport"
        ref={popup}
        initialFocus={popup}
        showCloseButton={false}
      >
        <aside className="settings-navigation">
          <DialogTitle className="sr-only">{title}</DialogTitle>
          {search}
          {navigation ?? (
            <nav aria-label={title}>
              <span className="settings-navigation-item" aria-current="page">
                {icon}
                {section}
              </span>
            </nav>
          )}
        </aside>
        <div className="settings-main">
          <header className="settings-header">
            <span>{title}</span>
            <span aria-hidden="true">/</span>
            <h2>{section}</h2>
            <DialogClose
              className="settings-close"
              aria-label={closeLabel}
              render={<Button size="icon-sm" variant="ghost" />}
            >
              <X aria-hidden="true" />
            </DialogClose>
          </header>
          <div className="settings-scroll">
            <div className="settings-body">{children}</div>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

type NavigationItem<Id extends string> = { id: Id; label: string; icon: ReactNode };

function Navigation<Id extends string>({
  label,
  items,
  value,
  onValueChange
}: {
  label: string;
  items: readonly NavigationItem<Id>[];
  value: Id;
  onValueChange: (id: Id) => void;
}) {
  return (
    <nav className="settings-nav" aria-label={label}>
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          className="settings-navigation-item"
          aria-label={item.label}
          aria-current={item.id === value ? 'page' : undefined}
          onClick={() => onValueChange(item.id)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function SearchResults<Id extends string>({
  title,
  items,
  empty,
  onSelect
}: {
  title: string;
  items: readonly NavigationItem<Id>[];
  empty: string;
  onSelect: (id: Id) => void;
}) {
  return (
    <section className="settings-search-results" aria-label={title}>
      <h3>{title}</h3>
      {items.length ? (
        items.map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            layout="navigation"
            onClick={() => onSelect(item.id)}
          >
            {item.icon}
            {item.label}
          </Button>
        ))
      ) : (
        <p role="status">{empty}</p>
      )}
    </section>
  );
}

/** Groups related settings under a heading with optional section actions. */
function Section({
  title,
  actions,
  children,
  className,
  variant = 'default'
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'color-scheme' | 'theme-library' | 'interface';
}) {
  return (
    <section
      className={cn('settings-section', variant !== 'default' && `settings-${variant}`, className)}
    >
      <div className="settings-section-header">
        <h3>{title}</h3>
        {actions && <div className="settings-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Provides a keyboard-accessible drill-in row inside a shared settings group. */
function Item({
  label,
  description,
  icon,
  onClick
}: {
  label: string;
  description?: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className="settings-drilldown-item" aria-label={label} onClick={onClick}>
      <span className="settings-drilldown-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="settings-drilldown-copy">
        <span className="settings-drilldown-label">{label}</span>
        {description && <span className="settings-drilldown-description">{description}</span>}
      </span>
      <ChevronRight aria-hidden="true" />
    </button>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="settings-grid">{children}</div>;
}

function ChoiceGroup({ label, children }: { label: string; children: ReactNode }) {
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

    if (!keys.includes(event.key)) return;

    const choices = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')
    );
    const current = choices.indexOf(event.target as HTMLButtonElement);

    if (current < 0) return;

    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? choices.length - 1
          : (current +
              (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) +
              choices.length) %
            choices.length;

    choices[next]?.focus();
    choices[next]?.click();
  }

  return (
    <div tabIndex={-1} role="radiogroup" aria-label={label} onKeyDown={navigate}>
      <Grid>{children}</Grid>
    </div>
  );
}

function Choice({
  label,
  selected,
  disabled,
  onSelect,
  children
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      onClick={onSelect}
      className={cn('settings-choice', selected && 'settings-selected')}
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

function ThemeCard({
  name,
  selected,
  disabled,
  onSelect,
  preview,
  actions
}: {
  name: string;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  preview: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="settings-theme-card">
      <button
        type="button"
        className="settings-theme-select"
        aria-label={name}
        aria-pressed={selected}
        disabled={disabled}
        onClick={onSelect}
      >
        <span className="settings-theme-preview">{preview}</span>
        <span className="settings-theme-name">{name}</span>
      </button>
      {actions && <div className="settings-theme-actions">{actions}</div>}
    </div>
  );
}

function Search({
  label,
  placeholder,
  value,
  onChange
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusSearch = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;

      const target = event.target;

      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, [role="textbox"]'))
      )
        return;

      event.preventDefault();
      input.current?.focus();
    };

    document.addEventListener('keydown', focusSearch);

    return () => document.removeEventListener('keydown', focusSearch);
  }, []);

  return (
    <label className="settings-search">
      <SearchIcon aria-hidden="true" />
      <input
        ref={input}
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !value) return;

          event.preventDefault();
          event.stopPropagation();
          onChange('');
        }}
      />
      <kbd aria-hidden="true">/</kbd>
    </label>
  );
}

function Empty({
  children,
  title,
  icon
}: {
  children: ReactNode;
  title?: string;
  icon?: ReactNode;
}) {
  return (
    <div role="status" className="settings-empty">
      {icon}
      <div>
        {title && <strong>{title}</strong>}
        <p>{children}</p>
      </div>
    </div>
  );
}

/** Presents a settings status with an optional recovery action. */
function Status({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="mb-6 flex items-center justify-between gap-4 text-sm">
      <span>{children}</span>
      {action}
    </div>
  );
}

export const Settings = {
  Intro: semanticPart('p', 'settings-intro'),
  Feedback: semanticPart('p', 'settings-feedback'),
  Item,
  Navigation,
  SearchResults,
  Group: SettingsGroup,
  Row: SettingsRow,
  Root,
  Search,
  Section,
  Status,
  Empty,
  Grid,
  ChoiceGroup,
  Choice,
  ThemeCard
};
