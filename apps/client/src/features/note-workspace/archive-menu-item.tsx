import type { NoteId, NoteArchiveTarget } from '@study/contracts';
import { ArchiveIcon } from '@study/icons';
import { ContextMenuItem } from '@study/ui';

import { useI18n } from '#client/lib/i18n.tsx';

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
        <ArchiveIcon aria-hidden="true" />
        {t('NoteArchive')}
      </ContextMenuItem>
      {archive.error && <NoteError error={archive.error} />}
    </>
  );
}
