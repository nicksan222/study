import type { ComponentProps, ReactNode } from 'react';

import { Button } from './button';
import { DialogPopup } from './dialog';
import { semanticPart as part } from './semantic-part';
import { WorkspaceDeskSurface as Desk } from './workspace-desk';

import './source-content.css';

/** Shared chrome for retained sources in a notebook panel or standalone reader. */
export const SourceReader = {
  Root: part('section', 'source-reader'),
  Header: part('header', 'source-reader-header'),
  Title: part('h1', 'source-reader-title'),
  Actions: part('div', 'source-reader-actions'),
  DetailsPopup,
  Notes: part('div', 'source-reader-notes'),
  HistoryBody: part('div', 'source-history-body'),
  Versions: part('ol', 'source-history-versions'),
  Version: part(Button, 'source-history-version'),
  VersionCopy: part('span', 'source-history-version-copy'),
  VersionDate: part('time', 'source-history-version-date')
};

/** Retained content uses the same document surface as editable pages. */
export function SourceContent({ children }: { children: ReactNode }) {
  return <Desk.Editor>{children}</Desk.Editor>;
}

function DetailsPopup(props: Omit<ComponentProps<typeof DialogPopup>, 'className'>) {
  return <DialogPopup {...props} className="source-reader-popup" />;
}
