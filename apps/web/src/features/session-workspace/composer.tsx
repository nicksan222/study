import { StudyError } from '@study/contracts/errors';
import type { SessionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { ComposerSurface } from '@study/ui/composer';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, SlidersHorizontal, Plus } from 'lucide-react';

import { useI18n } from '../../lib/i18n';
import { toStudyError } from '../../lib/study-client/errors';
import { Attachments, useAttachments } from './attachments';
import { acceptText, emptyDraft, prepareAsk } from './draft';
import type { Draft } from './draft';
import { ask, saveNote, selectionOptions, sessionKey } from './session-workspace.queries';
import type { AskInput, Selection } from './session-workspace.queries';
import { SessionError } from './status';
import { UnavailableAttempt } from './unavailable-attempt';

export function Composer({ id }: { id: SessionId }) {
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
  function accepted(text: string, ids: readonly import('@study/contracts/ids').SourceId[] = []) {
    files.accept(ids);
    setDraft((previous) => acceptText(previous, text));
    void cache.invalidateQueries({ queryKey: sessionKey(id) });
    void cache.invalidateQueries({ queryKey: ['sessions'] });
  }
  const askMutation = useMutation({
    mutationKey: [...sessionKey(id), 'ask'],
    mutationFn: (input: AskInput) => ask(input),
    retry: false,
    onMutate: () => setDraft((previous) => ({ ...previous, pending: true })),
    onSettled: () => setDraft((previous) => ({ ...previous, pending: false })),
    onSuccess: (_, input) => accepted(input.text, input.sourceIds),
    onError: (error) =>
      setDraft((previous) => ({
        ...previous,
        askUnavailable: toStudyError(error).kind === 'not_found'
      }))
  });
  const noteMutation = useMutation({
    mutationKey: [...sessionKey(id), 'note'],
    mutationFn: (input: {
      text: string;
      sourceIds: readonly import('@study/contracts/ids').SourceId[];
    }) => saveNote(id, input.text, input.sourceIds),
    retry: false,
    onMutate: () => setDraft((previous) => ({ ...previous, pending: true })),
    onSettled: () => setDraft((previous) => ({ ...previous, pending: false })),
    onSuccess: (_, input) => accepted(input.text, input.sourceIds)
  });
  const pending = !!draft.pending || askMutation.isPending || noteMutation.isPending;
  const blocked = pending || !!draft.askAttempt || draft.noteAttempt !== undefined;
  function submitAsk() {
    const current = cache.getQueryData<Draft>(key) ?? emptyDraft;
    if (
      !selection.data ||
      dirtySelection.data ||
      (!current.text.trim() && !sourceIds.length) ||
      current.pending ||
      filesBlocked
    )
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
    if (filesBlocked || (!current.text.trim() && !sourceIds.length)) return;
    if (current.pending || current.askAttempt || current.noteAttempt !== undefined) return;
    const text = current.text;
    setDraft((previous) => ({ ...previous, noteAttempt: text, noteSourceIds: sourceIds }));
    noteMutation.mutate({ text, sourceIds });
  }
  return (
    <ComposerSurface.Root
      className="session-composer"
      aria-label={t('SessionCompose')}
      onDragOver={(event) => {
        if (!blocked) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!blocked) files.add(Array.from(event.dataTransfer.files));
      }}
    >
      <label className="sr-only" htmlFor={`session-note-${id}`}>
        {t('SessionCompose')}
      </label>
      <ComposerSurface.Input
        id={`session-note-${id}`}
        rows={3}
        value={draft.text}
        onKeyDown={(event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key === 'Enter' &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            submitNote();
          }
        }}
        aria-describedby={`session-draft-help-${id}`}
        placeholder={t('SessionComposeHint')}
        onChange={(event) => {
          const text = event.target.value;
          setDraft((previous) => ({ ...previous, text }));
        }}
      />
      <ComposerSurface.Footer className="session-composer-footer">
        <Attachments id={id} blocked={blocked} />
        <details className="session-preferences">
          <summary title={t('SessionGenerationPreferences')}>
            <SlidersHorizontal size={16} aria-hidden="true" />
            <span className="sr-only">{t('SessionGenerationPreferences')}</span>
          </summary>
          <div className="session-actions" role="group" aria-label={t('SessionAnswerDetail')}>
            {(['brief', 'balanced', 'detailed'] as const).map((detail) => (
              <Button
                key={detail}
                size="sm"
                variant="ghost"
                aria-pressed={(draft.preferences?.detail ?? 'balanced') === detail}
                disabled={blocked}
                onClick={() =>
                  setDraft((previous) => ({
                    ...previous,
                    preferences: { language: locale, ...previous.preferences, detail }
                  }))
                }
              >
                {t(
                  detail === 'brief'
                    ? 'SessionDetailBrief'
                    : detail === 'balanced'
                      ? 'SessionDetailBalanced'
                      : 'SessionDetailDetailed'
                )}
              </Button>
            ))}
          </div>
        </details>
        <div className="session-actions">
          <Button
            size="sm"
            disabled={blocked || filesBlocked || (!draft.text.trim() && !sourceIds.length)}
            onClick={submitNote}
          >
            <Plus size={15} aria-hidden="true" />
            {t('SessionSaveNote')}
          </Button>
          <Button
            size="sm"
            variant="ghost-muted"
            disabled={
              blocked ||
              filesBlocked ||
              (!draft.text.trim() && !sourceIds.length) ||
              !selection.data ||
              !!dirtySelection.data
            }
            onClick={submitAsk}
          >
            {t('SessionAsk')}
            <Sparkles size={15} aria-hidden="true" />
          </Button>
        </div>
      </ComposerSurface.Footer>
      <ComposerSurface.Hint id={`session-draft-help-${id}`}>
        {t('SessionNotebookHint')}
      </ComposerSurface.Hint>
      {pending && <p role="status">{t('SessionSaving')}</p>}
      {dirtySelection.data && <p role="status">{t('SessionSelectionUnsaved')}</p>}
      {askMutation.error && !draft.askUnavailable && (
        <SessionError
          error={askMutation.error}
          retry={draft.askAttempt && !pending ? () => retryAsk(draft.askAttempt!) : undefined}
        />
      )}
      {draft.askAttempt && !pending && !askMutation.error && !draft.askUnavailable && (
        <Button variant="outline" onClick={() => retryAsk(draft.askAttempt!)}>
          {t('SessionRetryAsk')}
        </Button>
      )}
      {draft.askAttempt && !pending && !draft.askUnavailable && (
        <p className="session-muted">{t('SessionAskRetryHelp')}</p>
      )}
      {draft.askAttempt && draft.askUnavailable && (
        <UnavailableAttempt
          key={draft.askAttempt.intentKey}
          id={id}
          busy={pending}
          onAbandon={() => {
            setDraft((previous) =>
              previous.pending || previous.askAttempt?.intentKey !== draft.askAttempt?.intentKey
                ? previous
                : { ...previous, askAttempt: undefined, askUnavailable: undefined }
            );
            askMutation.reset();
          }}
        />
      )}
      {askMutation.error instanceof StudyError && askMutation.error.kind === 'invalid_input' && (
        <Button
          variant="ghost"
          onClick={() => {
            setDraft((previous) => ({ ...previous, askAttempt: undefined }));
            askMutation.reset();
            void selection.refetch();
          }}
        >
          {t('SessionReviewConflict')}
        </Button>
      )}
      {draft.noteAttempt !== undefined && !pending && (
        <>
          {noteMutation.error && <SessionError error={noteMutation.error} />}
          <p>{t('SessionNoteUncertain')}</p>
          <Button
            variant="outline"
            onClick={() => {
              setDraft((previous) => ({ ...previous, noteAttempt: undefined }));
              noteMutation.reset();
              void cache.invalidateQueries({ queryKey: [...sessionKey(id), 'thread'] });
            }}
          >
            {t('SessionReviewedHistory')}
          </Button>
        </>
      )}
    </ComposerSurface.Root>
  );
}
