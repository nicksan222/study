import { RegistryContext, useAtomValue } from '@effect/atom-react';
import type { NoteId, SourceId } from '@study/contracts';
import { rpc, useIndependentMutation } from '@study/contracts/react';
import { Effect } from 'effect';
import { Atom } from 'effect/reactivity';
import { useContext } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';
import { toStudyError } from '#client/lib/study-client/errors.ts';

import { useAttachments } from './attachments';
import { acceptText, emptyDraft, prepareAsk } from './draft';
import type { Draft } from './draft';
import { ask, saveNote } from './note-workspace.queries';
import type { AskInput } from './note-workspace.queries';

export const composerDraft = Atom.family((_id: NoteId) =>
  Atom.make<Draft>(emptyDraft).pipe(Atom.keepAlive)
);

export function useComposer(id: NoteId) {
  const { t, locale } = useI18n();
  const cache = useContext(RegistryContext);
  const atom = composerDraft(id);
  const draft = useAtomValue(atom);
  const files = useAttachments(id);
  const sourceIds = files.items.flatMap((item) => (item.sourceId ? [item.sourceId] : []));
  const filesBlocked = files.items.some((item) => item.state !== 'ready');
  const selection = rpc.notes.noteSelection.useQuery({ noteId: id });
  const setDraft = (update: (previous: Draft) => Draft) => cache.update(atom, update);

  function accepted(text: string, ids: readonly SourceId[] = []) {
    files.accept(ids);
    setDraft((previous) => acceptText(previous, text));
  }

  const askMutation = useIndependentMutation((input: AskInput) =>
    Effect.tryPromise({
      try: async () => {
        try {
          const result = await ask(input);

          accepted(input.text, input.sourceIds);

          return result;
        } catch (error) {
          setDraft((previous) => ({
            ...previous,
            askUnavailable: toStudyError(error).kind === 'not_found'
          }));

          throw error;
        } finally {
          setDraft((previous) => ({ ...previous, pending: false }));
        }
      },
      catch: toStudyError
    })
  );
  const noteMutation = useIndependentMutation(
    (input: { text: string; sourceIds: readonly SourceId[] }) =>
      Effect.tryPromise({
        try: async () => {
          try {
            const result = await saveNote(id, input.text, input.sourceIds);

            accepted(input.text, input.sourceIds);

            return result;
          } finally {
            setDraft((previous) => ({ ...previous, pending: false }));
          }
        },
        catch: toStudyError
      })
  );
  const pending = !!draft.pending || askMutation.isPending || noteMutation.isPending;
  const blocked = pending || !!draft.askAttempt || draft.noteAttempt !== undefined;

  function submitAsk() {
    const current = cache.get(atom);

    if (
      !selection.data ||
      !hasContent(current.text, sourceIds) ||
      current.pending ||
      filesBlocked ||
      current.askAttempt ||
      current.noteAttempt !== undefined
    )
      return;

    const input = prepareAsk(
      current,
      {
        noteId: id,
        sourceIds,
        expectedSelectionRevision: selection.data.revision,
        preferences: current.preferences ?? { language: locale }
      },
      crypto.randomUUID()
    );

    setDraft((previous) => ({ ...previous, askAttempt: input, pending: true }));
    void askMutation.mutate(input).catch(() => {});
  }

  function retryAsk(input: AskInput) {
    const current = cache.get(atom);

    if (current.pending || current.askUnavailable) return;

    setDraft((previous) => ({ ...previous, pending: true }));
    void askMutation.mutate(input).catch(() => {});
  }

  function submitNote() {
    const current = cache.get(atom);

    if (
      filesBlocked ||
      !hasContent(current.text, sourceIds) ||
      current.pending ||
      current.askAttempt ||
      current.noteAttempt !== undefined
    )
      return;

    setDraft((previous) => ({
      ...previous,
      pending: true,
      noteAttempt: current.text,
      noteSourceIds: sourceIds
    }));
    void noteMutation.mutate({ text: current.text, sourceIds }).catch(() => {});
  }

  return {
    id,
    t,
    locale,
    cache,
    draft,
    files,
    sourceIds,
    filesBlocked,
    setDraft,
    selection,
    askMutation,
    noteMutation,
    pending,
    blocked,
    submitNote,
    submitAsk,
    retryAsk
  };
}

function hasContent(text: string, sourceIds: readonly unknown[]) {
  return text.trim().length > 0 || sourceIds.length > 0;
}
