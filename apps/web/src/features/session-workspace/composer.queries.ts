import type { SessionId, SourceId } from '@study/contracts/ids';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useI18n } from '../../lib/i18n';
import { toStudyError } from '../../lib/study-client/errors';
import { useAttachments } from './attachments';
import { acceptText, emptyDraft, prepareAsk } from './draft';
import type { Draft } from './draft';
import { ask, saveNote, selectionOptions, sessionKey } from './session-workspace.queries';
import type { AskInput, Selection } from './session-workspace.queries';

export function useComposer(id: SessionId) {
  const { t, locale } = useI18n();
  const cache = useQueryClient();
  const key = ['session-drafts', String(id), 'note'];
  const state = useQuery({
    queryKey: key,
    queryFn: () => emptyDraft,
    initialData: emptyDraft,
    staleTime: Infinity,
    gcTime: Infinity
  });
  const draft = state.data;
  const files = useAttachments(id);
  const sourceIds = files.items.flatMap((item) => (item.sourceId ? [item.sourceId] : []));
  const filesBlocked = files.items.some((item) => item.state !== 'ready');
  const selection = useQuery(selectionOptions(id));
  const dirtySelection = useQuery({
    queryKey: ['session-drafts', String(id), 'selection'],
    queryFn: () => null as Selection | null,
    initialData: null,
    staleTime: Infinity,
    gcTime: Infinity
  });
  const setDraft = (update: (previous: Draft) => Draft) =>
    cache.setQueryData<Draft>(key, (previous) => update(previous ?? emptyDraft));

  function accepted(text: string, ids: readonly SourceId[] = []) {
    files.accept(ids);
    setDraft((previous) => acceptText(previous, text));
    void cache.invalidateQueries({ queryKey: sessionKey(id) });
    void cache.invalidateQueries({ queryKey: ['sessions'] });
  }

  const ownership = {
    onMutate: () => setDraft((previous) => ({ ...previous, pending: true })),
    onSettled: () => setDraft((previous) => ({ ...previous, pending: false }))
  };
  const askMutation = useMutation({
    mutationKey: [...sessionKey(id), 'ask'],
    mutationFn: (input: AskInput) => ask(input),
    retry: false,
    ...ownership,
    onSuccess: (_, input) => accepted(input.text, input.sourceIds),
    onError: (error) =>
      setDraft((previous) => ({
        ...previous,
        askUnavailable: toStudyError(error).kind === 'not_found'
      }))
  });
  const noteMutation = useMutation({
    mutationKey: [...sessionKey(id), 'note'],
    mutationFn: (input: { text: string; sourceIds: readonly SourceId[] }) =>
      saveNote(id, input.text, input.sourceIds),
    retry: false,
    ...ownership,
    onSuccess: (_, input) => accepted(input.text, input.sourceIds)
  });
  const pending = !!draft.pending || askMutation.isPending || noteMutation.isPending;
  const blocked = pending || !!draft.askAttempt || draft.noteAttempt !== undefined;

  function submitAsk() {
    const current = cache.getQueryData<Draft>(key) ?? emptyDraft;

    if (!selection.data || dirtySelection.data || !readyToSubmit(current, sourceIds, filesBlocked))
      return;

    if (
      cache.getQueryData<Draft>(key)?.askAttempt ||
      cache.getQueryData<Draft>(key)?.noteAttempt !== undefined
    )
      return;

    const input = prepareAsk(
      current,
      {
        sessionId: id,
        sourceIds,
        expectedSelectionRevision: selection.data.revision,
        preferences: draft.preferences ?? { language: locale }
      },
      crypto.randomUUID()
    );

    setDraft((previous) => ({ ...previous, askAttempt: input }));
    askMutation.mutate(input);
  }

  function retryAsk(input: AskInput) {
    if (cache.getQueryData<Draft>(key)?.pending || cache.getQueryData<Draft>(key)?.askUnavailable)
      return;

    setDraft((previous) => ({ ...previous, pending: true }));
    askMutation.mutate(input);
  }

  function submitNote() {
    const current = cache.getQueryData<Draft>(key) ?? emptyDraft;

    if (filesBlocked || !hasContent(current.text, sourceIds)) return;

    if (current.pending || current.askAttempt || current.noteAttempt !== undefined) return;

    const text = current.text;

    setDraft((previous) => ({ ...previous, noteAttempt: text, noteSourceIds: sourceIds }));
    noteMutation.mutate({ text, sourceIds });
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
    dirtySelection,
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

function readyToSubmit(draft: Draft, sourceIds: readonly SourceId[], filesBlocked: boolean) {
  return hasContent(draft.text, sourceIds) && !draft.pending && !filesBlocked;
}
