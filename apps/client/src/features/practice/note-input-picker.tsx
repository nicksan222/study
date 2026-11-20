import type { ContentInput, NoteId, ProjectId } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { ErrorState, Loading, RetryButton, Settings } from '@study/ui';
import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

import {
  CursorWindowActions,
  useCursorRecovery,
  useCursorWindow
} from '#client/lib/cursor-window.tsx';
import { useNativeAction } from '#client/lib/effect/native.ts';
import { useI18n } from '#client/lib/i18n.tsx';

type NoteInput = Extract<ContentInput, { kind: 'note' }>;

export function NoteInputPicker({
  project,
  inputs,
  onChange,
  disabled,
  onCapturePending
}: {
  project: ProjectId;
  inputs: ContentInput[];
  onChange: Dispatch<SetStateAction<ContentInput[]>>;
  disabled: boolean;
  onCapturePending: (pending: boolean) => void;
}) {
  const { t } = useI18n();
  const [captures, setCaptures] = useState<ReadonlyMap<NoteId, NoteInput>>(() => new Map());
  const window = useCursorWindow<NonNullable<Parameters<typeof rpc.notes.list.read>[0]['before']>>(
    String(project)
  );
  const notes = rpc.notes.list.useQuery({
    project,
    limit: window.limit,
    before: window.cursor
  });
  const capture = useNativeAction(async (noteId: NoteId) => {
    const input = await rpc.notes.captureStudyEvidence.call({ noteId, projectId: project });

    setCaptures((previous) => new Map(previous).set(noteId, input));
    onChange((previous) => (previous.length < 20 ? [...previous, input] : previous));

    return input;
  });

  function captureNote(noteId: NoteId) {
    onCapturePending(true);
    void capture
      .mutateAsync(noteId)
      .catch(() => undefined)
      .finally(() => onCapturePending(false));
  }

  useCursorRecovery(window, notes.error);

  const change = (noteId: NoteId, checked: boolean, captured?: NoteInput) => {
    if (!checked && captured) {
      onChange((previous) =>
        previous.filter((input) => input.kind !== 'note' || input.contextId !== captured.contextId)
      );
    } else if (checked && captured) {
      onChange((previous) => (previous.length < 20 ? [...previous, captured] : previous));
    } else if (checked) captureNote(noteId);
  };

  return (
    <Settings.Section title={t('Notes')}>
      {notes.isPending && <Loading label={t('LoadingStudy')} layout="panel" />}
      {notes.isError && (
        <ErrorState
          layout="inline"
          title={t('QuizInputsError')}
          action={<RetryButton label={t('Retry')} onClick={() => void notes.refetch()} />}
        />
      )}
      {capture.isError && <ErrorState layout="inline" title={t('QuizInputsError')} />}
      <Settings.Group>
        {notes.data?.items.map((note) => {
          const captured = captures.get(note.id);
          const selected =
            !!captured &&
            inputs.some((input) => input.kind === 'note' && input.contextId === captured.contextId);

          return (
            <Settings.ToggleRow
              key={String(note.id)}
              title={note.title || t('NoteUntitled')}
              checked={selected}
              disabled={disabled || capture.isPending || (!selected && inputs.length >= 20)}
              onCheckedChange={(checked) => change(note.id, checked, captured)}
            />
          );
        })}
      </Settings.Group>
      {notes.isSuccess && !notes.data?.items.length && (
        <Settings.Feedback>{t('PagesNoNotes')}</Settings.Feedback>
      )}
      <CursorWindowActions
        {...window}
        hasMore={!!notes.data?.next}
        pending={notes.isFetching}
        more={() => window.more(notes.data?.next)}
      />
    </Settings.Section>
  );
}
