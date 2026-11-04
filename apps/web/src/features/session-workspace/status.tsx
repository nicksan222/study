import { StudyError } from '@study/contracts/errors';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Notebook } from '@study/ui/session-workspace';
import { useQuery } from '@tanstack/react-query';

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
  const { t } = useI18n();
  const state = useQuery(executionOptions(requestId));
  const latest = state.data?.items[0];

  return (
    <Notebook.Status role="status">
      {state.error ? (
        <SessionReadError error={state.error} retry={() => void state.refetch()} />
      ) : latest?.outcome === 'failure' ? (
        <SessionError error={new StudyError(latest.failureKind ?? 'internal', '')} />
      ) : (
        <p>{t(executionLabel(latest?.status))}</p>
      )}
    </Notebook.Status>
  );
}

function executionLabel(status: string | undefined) {
  switch (status) {
    case 'completed':
      return 'SessionCompleted';
    case 'cancelled':
      return 'SessionCancelled';
    case 'cancelling':
      return 'SessionCancelling';
    case 'suspended':
      return 'SessionWaiting';
    default:
      return 'SessionPending';
  }
}
