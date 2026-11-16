import { StudyError } from '@study/contracts/errors';
import { rpc } from '@study/contracts/react';
import { ThinkingIcon, CompletedIcon, ErrorIcon, CancelledIcon, QueuedIcon } from '@study/icons';
import { RetryButton } from '@study/ui/action-button';
import { ErrorState } from '@study/ui/error-state';
import { ExecutionLog } from '@study/ui/execution-log';

import { useI18n } from '#client/lib/i18n.tsx';
import { toStudyError } from '#client/lib/study-client/errors.ts';

import { ConfigurationWait } from './configuration-wait';
import { workflowLabel } from './workflow-label';

export function NoteError({ error, retry }: { error: unknown; retry?: () => void }) {
  const { t } = useI18n();

  return (
    <ErrorState
      title={t('NoteActionErrorTitle')}
      description={t(
        error instanceof StudyError && error.kind === 'auth'
          ? 'NoteAuthError'
          : error instanceof StudyError && error.kind === 'invalid_input'
            ? 'NoteConflict'
            : 'NoteRequestError'
      )}
      action={
        retry && <RetryButton size="sm" variant="outline" onClick={retry} label={t('Retry')} />
      }
    />
  );
}

export function NoteReadError({
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
      title={t('NoteReadErrorTitle')}
      description={t(
        toStudyError(error).kind === 'not_found' ? 'NoteReadUnavailable' : 'NoteReadError'
      )}
      action={
        retry && <RetryButton size="sm" variant="outline" onClick={retry} label={t('Retry')} />
      }
    />
  );
}

export function ExecutionStatus({ requestId }: { requestId: string }) {
  const { t, date } = useI18n();
  const state = rpc.workflows.executions.useQuery({ correlationId: requestId, limit: 30 });

  if (state.error) return <NoteReadError error={state.error} retry={() => void state.refetch()} />;

  return (
    <ExecutionLog
      label={t('NotePromptWork')}
      pendingLabel={t('NotePending')}
      items={(state.data?.items.toReversed() ?? []).map((item) => {
        const failure = item.outcome === 'failure';
        const Icon = failure ? ErrorIcon : workIcon(item.status);
        const timestamp = (value: bigint) =>
          value <= 8_640_000_000_000_000n ? date(value / 1000n) : t('workspace.dateUnavailable');

        return {
          id: item.id,
          title: t(workflowLabel(item.workflow)),
          status: t(
            `workspace.state.${item.status === 'blocked' ? 'blocked' : failure ? 'failure' : item.status}`
          ),
          icon: <Icon aria-hidden="true" />,
          metadata: [
            { label: t('NoteWorkStarted'), value: timestamp(item.createdAtMs) },
            { label: t('NoteWorkUpdated'), value: timestamp(item.updatedAtMs) },
            {
              label: t('NoteWorkElapsed'),
              value: t('NoteWorkSeconds', {
                seconds:
                  (item.updatedAtMs >= item.createdAtMs
                    ? item.updatedAtMs - item.createdAtMs
                    : 0n) / 1000n
              })
            }
          ],
          children: (
            <>
              {item.configurationWaitReason && (
                <ConfigurationWait reason={item.configurationWaitReason} />
              )}
              {failure && <NoteError error={new StudyError(item.failureKind ?? 'internal', '')} />}
            </>
          )
        };
      })}
    />
  );
}

function workIcon(status: string) {
  switch (status) {
    case 'completed':
      return CompletedIcon;
    case 'cancelled':
      return CancelledIcon;
    case 'suspended':
    case 'cancelling':
      return QueuedIcon;
    default:
      return ThinkingIcon;
  }
}
