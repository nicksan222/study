import type { NoteId } from '@study/contracts';
import { WorkspaceCard } from '@study/ui';
import type { ReactNode } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { NotePendingWork } from './note-pending-work';

/** Presents note actions, history navigation, and background work. */
export function WorkspaceContext({
  id,
  actions,
  outline,
  hidden,
  onDismiss
}: {
  id: NoteId;
  actions?: ReactNode;
  outline?: ReactNode;
  hidden?: boolean;
  onDismiss?: () => void;
}) {
  const { t } = useI18n();

  return (
    <WorkspaceCard.Root
      aria-label={t('NoteContextPanel')}
      variant="context"
      hidden={hidden}
      onDismiss={onDismiss}
    >
      {actions}
      {outline}
      <NotePendingWork key={String(id)} id={id} />
    </WorkspaceCard.Root>
  );
}
