import { semanticPart as part } from './semantic-part';

/** Searchable item navigation, archive previews, and retained content excerpts. */
export const SelectionSurface = {
  Root: part('div', 'ui-selection'),
  Search: part('label', 'ui-selection-search'),
  Navigation: part('aside', 'settings-navigation ui-selection-navigation'),
  Main: part('div', 'settings-main'),
  Header: part('header', 'settings-header'),
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
