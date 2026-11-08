import type { NoteId } from '@study/contracts/ids';
import type { NoteArchiveTarget } from '@study/contracts/notes/archive';
import { ContextMenuItem } from '@study/ui/context-menu';
import { Archive } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';

import { useItemArchive } from './archive.queries';
import { NoteError } from './status';

export function ArchiveMenuItem({
  noteId,
  target,
  disabled = false
}: {
  noteId: NoteId;
  target: NoteArchiveTarget;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const archive = useItemArchive(noteId, target);

  return (
    <>
      <ContextMenuItem disabled={disabled || archive.pending} onClick={() => archive.change(true)}>
        <Archive aria-hidden="true" />
        {t('NoteArchive')}
      </ContextMenuItem>
      {archive.error && <NoteError error={archive.error} />}
    </>
  );
}
