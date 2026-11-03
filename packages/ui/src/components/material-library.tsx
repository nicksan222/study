import type { ComponentProps } from 'react';

import { semanticPart } from './semantic-part';

import './material-library.css';

export const MaterialLibrary = {
  HistorySection: semanticPart('section', 'reader-history'),
  History: semanticPart('details', 'reader-history'),
  Notice: semanticPart('section', 'reader-notice'),
  Actions: semanticPart('div', 'material-actions'),
  ExportActions: semanticPart('div', 'reader-export-actions'),
  ExportStatus: semanticPart('p', 'reader-export-status'),
  Import: semanticPart('div', 'library-import'),
  Root: semanticPart('div', 'material-library'),
  Heading: semanticPart('header', 'material-heading'),
  FocusHeading: semanticPart('h2', 'library-focus-anchor'),
  Filter: semanticPart('div', 'library-filter'),
  NoticeAside: semanticPart('aside', 'reader-notice'),
  Empty: semanticPart('section', 'library-empty'),
  Rows: semanticPart('ul', 'material-rows'),
  RowTitle: semanticPart('span', 'material-row-title'),
  RowMeta: semanticPart('span', 'material-row-meta'),
  ImportForm: semanticPart('form', 'library-import'),
  Reader: semanticPart('div', 'material-reader'),
  ReaderToolbar: semanticPart('header', 'reader-toolbar'),
  Lifecycle: semanticPart('details', 'reader-history reader-lifecycle'),
  VersionToolbar: semanticPart('div', 'reader-version-toolbar'),
  VersionMeta: semanticPart('p', 'material-row-meta'),
  Document: semanticPart('article', 'reader-document'),
  NoticeText: semanticPart('p', 'reader-notice'),
  ProseContent: semanticPart('div', 'material-prose'),
  ProseDetails: semanticPart('dl', 'material-prose'),
  ProseList: semanticPart('ol', 'material-prose'),
  Math: semanticPart('pre', 'reader-math'),
  Table: semanticPart('div', 'reader-table'),
  Prose,
  Search: semanticPart('section', 'library-search'),
  SearchForm: semanticPart('form', 'material-actions')
};

function Prose({
  fontSize,
  style,
  ...props
}: Omit<ComponentProps<'article'>, 'className'> & { fontSize?: number }) {
  return <article {...props} className="material-prose" style={{ ...style, fontSize }} />;
}
