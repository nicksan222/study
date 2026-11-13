import { StudyError } from '@study/contracts/errors';
import type { NoteId, PageVersionId } from '@study/contracts/ids';
import type { noteGenerationSchema } from '@study/contracts/notes/rpc';
import { LoadMoreButton } from '@study/ui/action-button';
import { RetryButton } from '@study/ui/action-button';
import { Button } from '@study/ui/button';
import { Disclosure } from '@study/ui/disclosure';
import { Input } from '@study/ui/input';
import { Notebook } from '@study/ui/note-workspace';
import { StatusMessage } from '@study/ui/status-message';
import { Textarea } from '@study/ui/textarea';
import { WorkspaceSurface } from '@study/ui/workspace';
import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient
} from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect } from 'react';

import { AiActionButton as AiButton } from '#client/lib/ai-action-button.tsx';
import { AiReadinessNotice } from '#client/lib/ai-readiness-notice.tsx';
import { useAiReadiness } from '#client/lib/ai-readiness.ts';
import { useI18n } from '#client/lib/i18n.tsx';
import { toStudyError } from '#client/lib/study-client/errors.ts';
import { pageVersionOptions, invalidatePages } from '#client/lib/study-client/pages.queries.ts';

import { AgentProgress } from '../agent-progress';
import { ProposalReview } from '../document-editing';
import { CapturedContext } from './history';
import {
  executionOptions,
  generationOptions,
  selectionOptions,
  noteGenerationsOptions,
  noteKey,
  noteOptions
} from './note-workspace.queries';
import type { SelectedNote } from './page-creation-dialog';
import { ExecutionStatus, NoteError, NoteReadError } from './status';
import { TransformSuggestion } from './transform-suggestion';
import {
  transformDraftOptions,
  transformAttemptOptions,
  transformRetryOptions,
  cancelTransformOptions,
  retryTransformOptions
} from './transformation.queries';
import type { Attempt, TransformDraft } from './transformation.queries';
import { UnavailableAttempt } from './unavailable-attempt';

const operations = [
  ['clarity', 'NoteOpClarity'],
  ['grammar', 'NoteOpGrammar'],
  ['structure', 'NoteOpStructure'],
  ['combine', 'NoteOpCombine'],
  ['deduplicate', 'NoteOpDeduplicate'],
  ['summarize', 'NoteOpSummarize'],
  ['explain', 'NoteOpExplain'],
  ['expand', 'NoteOpExpand'],
  ['translate', 'NoteOpTranslate'],
  ['factual_correction', 'NoteOpCorrect']
] as const;

function useTransformation(
  id: NoteId,
  notes?: readonly SelectedNote[],
  onStarted?: () => void,
  active = true
) {
  const { t, locale } = useI18n();
  const readiness = useAiReadiness('medium');
  const suggestionReadiness = useAiReadiness('tiny');
  const cache = useQueryClient();
  const additionalNoteIds = [
    ...new Set(notes?.map((note) => note.id).filter((value) => value !== id) ?? [])
  ];
  const options = transformDraftOptions(id, additionalNoteIds);
  const key = options.queryKey;
  const initial: TransformDraft = { title: '', instruction: '', operations: ['clarity'] };
  const state = useQuery(options);
  const draft = state.data;
  const setDraft = (patch: Partial<TransformDraft>) =>
    cache.setQueryData<TransformDraft>(key, (previous) => ({
      ...(previous ?? initial),
      ...patch,
      titleRevision: (previous?.titleRevision ?? 0) + (patch.title !== undefined ? 1 : 0),
      instructionRevision:
        (previous?.instructionRevision ?? 0) + (patch.instruction !== undefined ? 1 : 0)
    }));
  const selection = useQuery(selectionOptions(id));
  const contextIds = [id, ...additionalNoteIds];
  const contextNotes = useQueries({ queries: contextIds.map(noteOptions) });
  const contextSelections = useQueries({ queries: contextIds.map(selectionOptions) });
  const suggestionIdentity = JSON.stringify([
    key,
    locale,
    active,
    contextNotes.map((query) => query.data?.updatedAt?.toString()),
    contextSelections.map((query) => query.data?.revision.toString())
  ]);
  const submit = useMutation({
    retry: false,
    onError: (error) => setDraft({ unavailable: toStudyError(error).kind === 'not_found' }),
    onSettled: () => setDraft({ pending: false }),
    ...transformAttemptOptions(
      id,
      (contextId) => setDraft({ contextId }),
      (result, contextId) => {
        cache.setQueryData<TransformDraft>(key, (previous) => ({
          ...(previous ?? initial),
          requestId: result.id,
          runs: [
            ...(previous?.runs ?? []).filter((run) => run.id !== result.id),
            { id: result.id, contextId }
          ]
        }));
        void cache.invalidateQueries({ queryKey: [...noteKey(id), 'generations'] });
        void cache.invalidateQueries({ queryKey: ['note-work', String(id)] });
      }
    )
  });
  const pending = !!draft.pending || submit.isPending;

  function start(attempt: Attempt) {
    const current = cache.getQueryData<TransformDraft>(key);

    if (readiness !== 'ready' || current?.pending || current?.unavailable) return;

    setDraft({ attempt, pending: true, unavailable: false });
    submit.mutate(attempt);
    onStarted?.();
  }

  return {
    id,
    active,
    readiness,
    suggestionReadiness,
    suggestionIdentity,
    suggestionReady: [...contextNotes, ...contextSelections].every((query) => query.isSuccess),
    suggestionContext: () =>
      JSON.stringify(
        contextIds.map((noteId) => cache.getQueriesData({ queryKey: noteKey(noteId) })),
        (_, value: unknown) => (typeof value === 'bigint' ? String(value) : value)
      ),
    notes,
    additionalNoteIds,
    t,
    locale,
    cache,
    key,
    draft,
    setDraft,
    selection,
    submit,
    pending,
    start
  };
}

export type TransformationModel = ReturnType<typeof useTransformation>;

export function Transformation({
  id,
  notes,
  onStarted,
  active = true
}: {
  id: NoteId;
  notes?: readonly SelectedNote[];
  onStarted?: () => void;
  active?: boolean;
}) {
  const model = useTransformation(id, notes, onStarted, active);

  return (
    <>
      <WorkspaceSurface.Section>
        {model.draft.requestId ? (
          <Disclosure summary={model.t('NoteGenerationRequest')}>
            <TransformBrief model={model} notes={notes} />
          </Disclosure>
        ) : (
          <TransformBrief model={model} notes={notes} />
        )}
        <TransformFailure model={model} />
        <TransformRecovery model={model} />
        <TransformReceipt model={model} />
      </WorkspaceSurface.Section>
      <NoteRuns id={id} />
    </>
  );
}

function TransformBrief({
  model,
  notes
}: {
  model: TransformationModel;
  notes?: readonly SelectedNote[];
}) {
  return (
    <>
      <Notebook.PageNotes aria-label={model.t('PageNotes')}>
        <h2>{model.t('PageNotes')}</h2>
        <Notebook.Muted>{model.t('PageNotesHelp')}</Notebook.Muted>
        <Notebook.PageSourceList>
          {notes?.length ? (
            notes.map((note) => (
              <li key={String(note.id)} title={note.title || model.t('NoteUntitled')}>
                {note.title || model.t('NoteUntitled')}
              </li>
            ))
          ) : (
            <li>{model.t('PageCurrentNote')}</li>
          )}
        </Notebook.PageSourceList>
      </Notebook.PageNotes>
      <TransformFields model={model} />
    </>
  );
}

function TransformFields({ model }: { model: TransformationModel }) {
  const { id, t, draft, setDraft } = model;

  return (
    <>
      <AiReadinessNotice state={model.readiness} />
      {model.suggestionReadiness !== model.readiness && (
        <AiReadinessNotice state={model.suggestionReadiness} />
      )}
      <TransformSuggestion key={`title/${model.suggestionIdentity}`} model={model} field="title" />
      <Notebook.Muted>{t('NoteOutputTitleHelp')}</Notebook.Muted>
      <Input
        id={`transform-title-${id}`}
        maxLength={200}
        value={draft.title}
        onChange={(event) => setDraft({ title: event.target.value })}
      />
      <TransformSuggestion
        key={`instruction/${model.suggestionIdentity}`}
        model={model}
        field="instruction"
      />
      <Notebook.Muted>{t('NoteInstructionsHelp')}</Notebook.Muted>
      <Textarea
        id={`transform-instruction-${id}`}
        maxLength={100000}
        value={draft.instruction}
        placeholder={t('NoteInstructionHint')}
        onChange={(event) => setDraft({ instruction: event.target.value })}
      />
      <Notebook.Preferences>
        <summary>{t('PageAdvancedOptions')}</summary>
        <Notebook.Muted>{t('NoteAdvancedOptionsHelp')}</Notebook.Muted>
        <TransformOperations model={model} />
      </Notebook.Preferences>
      <CreateTransform model={model} />
    </>
  );
}

function TransformOperations({ model }: { model: TransformationModel }) {
  const { id, t, draft, setDraft, additionalNoteIds } = model;

  return (
    <fieldset>
      <legend>{t('NoteOperations')}</legend>
      <Notebook.Muted>{t('NoteOperationsHelp')}</Notebook.Muted>
      <Notebook.TransformOperations>
        {operations.map(([operation, label]) => {
          const required = operation === 'combine' && additionalNoteIds.length > 0;
          const selected = required || draft.operations.includes(operation);
          const descriptionId = `transform-${id}-${operation}-help`;

          return (
            <Notebook.TransformOperation
              key={operation}
              size="sm"
              variant={selected ? 'secondary' : 'ghost'}
              aria-label={t(label)}
              aria-describedby={descriptionId}
              aria-pressed={selected}
              disabled={required}
              onClick={() =>
                setDraft({
                  operations: draft.operations.includes(operation)
                    ? draft.operations.filter((item) => item !== operation)
                    : [...draft.operations, operation]
                })
              }
            >
              <strong>{t(label)}</strong>
              <span id={descriptionId}>{t(`${label}Help`)}</span>
            </Notebook.TransformOperation>
          );
        })}
      </Notebook.TransformOperations>
    </fieldset>
  );
}

function CreateTransform({ model }: { model: TransformationModel }) {
  const { t, pending, draft, additionalNoteIds, selection, cache, key, locale, setDraft, start } =
    model;

  return (
    <>
      <AiButton
        tier="medium"
        label={t('NoteCreatePage')}
        workingLabel={t('NoteWorkTransform')}
        pending={pending}
        disabled={
          model.readiness !== 'ready' ||
          pending ||
          !!draft.attempt ||
          !draft.title.trim() ||
          draft.operations.length === 0 ||
          !selection.data
        }
        onClick={() => {
          if (
            model.readiness !== 'ready' ||
            !selection.data ||
            cache.getQueryData<TransformDraft>(key)?.attempt ||
            cache.getQueryData<TransformDraft>(key)?.pending
          )
            return;

          const attempt: Attempt = {
            key: crypto.randomUUID(),
            revision: selection.data.revision,
            title: draft.title.trim(),
            instruction: draft.instruction,
            additionalNoteIds: [...additionalNoteIds],
            operations: [
              ...new Set([
                ...(additionalNoteIds.length ? ['combine' as const] : []),
                ...draft.operations
              ])
            ],
            language: locale
          };

          setDraft({ attempt, requestId: undefined, contextId: undefined });
          start(attempt);
        }}
      >
        {t('NoteCreatePage')}
      </AiButton>
    </>
  );
}

function TransformFailure({ model }: { model: TransformationModel }) {
  const { t, submit, draft, pending, start, setDraft, selection } = model;

  return (
    <>
      {submit.error && !draft.unavailable && (
        <NoteError
          error={submit.error}
          retry={
            model.readiness === 'ready' && draft.attempt && !pending
              ? () => start(draft.attempt!)
              : undefined
          }
        />
      )}
      {submit.error instanceof StudyError &&
        submit.error.kind === 'invalid_input' &&
        !draft.requestId && (
          <Button
            variant="ghost"
            onClick={() => {
              setDraft({ attempt: undefined, contextId: undefined });
              submit.reset();
              void selection.refetch();
            }}
          >
            {t('NoteReviewConflict')}
          </Button>
        )}
    </>
  );
}

function TransformRecovery({ model }: { model: TransformationModel }) {
  const { t, pending, draft, start, id, cache, key, setDraft, submit } = model;
  const retryable = canRetryTransform(draft, pending);

  return (
    <>
      {retryable && !submit.error && (
        <RetryButton
          variant="outline"
          disabled={model.readiness !== 'ready'}
          onClick={() => start(draft.attempt!)}
          label={t('Retry')}
        />
      )}
      {retryable && <p>{t('NoteTransformRetryHelp')}</p>}
      {draft.attempt && draft.unavailable && !draft.requestId && (
        <UnavailableAttempt
          key={draft.attempt.key}
          id={id}
          busy={pending}
          onAbandon={() => {
            const current = cache.getQueryData<TransformDraft>(key);

            if (current?.pending || current?.attempt?.key !== draft.attempt?.key) return;

            setDraft({ attempt: undefined, contextId: undefined, unavailable: false });
            submit.reset();
          }}
        />
      )}
    </>
  );
}

function TransformReceipt({ model }: { model: TransformationModel }) {
  const { t, draft, pending, cache, key, setDraft, submit } = model;

  return (
    <>
      {draft.contextId && (
        <Disclosure summary={<> {t('NoteContextUsed')} </>}>
          <CapturedContext requestId={draft.contextId} />
        </Disclosure>
      )}
      {draft.requestId && (
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (cache.getQueryData<TransformDraft>(key)?.pending) return;

            setDraft({
              attempt: undefined,
              unavailable: false,
              requestId: undefined,
              contextId: undefined,
              retryId: undefined
            });
            submit.reset();
          }}
        >
          {t('NoteNewTransform')}
        </Button>
      )}
    </>
  );
}

function useTransformResult(requestId: string) {
  const readiness = useAiReadiness('medium');
  const { t } = useI18n();
  const cache = useQueryClient();
  const retryKey = ['note-drafts', 'transform-retry', requestId];
  const retryState = useQuery(transformRetryOptions(requestId));
  const attempt = retryState.data;
  const retryExecution = useQuery({
    ...executionOptions(requestId, attempt?.key),
    enabled: retryAcknowledged(attempt)
  });
  const state = useQuery(generationOptions(requestId));
  const executions = useQuery(executionOptions(requestId));
  const latest = executions.data?.items[0];
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ['note-generation', requestId] });
    void cache.invalidateQueries({ queryKey: ['note-execution', requestId] });
  };
  const cancel = useMutation({
    ...cancelTransformOptions(requestId),
    onSuccess: refresh
  });
  const retry = useMutation({
    ...retryTransformOptions(requestId),
    onSuccess: (_, key) => {
      cache.setQueryData(retryKey, { key, acknowledged: true });
      refresh();
    }
  });
  const retryableFailure =
    latest?.outcome === 'failure' &&
    (!attempt?.acknowledged ||
      retryExecution.data?.items.some(
        (item) => item.id === latest.id && item.outcome === 'failure'
      ));

  useEffect(() => {
    const result = state.data?.resultVersionId;

    if (!result) return;

    const publishedKey = ['note-drafts', 'published', requestId];

    if (cache.getQueryData(publishedKey) === result) return;

    cache.setQueryDefaults(['note-drafts', 'published'], { gcTime: Infinity });
    cache.setQueryData(publishedKey, result);
    void invalidatePages(cache);
  }, [cache, requestId, state.data?.resultVersionId]);
  const active = !state.data?.cancelled && !state.data?.resultVersionId;

  return {
    requestId,
    readiness,
    t,
    cache,
    retryKey,
    attempt,
    state,
    latest,
    cancel,
    retry,
    retryNew: () => {
      if (readiness !== 'ready') return;

      const key = attempt && !attempt.acknowledged ? attempt.key : crypto.randomUUID();

      cache.setQueryData(retryKey, { key, acknowledged: false });
      retry.mutate(key);
    },
    retrySubmit: (key: string) => {
      if (readiness === 'ready') retry.mutate(key);
    },
    retryableFailure,
    active
  };
}

type TransformResultModel = ReturnType<typeof useTransformResult>;

function TransformResult({ requestId }: { requestId: string }) {
  const model = useTransformResult(requestId);
  const { state, requestId: currentRequestId, active } = model;

  return (
    <Notebook.TransformResult>
      {state.error && <NoteReadError error={state.error} retry={() => void state.refetch()} />}
      {active && <ExecutionStatus requestId={currentRequestId} />}
      {active && <AgentProgress correlationId={currentRequestId} />}
      {state.data?.resultVersionId && <OutputLink id={state.data.resultVersionId} />}
      {state.data?.report && (
        <ul>
          {state.data.report.notes.map((note) => (
            <li key={note.explanation}>{note.explanation}</li>
          ))}
        </ul>
      )}
      <TransformControls model={model} />
    </Notebook.TransformResult>
  );
}

function TransformControls({ model }: { model: TransformResultModel }) {
  const { state, t, active, cancel, retry, retryableFailure, latest } = model;

  return (
    <>
      {active && (
        <>
          <AiReadinessNotice state={model.readiness} />
          <Button
            variant="outline"
            disabled={cancel.isPending || latest?.canCancel === false}
            onClick={() => cancel.mutate()}
          >
            {t('NoteCancel')}
          </Button>
        </>
      )}
      {active && retryableFailure && (
        <RetryButton
          variant="outline"
          disabled={retry.isPending || model.readiness !== 'ready'}
          onClick={model.retryNew}
          label={t('Retry')}
        />
      )}
      {state.data?.cancelled && <StatusMessage>{t('NoteCancelledTransform')}</StatusMessage>}
      {cancel.error && <NoteError error={cancel.error} retry={() => cancel.mutate()} />}
      <TransformRetryError model={model} />
    </>
  );
}

function OutputLink({ id }: { id: PageVersionId }) {
  const { t } = useI18n();
  const state = useQuery(pageVersionOptions(id));

  return (
    <>
      {state.error && <NoteReadError error={state.error} retry={() => void state.refetch()} />}
      {state.data && (
        <Button
          variant="outline"
          render={
            <Link
              to="/pages/$pageId"
              params={{ pageId: String(state.data.pageId) }}
              search={{ pageVersion: String(id) }}
            />
          }
        >
          {t('NoteOpenOutput')}
        </Button>
      )}
    </>
  );
}

export function NoteRuns({ id }: { id: NoteId }) {
  const { t } = useI18n();
  const state = useInfiniteQuery(noteGenerationsOptions(id));
  const runs = new Map(
    state.data?.pages.flatMap((page) => page.items).map((run) => [run.requestId, run])
  );

  if (state.isSuccess && !state.isError && runs.size === 0) return null;

  return (
    <Notebook.Runs aria-label={t('NoteRuns')}>
      <Notebook.Toolbar>
        <span>{t('NoteRuns')}</span>
        <Button
          size="sm"
          variant="ghost"
          disabled={state.isFetching}
          onClick={() => void state.refetch()}
        >
          {t('LibraryRefresh')}
        </Button>
      </Notebook.Toolbar>
      {state.error && <NoteReadError error={state.error} retry={() => void state.refetch()} />}
      {[...runs.values()].map((run) => (
        <Notebook.TransformRun key={run.requestId}>
          <RunHeading run={run} />
          <Disclosure summary={<> {t('NoteRunDetails')} </>}>
            <code>{run.requestId}</code>
            {run.contextRequestId && run.state === 'available' && (
              <CapturedContext requestId={run.contextRequestId} />
            )}
          </Disclosure>
          {run.state === 'available' ? (
            <>
              <TransformResult requestId={run.requestId} />
              {run.proposedVersionId && <ProposalReview requestId={run.requestId} />}
            </>
          ) : (
            <StatusMessage>
              {t(run.state === 'retired' ? 'NoteRunRetired' : 'NoteContextUnavailable')}
            </StatusMessage>
          )}
        </Notebook.TransformRun>
      ))}
      {state.hasNextPage && (
        <LoadMoreButton
          variant="ghost"
          disabled={state.isFetchingNextPage}
          onClick={() => void state.fetchNextPage()}
          label={t('LibraryMore')}
        />
      )}
    </Notebook.Runs>
  );
}

function RunHeading({ run }: { run: typeof noteGenerationSchema.Type }) {
  const { t } = useI18n();
  const state = useQuery({
    ...generationOptions(run.requestId),
    enabled: run.state === 'available'
  });

  return (
    <Notebook.RunHeading>
      <strong>{state.data?.title || t('NoteTransform')}</strong>
      <Notebook.MutedLabel>{t(runLabel(run))}</Notebook.MutedLabel>
    </Notebook.RunHeading>
  );
}

function runLabel(run: typeof noteGenerationSchema.Type) {
  if (run.state === 'retired') return 'NoteRunRetired';

  if (run.state === 'unavailable') return 'NoteContextUnavailable';

  if (run.cancelled) return 'NoteCancelledTransform';

  if (run.resultVersionId) return 'NoteOpenOutput';

  if (run.proposedVersionId) return 'NoteRunProposal';

  return 'NoteRunAwaitingOutput';
}

function TransformRetryError({ model }: { model: TransformResultModel }) {
  const { retry, state, attempt } = model;

  return (
    <>
      {retry.error && (
        <NoteError
          error={retry.error}
          retry={
            model.readiness === 'ready' &&
            !state.data?.cancelled &&
            attempt &&
            !attempt.acknowledged
              ? () => model.retrySubmit(attempt.key)
              : undefined
          }
        />
      )}{' '}
    </>
  );
}

function retryAcknowledged(attempt: { acknowledged: boolean } | null) {
  return !!attempt?.acknowledged;
}

function canRetryTransform(draft: TransformDraft, pending: boolean) {
  return !!draft.attempt && !draft.requestId && !pending && !draft.unavailable;
}
