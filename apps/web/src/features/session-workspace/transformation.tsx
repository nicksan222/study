import type { sessionGenerationSchema } from '@study/contracts/conversations/rpc';
import { StudyError } from '@study/contracts/errors';
import type { SessionId, StudyDocumentVersionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { Input } from '@study/ui/input';
import { Loading } from '@study/ui/loading';
import { Notebook } from '@study/ui/session-workspace';
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

import { useI18n } from '#web/lib/i18n.tsx';
import {
  documentVersionOptions,
  invalidateDocuments
} from '#web/lib/study-client/documents.queries.ts';
import { toStudyError } from '#web/lib/study-client/errors.ts';

import { ProposalReview } from '../document-editing';
import type { SelectedSession } from './document-creation-dialog';
import { CapturedContext } from './history';
import {
  executionOptions,
  generationOptions,
  selectionOptions,
  sessionGenerationsOptions,
  sessionKey,
  sessionOptions
} from './session-workspace.queries';
import { ExecutionStatus, SessionError, SessionReadError } from './status';
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
  ['clarity', 'SessionOpClarity'],
  ['grammar', 'SessionOpGrammar'],
  ['structure', 'SessionOpStructure'],
  ['combine', 'SessionOpCombine'],
  ['deduplicate', 'SessionOpDeduplicate'],
  ['summarize', 'SessionOpSummarize'],
  ['explain', 'SessionOpExplain'],
  ['expand', 'SessionOpExpand'],
  ['translate', 'SessionOpTranslate'],
  ['factual_correction', 'SessionOpCorrect']
] as const;

function useTransformation(
  id: SessionId,
  sessions?: readonly SelectedSession[],
  onStarted?: () => void,
  active = true
) {
  const { t, locale } = useI18n();
  const cache = useQueryClient();
  const additionalSessionIds = [
    ...new Set(sessions?.map((session) => session.id).filter((value) => value !== id) ?? [])
  ];
  const options = transformDraftOptions(id, additionalSessionIds);
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
  const contextIds = [id, ...additionalSessionIds];
  const contextSessions = useQueries({ queries: contextIds.map(sessionOptions) });
  const contextSelections = useQueries({ queries: contextIds.map(selectionOptions) });
  const suggestionIdentity = JSON.stringify([
    key,
    locale,
    active,
    contextSessions.map((query) => query.data?.updatedAt?.toString()),
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
        void cache.invalidateQueries({ queryKey: [...sessionKey(id), 'generations'] });
      }
    )
  });
  const pending = !!draft.pending || submit.isPending;

  function start(attempt: Attempt) {
    const current = cache.getQueryData<TransformDraft>(key);

    if (current?.pending || current?.unavailable) return;

    setDraft({ attempt, pending: true, unavailable: false });
    submit.mutate(attempt);
    onStarted?.();
  }

  return {
    id,
    active,
    suggestionIdentity,
    suggestionReady: [...contextSessions, ...contextSelections].every((query) => query.isSuccess),
    suggestionContext: () =>
      JSON.stringify(
        contextIds.map((sessionId) => cache.getQueriesData({ queryKey: sessionKey(sessionId) })),
        (_, value: unknown) => (typeof value === 'bigint' ? String(value) : value)
      ),
    sessions,
    additionalSessionIds,
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
  sessions,
  onStarted,
  active = true
}: {
  id: SessionId;
  sessions?: readonly SelectedSession[];
  onStarted?: () => void;
  active?: boolean;
}) {
  const model = useTransformation(id, sessions, onStarted, active);

  return (
    <>
      <WorkspaceSurface.Section>
        <Notebook.DocumentSessions aria-label={model.t('DocumentSessions')}>
          <h2>{model.t('DocumentSessions')}</h2>
          <Notebook.Muted>{model.t('DocumentSessionsHelp')}</Notebook.Muted>
          <Notebook.DocumentSourceList>
            {sessions?.length ? (
              sessions.map((session) => (
                <li key={String(session.id)} title={session.title || model.t('SessionUntitled')}>
                  {session.title || model.t('SessionUntitled')}
                </li>
              ))
            ) : (
              <li>{model.t('DocumentCurrentSession')}</li>
            )}
          </Notebook.DocumentSourceList>
        </Notebook.DocumentSessions>
        <TransformFields model={model} />
        <TransformFailure model={model} />
        <TransformRecovery model={model} />
        <TransformReceipt model={model} />
      </WorkspaceSurface.Section>
      <SessionRuns id={id} />
    </>
  );
}

function TransformFields({ model }: { model: TransformationModel }) {
  const { id, t, draft, setDraft } = model;

  return (
    <>
      <TransformSuggestion key={`title/${model.suggestionIdentity}`} model={model} field="title" />
      <Notebook.Muted>{t('SessionOutputTitleHelp')}</Notebook.Muted>
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
      <Notebook.Muted>{t('SessionInstructionsHelp')}</Notebook.Muted>
      <Textarea
        id={`transform-instruction-${id}`}
        maxLength={100000}
        value={draft.instruction}
        placeholder={t('SessionInstructionHint')}
        onChange={(event) => setDraft({ instruction: event.target.value })}
      />
      <Notebook.Preferences>
        <summary>{t('DocumentAdvancedOptions')}</summary>
        <Notebook.Muted>{t('SessionAdvancedOptionsHelp')}</Notebook.Muted>
        <TransformOperations model={model} />
      </Notebook.Preferences>
      <CreateTransform model={model} />
    </>
  );
}

function TransformOperations({ model }: { model: TransformationModel }) {
  const { id, t, draft, setDraft, additionalSessionIds } = model;

  return (
    <fieldset>
      <legend>{t('SessionOperations')}</legend>
      <Notebook.Muted>{t('SessionOperationsHelp')}</Notebook.Muted>
      <Notebook.TransformOperations>
        {operations.map(([operation, label]) => {
          const required = operation === 'combine' && additionalSessionIds.length > 0;
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
  const {
    t,
    pending,
    draft,
    additionalSessionIds,
    selection,
    cache,
    key,
    locale,
    setDraft,
    start
  } = model;

  return (
    <>
      <Button
        disabled={
          pending ||
          !!draft.attempt ||
          !draft.title.trim() ||
          draft.operations.length === 0 ||
          !selection.data
        }
        onClick={() => {
          if (
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
            additionalSessionIds: [...additionalSessionIds],
            operations: [
              ...new Set([
                ...(additionalSessionIds.length ? ['combine' as const] : []),
                ...draft.operations
              ])
            ],
            language: locale
          };

          setDraft({ attempt, requestId: undefined, contextId: undefined });
          start(attempt);
        }}
      >
        {t('SessionCreateDocument')}
      </Button>
    </>
  );
}

function TransformFailure({ model }: { model: TransformationModel }) {
  const { t, submit, draft, pending, start, setDraft, selection } = model;

  return (
    <>
      {submit.error && !draft.unavailable && (
        <SessionError
          error={submit.error}
          retry={draft.attempt && !pending ? () => start(draft.attempt!) : undefined}
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
            {t('SessionReviewConflict')}
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
      {pending && <Loading label={t('SessionSaving')} />}
      {retryable && !submit.error && (
        <Button variant="outline" onClick={() => start(draft.attempt!)}>
          {t('Retry')}
        </Button>
      )}
      {retryable && <p>{t('SessionTransformRetryHelp')}</p>}
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
        <details>
          <summary>{t('SessionContextUsed')}</summary>
          <CapturedContext requestId={draft.contextId} />
        </details>
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
          {t('SessionNewTransform')}
        </Button>
      )}
    </>
  );
}

function useTransformResult(requestId: string) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const retryKey = ['session-drafts', 'transform-retry', requestId];
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
    void cache.invalidateQueries({ queryKey: ['session-generation', requestId] });
    void cache.invalidateQueries({ queryKey: ['session-execution', requestId] });
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

    const publishedKey = ['session-drafts', 'published', requestId];

    if (cache.getQueryData(publishedKey) === result) return;

    cache.setQueryDefaults(['session-drafts', 'published'], { gcTime: Infinity });
    cache.setQueryData(publishedKey, result);
    void invalidateDocuments(cache);
  }, [cache, requestId, state.data?.resultVersionId]);
  const active = !state.data?.cancelled && !state.data?.resultVersionId;

  return {
    requestId,
    t,
    cache,
    retryKey,
    attempt,
    state,
    latest,
    cancel,
    retry,
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
      {state.error && <SessionReadError error={state.error} retry={() => void state.refetch()} />}
      {active && <ExecutionStatus requestId={currentRequestId} />}
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
  const { state, t, active, cancel, retry, retryableFailure, attempt, cache, retryKey, latest } =
    model;

  return (
    <>
      {active && (
        <Button
          variant="outline"
          disabled={cancel.isPending || latest?.canCancel === false}
          onClick={() => cancel.mutate()}
        >
          {t('SessionCancel')}
        </Button>
      )}
      {active && retryableFailure && (
        <Button
          variant="outline"
          disabled={retry.isPending}
          onClick={() => {
            const key = attempt && !attempt.acknowledged ? attempt.key : crypto.randomUUID();

            cache.setQueryData(retryKey, { key, acknowledged: false });
            retry.mutate(key);
          }}
        >
          {t('Retry')}
        </Button>
      )}
      {state.data?.cancelled && <p role="status">{t('SessionCancelledTransform')}</p>}
      {cancel.error && <SessionError error={cancel.error} retry={() => cancel.mutate()} />}
      <TransformRetryError model={model} />
    </>
  );
}

function OutputLink({ id }: { id: StudyDocumentVersionId }) {
  const { t } = useI18n();
  const state = useQuery(documentVersionOptions(id));

  return (
    <>
      {state.error && <SessionReadError error={state.error} retry={() => void state.refetch()} />}
      {state.data && (
        <Button
          variant="outline"
          render={
            <Link
              to="/documents/$documentId"
              params={{ documentId: String(state.data.documentId) }}
              search={{ documentVersion: String(id) }}
            />
          }
        >
          {t('SessionOpenOutput')}
        </Button>
      )}
    </>
  );
}

export function SessionRuns({ id }: { id: SessionId }) {
  const { t } = useI18n();
  const state = useInfiniteQuery(sessionGenerationsOptions(id));
  const runs = new Map(
    state.data?.pages.flatMap((page) => page.items).map((run) => [run.requestId, run])
  );

  if (state.isSuccess && !state.isError && runs.size === 0) return null;

  return (
    <Notebook.Runs aria-label={t('SessionRuns')}>
      <Notebook.Toolbar>
        <span>{t('SessionRuns')}</span>
        <Button
          size="sm"
          variant="ghost"
          disabled={state.isFetching}
          onClick={() => void state.refetch()}
        >
          {t('LibraryRefresh')}
        </Button>
      </Notebook.Toolbar>
      {state.error && <SessionReadError error={state.error} retry={() => void state.refetch()} />}
      {[...runs.values()].map((run) => (
        <Notebook.TransformRun key={run.requestId}>
          <RunHeading run={run} />
          <details>
            <summary>{t('SessionRunDetails')}</summary>
            <code>{run.requestId}</code>
            {run.contextRequestId && run.state === 'available' && (
              <CapturedContext requestId={run.contextRequestId} />
            )}
          </details>
          {run.state === 'available' ? (
            <>
              <TransformResult requestId={run.requestId} />
              {run.proposedVersionId && <ProposalReview requestId={run.requestId} />}
            </>
          ) : (
            <p role="status">
              {t(run.state === 'retired' ? 'SessionRunRetired' : 'SessionContextUnavailable')}
            </p>
          )}
        </Notebook.TransformRun>
      ))}
      {state.hasNextPage && (
        <Button
          variant="ghost"
          disabled={state.isFetchingNextPage}
          onClick={() => void state.fetchNextPage()}
        >
          {t('LibraryMore')}
        </Button>
      )}
    </Notebook.Runs>
  );
}

function RunHeading({ run }: { run: typeof sessionGenerationSchema.Type }) {
  const { t } = useI18n();
  const state = useQuery({
    ...generationOptions(run.requestId),
    enabled: run.state === 'available'
  });

  return (
    <Notebook.RunHeading>
      <strong>{state.data?.title || t('SessionTransform')}</strong>
      <Notebook.MutedLabel>{t(runLabel(run))}</Notebook.MutedLabel>
    </Notebook.RunHeading>
  );
}

function runLabel(run: typeof sessionGenerationSchema.Type) {
  if (run.state === 'retired') return 'SessionRunRetired';

  if (run.state === 'unavailable') return 'SessionContextUnavailable';

  if (run.cancelled) return 'SessionCancelledTransform';

  if (run.resultVersionId) return 'SessionOpenOutput';

  if (run.proposedVersionId) return 'SessionRunProposal';

  return 'SessionRunAwaitingOutput';
}

function TransformRetryError({ model }: { model: TransformResultModel }) {
  const { retry, state, attempt } = model;

  return (
    <>
      {retry.error && (
        <SessionError
          error={retry.error}
          retry={
            !state.data?.cancelled && attempt && !attempt.acknowledged
              ? () => retry.mutate(attempt.key)
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
