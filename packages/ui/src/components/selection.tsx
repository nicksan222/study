import { Search } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from './button';
import { DialogPopup, DialogTitle } from './dialog';
import { Input } from './input';
import { semanticPart as part } from './semantic-part';

function SelectionDialogPopup({
  contentLayout = 'reading',
  ...props
}: Omit<ComponentProps<typeof DialogPopup>, 'className' | 'viewportClassName'> & {
  contentLayout?: 'reading' | 'fill';
}) {
  return (
    <DialogPopup
      {...props}
      className="settings-popup ui-selection-dialog"
      data-content={contentLayout}
      viewportClassName="settings-viewport"
    />
  );
}

/** Searchable item navigation, archive previews, and retained content excerpts. */
export const SelectionSurface = {
  Popup: SelectionDialogPopup,
  SearchField,
  Item,
  More,
  Message: part('p', 'ui-selection-message'),
  Title: part(DialogTitle, 'sr-only'),
  Root: part('div', 'ui-selection'),
  Search: part('label', 'ui-selection-search'),
  Navigation: part('aside', 'settings-navigation ui-selection-navigation'),
  Main: part('div', 'settings-main'),
  Header: part('header', 'settings-header'),
  DetailHeading: part('div', 'ui-selection-detail-heading'),
  Scroll: part('div', 'settings-scroll'),
  Body: part('div', 'settings-body'),
  ArchiveFrame: part('div', 'ui-archive-frame'),
  ArchiveReading: part('div', 'ui-archive-reading'),
  ArchiveContent: part('div', 'ui-archive-content'),
  ArchiveContext: part('div', 'ui-archive-context'),
  ArchiveHighlight: part('div', 'ui-archive-highlight'),
  ArchivePlaceholder: part('div', 'ui-archive-placeholder'),
  ArchiveFooter: part('footer', 'ui-archive-footer'),
  ArchiveActions: part('div', 'ui-archive-actions'),
  DocumentActions: part('div', 'ui-selection-document-actions'),
  History: part('div', 'ui-selection-history'),
  Material: part('button', 'settings-navigation-item ui-selection-material'),
  Heading: part('div', 'ui-selection-heading'),
  Empty: part('div', 'ui-selection-empty'),
  Materials: part('ul', 'ui-selection-materials'),
  Disclosure: part('details', 'ui-selection-disclosure'),
  Editor: part('div', 'ui-selection-editor'),
  Content: part('div', 'ui-selection-content'),
  Excerpt: part('div', 'ui-selection-excerpt'),
  FullContent: part('div', 'ui-selection-full-content')
};

function SearchField({
  label,
  value,
  onValueChange
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <SelectionSurface.Search>
      <Search aria-hidden="true" />
      <Input
        unstyled
        type="search"
        aria-label={label}
        value={value}
        onValueChange={onValueChange}
      />
    </SelectionSurface.Search>
  );
}

function Item({
  label,
  description,
  icon,
  ...props
}: Omit<ComponentProps<'button'>, 'children' | 'className'> & {
  label: string;
  description?: ReactNode;
  icon: ReactNode;
}) {
  return (
    <button
      {...props}
      title={label}
      className="settings-navigation-item ui-selection-material ui-selection-item"
    >
      {icon}
      <span>
        <span>{label}</span>
        {description && <small>{description}</small>}
      </span>
    </button>
  );
}

function More({ pending, onLoad, label }: { pending: boolean; onLoad: () => void; label: string }) {
  return (
    <Button variant="ghost" disabled={pending} onClick={onLoad}>
      {label}
    </Button>
  );
}
