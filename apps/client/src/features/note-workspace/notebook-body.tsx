import type { NoteId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { Loading, WritingSurface } from '@study/ui';
import type { ReactNode } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { useBodyAutosave } from './body-autosave.queries';
import { NoteEditor } from './note-editor';
import { NoteTitleEdit } from './note-title';
import { SaveRecoveryNotice } from './save-recovery';
import { NoteReadError } from './status';

export function NotebookBody({ id, title }: { id: NoteId; title: string }) {
  const { t } = useI18n();
  const body = rpc.notes.body.useQuery({ noteId: id });
  const heading = <NoteTitleEdit id={id} title={title} />;

  if (body.data) return <NotebookWriting id={id} saved={body.data} heading={heading} />;

  return (
    <WritingSurface heading={heading}>
      {body.error ? (
        <NoteReadError error={body.error} retry={() => void body.refetch()} />
      ) : (
        <Loading label={t('LoadingStudy')} />
      )}
    </WritingSurface>
  );
}

function NotebookWriting({
  id,
  saved,
  heading
}: {
  id: NoteId;
  saved: Parameters<typeof useBodyAutosave>[1];
  heading: ReactNode;
}) {
  const { t } = useI18n();
  const { draft, focus, setText, retry, acceptSaved } = useBodyAutosave(id, saved);
  const status = draft.pending
    ? 'NoteAutosaving'
    : draft.text !== draft.saved.text
      ? 'NoteAutosavePending'
      : 'NoteAutosaved';

  return (
    <WritingSurface heading={heading} status={draft.error ? undefined : t(status)}>
      {!!draft.error && (
        <SaveRecoveryNotice conflict={!!draft.conflict} onAccept={acceptSaved} onRetry={retry} />
      )}
      <NoteEditor
        targetKey={id}
        value={draft.text}
        onChange={setText}
        restoreFocus={focus}
        variant="writing"
      />
    </WritingSurface>
  );
}
