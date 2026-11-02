import type { sessionGenerationSchema } from '@study/contracts/conversations/rpc';
import { StudyError } from '@study/contracts/errors';
import type { SessionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { Input } from '@study/ui/input';
import { Textarea } from '@study/ui/textarea';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect } from 'react';

import { useI18n } from '../../lib/i18n';
import { toStudyError } from '../../lib/study-client/errors';
import { ProposalReview } from '../document-editing/proposal-review';
import { versionOptions } from '../material-library/material-library.queries';
import { CapturedContext } from './history';
import {
  cancelGeneration,
  captureContext,
  executionOptions,
  generationOptions,
  retryGeneration,
  selectionOptions,
  sessionGenerationsOptions,
  sessionKey,
  transformDocument
} from './session-workspace.queries';
import type { Selection, TransformInput } from './session-workspace.queries';
import { ExecutionStatus, SessionError, SessionReadError } from './status';
import { UnavailableAttempt } from './unavailable-attempt';

type Attempt = {
  key: string;
  revision: bigint;
  title: string;
  instruction: string;
  operations: TransformInput['operations'];
  language: 'english' | 'italian';
};
type TransformDraft = {
  title: string;
  instruction: string;
  operations: TransformInput['operations'];
  attempt?: Attempt;
  pending?: boolean;
  unavailable?: boolean;
  requestId?: string;
  contextId?: string;
  retryId?: string;
  runs?: { id: string; contextId: string }[];
};
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
export function Transformation({ id }: { id: SessionId }) {
  const { t, locale } = useI18n();
  const cache = useQueryClient();
  const key = ['session-drafts', String(id), 'transform'];
  const initial: TransformDraft = { title: '', instruction: '', operations: ['clarity'] };
  const state = useQuery({
    queryKey: key,
    queryFn: () => initial,
    initialData: initial,
    staleTime: Infinity,
    gcTime: Infinity
  });
  const draft = state.data;
  const setDraft = (patch: Partial<TransformDraft>) =>
    cache.setQueryData<TransformDraft>(key, (previous) => ({ ...(previous ?? initial), ...patch }));
  const selection = useQuery(selectionOptions(id));
  const dirty = useQuery({
    queryKey: ['session-drafts', String(id), 'selection'],
    queryFn: () => null as Selection | null,
    initialData: null,
    staleTime: Infinity,
    gcTime: Infinity
  });
  const submit = useMutation({
    retry: false,
    onError: (error) => setDraft({ unavailable: toStudyError(error).kind === 'not_found' }),
    onSettled: () => setDraft({ pending: false }),
    mutationFn: async (attempt: Attempt) => {
      const captured = await captureContext({
        sessionId: id,
        intentKey: attempt.key,
        instruction: attempt.instruction,
        preferences: { language: attempt.language }
      });
      if (captured.selectionRevision !== attempt.revision)
        throw new StudyError('invalid_input', 'Selection changed before capture');
      setDraft({ contextId: captured.requestId });
      const result = await transformDocument({
        contextRequestId: captured.requestId,
        operations: attempt.operations,
        title: attempt.title
      });
      cache.setQueryData<TransformDraft>(key, (previous) => ({
        ...(previous ?? initial),
        requestId: result.id,
        runs: [
          ...(previous?.runs ?? []).filter((run) => run.id !== result.id),
          { id: result.id, contextId: captured.requestId }
        ]
      }));
      void cache.invalidateQueries({ queryKey: [...sessionKey(id), 'generations'] });
      return result;
    }
  });
  const pending = !!draft.pending || submit.isPending;
  function start(attempt: Attempt) {
    const current = cache.getQueryData<TransformDraft>(key);
    if (current?.pending || current?.unavailable) return;
    setDraft({ attempt, pending: true, unavailable: false });
    submit.mutate(attempt);
  }
  return (
    <>
      <details className="session-section">
        <summary>{t('SessionTransform')}</summary>
        <p className="session-muted">{t('SessionTransformHelp')}</p>
        <label htmlFor={`transform-title-${id}`}>{t('SessionOutputTitle')}</label>
        <Input
          id={`transform-title-${id}`}
          maxLength={200}
          value={draft.title}
          onChange={(event) => setDraft({ title: event.target.value })}
        />
        <label htmlFor={`transform-instruction-${id}`}>{t('SessionInstructions')}</label>
        <Textarea
          id={`transform-instruction-${id}`}
          maxLength={100000}
          value={draft.instruction}
          placeholder={t('SessionInstructionHint')}
          onChange={(event) => setDraft({ instruction: event.target.value })}
        />
        <fieldset>
          <legend>{t('SessionOperations')}</legend>
          <div className="session-actions">
            {operations.map(([operation, label]) => (
              <Button
                key={operation}
                size="sm"
                variant={draft.operations.includes(operation) ? 'secondary' : 'ghost'}
                aria-pressed={draft.operations.includes(operation)}
                onClick={() =>
                  setDraft({
                    operations: draft.operations.includes(operation)
                      ? draft.operations.filter((item) => item !== operation)
                      : [...draft.operations, operation]
                  })
                }
              >
                {t(label)}
              </Button>
            ))}
          </div>
        </fieldset>
        <Button
          disabled={
            pending ||
            !!draft.attempt ||
            !draft.instruction.trim() ||
            !draft.title.trim() ||
            draft.operations.length === 0 ||
            !selection.data ||
            !!dirty.data
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
              operations: [...draft.operations],
              language: locale
            };
            setDraft({ attempt, requestId: undefined, contextId: undefined });
            start(attempt);
          }}
        >
          {t('SessionCreateDocument')}
        </Button>
        {pending && <p role="status">{t('SessionSaving')}</p>}
        {submit.error && !draft.unavailable && (
          <SessionError
            error={submit.error}
            retry={draft.attempt && !pending ? () => start(draft.attempt!) : undefined}
          />
        )}
        {draft.attempt && !draft.requestId && !pending && !submit.error && !draft.unavailable && (
          <Button variant="outline" onClick={() => start(draft.attempt!)}>
            {t('Retry')}
          </Button>
        )}
        {draft.attempt && !draft.requestId && !pending && !draft.unavailable && (
          <p>{t('SessionTransformRetryHelp')}</p>
        )}
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
      </details>
      <SessionRuns id={id} />
    </>
  );
}
export function TransformResult({ requestId }: { requestId: string }) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const retryKey = ['session-drafts', 'transform-retry', requestId];
  type RetryAttempt = { key: string; acknowledged: boolean };
  const retryState = useQuery({
    queryKey: retryKey,
    queryFn: () => null as RetryAttempt | null,
    initialData: null,
    staleTime: Infinity,
    gcTime: Infinity
  });
  const attempt = retryState.data;
  const retryExecution = useQuery({
    ...executionOptions(requestId, attempt?.key),
    enabled: !!attempt?.acknowledged
  });
  const state = useQuery(generationOptions(requestId));
  const executions = useQuery(executionOptions(requestId));
  const latest = executions.data?.items[0];
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ['session-generation', requestId] });
    void cache.invalidateQueries({ queryKey: ['session-execution', requestId] });
  };
  const cancel = useMutation({
    mutationFn: () => cancelGeneration(requestId),
    retry: false,
    onSuccess: refresh
  });
  const retry = useMutation({
    mutationFn: (key: string) => retryGeneration(requestId, key),
    retry: false,
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
    void cache.invalidateQueries({ queryKey: ['materials'] });
    void cache.invalidateQueries({ queryKey: ['session-material-search'] });
  }, [cache, requestId, state.data?.resultVersionId]);
  return (
    <div className="session-transform-result">
      {state.error && <SessionReadError error={state.error} retry={() => void state.refetch()} />}
      {!state.data?.cancelled && !state.data?.resultVersionId && (
        <ExecutionStatus requestId={requestId} />
      )}
      {state.data?.resultVersionId && <OutputLink id={state.data.resultVersionId} />}
      {state.data?.report && (
        <ul>
          {state.data.report.notes.map((note, index) => (
            <li key={index}>{note.explanation}</li>
          ))}
        </ul>
      )}
      {!state.data?.resultVersionId && !state.data?.cancelled && (
        <Button
          variant="outline"
          disabled={cancel.isPending || latest?.canCancel === false}
          onClick={() => cancel.mutate()}
        >
          {t('SessionCancel')}
        </Button>
      )}
      {!state.data?.cancelled && !state.data?.resultVersionId && retryableFailure && (
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
      {retry.error && (
        <SessionError
          error={retry.error}
          retry={
            !state.data?.cancelled && attempt && !attempt.acknowledged
              ? () => retry.mutate(attempt.key)
              : undefined
          }
        />
      )}
    </div>
  );
}
function OutputLink({ id }: { id: import('@study/contracts/ids').MaterialVersionId }) {
  const { t } = useI18n();
  const state = useQuery(versionOptions(id));
  return (
    <>
      {state.error && <SessionReadError error={state.error} retry={() => void state.refetch()} />}
      {state.data && (
        <Button
          variant="outline"
          render={
            <Link
              to="/materials/$materialId"
              params={{ materialId: String(state.data.material_id) }}
              search={{ version: String(id) }}
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
    <section className="session-runs" aria-label={t('SessionRuns')}>
      <div className="session-toolbar">
        <span>{t('SessionRuns')}</span>
        <Button
          size="sm"
          variant="ghost"
          disabled={state.isFetching}
          onClick={() => void state.refetch()}
        >
          {t('LibraryRefresh')}
        </Button>
      </div>
      {state.error && <SessionReadError error={state.error} retry={() => void state.refetch()} />}
      {[...runs.values()].map((run) => (
        <section className="session-transform-run" key={run.requestId}>
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
        </section>
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
    </section>
  );
}

function RunHeading({ run }: { run: typeof sessionGenerationSchema.Type }) {
  const { t } = useI18n();
  const state = useQuery({
    ...generationOptions(run.requestId),
    enabled: run.state === 'available'
  });
  return (
    <header className="session-run-heading">
      <strong>{state.data?.title || t('SessionTransform')}</strong>
      <span className="session-muted">
        {t(
          run.state === 'retired'
            ? 'SessionRunRetired'
            : run.state === 'unavailable'
              ? 'SessionContextUnavailable'
              : run.cancelled
                ? 'SessionCancelledTransform'
                : run.resultVersionId
                  ? 'SessionOpenOutput'
                  : run.proposedVersionId
                    ? 'SessionRunProposal'
                    : 'SessionRunAwaitingOutput'
        )}
      </span>
    </header>
  );
}
