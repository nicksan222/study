import type { sessionGenerationSchema } from '@study/contracts/conversations/rpc';
import { StudyError } from '@study/contracts/errors';
import type { SessionId, MaterialVersionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { Input } from '@study/ui/input';
import { Loading } from '@study/ui/loading';
import { Notebook } from '@study/ui/session-workspace';
import { Textarea } from '@study/ui/textarea';
import { WorkspaceSurface } from '@study/ui/workspace';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect } from 'react';

import { useI18n } from '../../lib/i18n';
import { toStudyError } from '../../lib/study-client/errors';
import { ProposalReview } from '../document-editing';
import { versionOptions } from '../material-library';
import { CapturedContext } from './history';
import { selectionDraftOptions } from './selection.queries';
import {
  executionOptions,
  generationOptions,
  selectionOptions,
  sessionGenerationsOptions,
  sessionKey
} from './session-workspace.queries';
import { ExecutionStatus, SessionError, SessionReadError } from './status';
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

function useTransformation(id: SessionId) {
  const { t, locale } = useI18n();
  const cache = useQueryClient();
  const key = ['session-drafts', String(id), 'transform'];
  const initial: TransformDraft = { title: '', instruction: '', operations: ['clarity'] };
  const state = useQuery(transformDraftOptions(id));
  const draft = state.data;
  const setDraft = (patch: Partial<TransformDraft>) =>
    cache.setQueryData<TransformDraft>(key, (previous) => ({ ...(previous ?? initial), ...patch }));
  const selection = useQuery(selectionOptions(id));
  const dirty = useQuery(selectionDraftOptions(id));
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
  }

  return { id, t, locale, cache, key, draft, setDraft, selection, dirty, submit, pending, start };
}

type TransformationModel = ReturnType<typeof useTransformation>;

export function Transformation({ id }: { id: SessionId }) {
  const model = useTransformation(id);
  const { t } = model;

  return (
    <>
      <WorkspaceSurface.Section>
        <Notebook.Muted>{t('SessionTransformHelp')}</Notebook.Muted>
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
      <TransformOperations model={model} />
      <CreateTransform model={model} />
    </>
  );
}

function TransformOperations({ model }: { model: TransformationModel }) {
  const { t, draft, setDraft } = model;

  return (
    <>
      <fieldset>
        <legend>{t('SessionOperations')}</legend>
        <Notebook.Actions>
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
        </Notebook.Actions>
      </fieldset>
    </>
  );
}

function CreateTransform({ model }: { model: TransformationModel }) {
  const { t, pending, draft, selection, dirty, cache, key, locale, setDraft, start } = model;

  return (
    <>
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
    void cache.invalidateQueries({ queryKey: ['materials'] });
    void cache.invalidateQueries({ queryKey: ['session-material-search'] });
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

function OutputLink({ id }: { id: MaterialVersionId }) {
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
