import { NextVersionIcon, PreviousVersionIcon } from '@study/icons';
import type { ComponentProps } from 'react';

import { Button } from './button';
import { DialogPopup } from './dialog';
import { IconButton } from './icon-button';
import { semanticPart as part } from './semantic-part';
import { WorkspaceDeskSurface as Desk } from './workspace-desk';

import './source-content.css';
import './source-attachment-preview.css';

/** Shared chrome for retained sources in a notebook panel or standalone reader. */
export const SourceReader = {
  Root: part('section', 'source-reader'),
  Header: part('header', 'source-reader-header'),
  Title: part('h1', 'source-reader-title'),
  Actions: part('div', 'source-reader-actions'),
  Editor: part('div', 'source-reader-editor'),
  Views: part('div', 'source-reader-views'),
  Original: part('div', 'source-reader-original'),
  OriginalText,
  Details: part('dl', 'source-reader-details'),
  Detail,
  Pdf: part('div', 'source-reader-pdf'),
  PdfControls: part('div', 'source-reader-pdf-controls'),
  PageStepper,
  AttachmentPreview: part('section', 'source-attachment-preview'),
  AttachmentPaper: part('div', 'source-attachment-paper'),
  AttachmentNotice: part('p', 'source-attachment-notice'),
  PdfViewport,
  DetailsPopup,
  Notes: part('div', 'source-reader-notes'),
  HistoryBody: part('div', 'source-history-body'),
  Versions: part('ol', 'source-history-versions'),
  Version: part(Button, 'source-history-version'),
  VersionCopy: part('span', 'source-history-version-copy'),
  VersionDate: part('time', 'source-history-version-date')
};

/** Retained content uses the same document surface as editable pages. */
export const SourceContent = Desk.Editor;

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function OriginalText({
  fontSize,
  code,
  children
}: Pick<ComponentProps<'pre'>, 'children'> & { fontSize: number; code: boolean }) {
  return (
    <pre className="source-reader-original-text" data-code={code || undefined} style={{ fontSize }}>
      {children}
    </pre>
  );
}

function PageStepper({
  label,
  previousLabel,
  nextLabel,
  position,
  page,
  total,
  onPageChange
}: {
  label: string;
  previousLabel: string;
  nextLabel: string;
  position: string;
  page: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div role="group" aria-label={label}>
      <IconButton
        size="icon-sm"
        label={previousLabel}
        aria-disabled={page === 1}
        onClick={() => onPageChange(Math.max(1, page - 1))}
      >
        <PreviousVersionIcon aria-hidden="true" />
      </IconButton>
      <output>{position}</output>
      <IconButton
        size="icon-sm"
        label={nextLabel}
        aria-disabled={page === total}
        onClick={() => onPageChange(Math.min(total, page + 1))}
      >
        <NextVersionIcon aria-hidden="true" />
      </IconButton>
    </div>
  );
}

function PdfViewport(props: ComponentProps<'section'>) {
  // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The PDF scroll region must be reachable by keyboard.
  return <section {...props} tabIndex={0} className="source-reader-pdf-viewport" />;
}

function DetailsPopup(props: Omit<ComponentProps<typeof DialogPopup>, 'className'>) {
  return <DialogPopup {...props} className="source-reader-popup" />;
}
