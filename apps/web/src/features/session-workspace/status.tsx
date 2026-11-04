import { StudyError } from '@study/contracts/errors';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Notebook } from '@study/ui/session-workspace';
import { useQuery } from '@tanstack/react-query';
import { Brain, Check, CircleAlert, CircleSlash, Clock, ChevronRight } from 'lucide-react';

import { workflowLabel } from '#web/features/activity/workflow-label.ts';
import { useI18n } from '#web/lib/i18n.tsx';
import { toStudyError } from '#web/lib/study-client/errors.ts';

import { executionOptions } from './session-workspace.queries';

export function SessionError({ error, retry }: { error: unknown; retry?: () => void }) {
  const { t } = useI18n();

  return (
    <ErrorState
      title={t('SessionActionErrorTitle')}
      description={t(
        error instanceof StudyError && error.kind === 'auth'
          ? 'SessionAuthError'
          : error instanceof StudyError && error.kind === 'invalid_input'
            ? 'SessionConflict'
            : 'SessionRequestError'
      )}
      action={
        retry && (
          <Button size="sm" variant="outline" onClick={retry}>
            {t('Retry')}
          </Button>
        )
      }
    />
  );
}

export function SessionReadError({
  error,
  retry,
  layout = 'inline'
}: {
  error: unknown;
  retry?: () => void;
  layout?: 'page' | 'inline';
}) {
  const { t } = useI18n();

  return (
    <ErrorState
      layout={layout}
      title={t('SessionReadErrorTitle')}
      description={t(
        toStudyError(error).kind === 'not_found' ? 'SessionReadUnavailable' : 'SessionReadError'
      )}
      action={
        retry && (
          <Button size="sm" variant="outline" onClick={retry}>
            {t('Retry')}
          </Button>
        )
      }
    />
  );
}

export function ExecutionStatus({ requestId }: { requestId: string }) {
  const { t, date } = useI18n();
  const state = useQuery(executionOptions(requestId));

  if (state.error)
    return <SessionReadError error={state.error} retry={() => void state.refetch()} />;

  return (
    <Notebook.WorkLog
      role="status"
      aria-label={t('SessionPromptWork')}
      aria-live="polite"
      aria-atomic="true"
    >
      {!state.data?.items.length && (
        <Notebook.WorkRow>
          <Brain aria-hidden="true" />
          <span>{t('SessionPending')}</span>
        </Notebook.WorkRow>
      )}
      {state.data?.items.toReversed().map((item) => {
        const failure = item.outcome === 'failure';
        const Icon = failure ? CircleAlert : workIcon(item.status);
        return (
          <Notebook.WorkItem key={item.id}>
            <Notebook.WorkSummary>
              <Icon aria-hidden="true" />
              <Notebook.WorkCopy>
                <span>{t(workflowLabel(item.workflow))}</span>
                <span aria-hidden="true">·</span>
                <span>{t(`workspace.state.${failure ? 'failure' : item.status}`)}</span>
              </Notebook.WorkCopy>
              <ChevronRight aria-hidden="true" />
            </Notebook.WorkSummary>
            <Notebook.WorkMetadata>
              <dt>{t('SessionWorkStarted')}</dt>
              <dd>
                {item.createdAtMs <= 8_640_000_000_000_000n
                  ? date(item.createdAtMs / 1000n)
                  : t('workspace.dateUnavailable')}
              </dd>
              <dt>{t('SessionWorkUpdated')}</dt>
              <dd>
                {item.updatedAtMs <= 8_640_000_000_000_000n
                  ? date(item.updatedAtMs / 1000n)
                  : t('workspace.dateUnavailable')}
              </dd>
              <dt>{t('SessionWorkElapsed')}</dt>
              <dd>
                {t('SessionWorkSeconds', {
                  seconds:
                    (item.updatedAtMs >= item.createdAtMs
                      ? item.updatedAtMs - item.createdAtMs
                      : 0n) / 1000n
                })}
              </dd>
            </Notebook.WorkMetadata>
            {failure && <SessionError error={new StudyError(item.failureKind ?? 'internal', '')} />}
          </Notebook.WorkItem>
        );
      })}
    </Notebook.WorkLog>
  );
}

function workIcon(status: string) {
  switch (status) {
    case 'completed':
      return Check;
    case 'cancelled':
      return CircleSlash;
    case 'suspended':
    case 'cancelling':
      return Clock;
    default:
      return Brain;
  }
}
