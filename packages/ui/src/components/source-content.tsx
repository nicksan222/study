import type { ReactNode } from 'react';

import { Button } from './button';
import { WorkspaceDeskSurface as Desk } from './workspace-desk';

/** The source reader's edit-copy action and retained content surface. */
export function SourceContent({
  copyLabel,
  pending,
  onCopy,
  children
}: {
  copyLabel: string;
  pending: boolean;
  onCopy: () => void;
  children: ReactNode;
}) {
  return (
    <Desk.Editor>
      <Button size="sm" variant="outline" disabled={pending} onClick={onCopy}>
        {copyLabel}
      </Button>
      {children}
    </Desk.Editor>
  );
}
