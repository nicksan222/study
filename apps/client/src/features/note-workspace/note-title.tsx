import type { NoteId } from '@study/contracts';
import { WritingTitle } from '@study/ui';
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { useNoteTitle } from './note-title.queries';
import { NoteError } from './status';

export function NoteTitleEdit({ id, title }: { id: NoteId; title: string }) {
  const { t } = useI18n();
  const rename = useNoteTitle(id);
  const [draft, setDraft] = useState<string>();

  return (
    <>
      <WritingTitle
        aria-label={t('NoteName')}
        value={draft ?? title}
        placeholder={t('NoteUntitled')}
        maxLength={200}
        readOnly={rename.isPending}
        onChange={(event) => setDraft(event.currentTarget.value.replace(/\n/g, ' '))}
        onBlur={() => {
          if (rename.isPending) return;

          const next = draft?.trim();

          if (!next || next === title) {
            setDraft(undefined);

            return;
          }

          setDraft(next);
          void rename.mutate(next).then(
            () => setDraft(undefined),
            () => {}
          );
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;

          event.preventDefault();
          event.currentTarget.blur();
        }}
      />
      {rename.error && <NoteError error={rename.error} />}
    </>
  );
}
