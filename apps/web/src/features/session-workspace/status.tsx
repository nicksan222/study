import { StudyError } from '@study/contracts/errors';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { useQuery } from '@tanstack/react-query';

import { useI18n } from '../../lib/i18n';
import { toStudyError } from '../../lib/study-client/errors';
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
    <div className="session-muted" role="status">
      {state.error ? (
        <SessionReadError error={state.error} retry={() => void state.refetch()} />
      ) : latest?.outcome === 'failure' ? (
        <SessionError error={new StudyError(latest.failureKind ?? 'internal', '')} />
      ) : (
        <p>
          {t(
            latest?.status === 'completed'
              ? 'SessionCompleted'
              : latest?.status === 'cancelled'
                ? 'SessionCancelled'
                : latest?.status === 'cancelling'
                  ? 'SessionCancelling'
                  : latest?.status === 'suspended'
                    ? 'SessionWaiting'
                    : 'SessionPending'
          )}
        </p>
      )}
    </div>
  );
}
