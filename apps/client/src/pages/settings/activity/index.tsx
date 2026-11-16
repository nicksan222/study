import type { executionCursorSchema, executionSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { CancelledIcon, CompletedIcon, ErrorIcon, QueuedIcon, ThinkingIcon } from '@study/icons';
import { Button, Loading, RetryButton, Settings } from '@study/ui';
import { useState } from 'react';

import type { AgentActivityStatus } from '#client/features/agent-progress/index.tsx';
import { AgentActivityDetails } from '#client/features/agent-progress/index.tsx';
import { workflowLabel } from '#client/features/agent-progress/index.tsx';
import { useI18n } from '#client/lib/i18n.tsx';

type Execution = typeof executionSchema.Type;

type Cursor = typeof executionCursorSchema.Type;

/** Historical execution identity keeps the inspector available after work leaves the sidebar. */
export function AiActivitySettings() {
  const { t } = useI18n();
  const [cursors, setCursors] = useState<readonly (Cursor | undefined)[]>([undefined]);
  const query = rpc.workflows.executions.useQuery({ limit: 30, before: cursors.at(-1) });
  const [selection, setSelection] = useState<Execution>();
  const items = query.data?.items ?? [];
  // Keep the selected snapshot across pagination and refreshes; use live state when still present.
  const selected = items.find((item) => item.id === selection?.id) ?? selection;

  return (
    <Settings.Section title={t('AiActivityTitle')}>
      <Settings.Intro>{t('AiActivityDescription')}</Settings.Intro>
      <ActivityList query={query} select={setSelection} />
      <ActivityNavigation
        query={query}
        hasPrevious={cursors.length > 1}
        previous={() => setCursors((previous) => previous.slice(0, -1))}
        next={(cursor) => setCursors((previous) => [...previous, cursor])}
      />
      {selected && (
        <AgentActivityDetails
          executionId={selected.id}
          title={t(workflowLabel(selected.workflow))}
          status={executionStatus(selected)}
          open
          onOpenChange={(open) => {
            if (!open) setSelection(undefined);
          }}
        />
      )}
    </Settings.Section>
  );
}

type HistoryQuery = ReturnType<typeof rpc.workflows.executions.useQuery>;

function ActivityList({
  query,
  select
}: {
  query: HistoryQuery;
  select: (item: Execution) => void;
}) {
  const { t, date } = useI18n();
  const items = query.data?.items ?? [];
  const timestamp = (value: bigint) =>
    value <= 8_640_000_000_000_000n
      ? date(value / 1000n, { dateStyle: 'medium', timeStyle: 'short' })
      : t('workspace.dateUnavailable');

  if (query.isPending) return <Loading label={t('AiActivityLoading')} layout="panel" />;

  if (query.isError)
    return (
      <Settings.Status
        action={
          <RetryButton
            variant="outline"
            size="sm"
            label={t('Retry')}
            onClick={() => void query.refetch()}
          />
        }
      >
        {t('AiActivityError')}
      </Settings.Status>
    );

  if (!items.length) return <Settings.Empty>{t('AiActivityEmpty')}</Settings.Empty>;

  return (
    <Settings.Group>
      {items.map((item) => {
        const Icon = executionIcon(item);

        return (
          <Settings.Item
            key={item.id}
            label={t(workflowLabel(item.workflow))}
            description={`${t(executionLabel(item))} · ${timestamp(item.createdAtMs)}`}
            icon={<Icon />}
            onClick={() => select(item)}
          />
        );
      })}
    </Settings.Group>
  );
}

function ActivityNavigation({
  query,
  hasPrevious,
  previous,
  next
}: {
  query: HistoryQuery;
  hasPrevious: boolean;
  previous: () => void;
  next: (cursor: Cursor) => void;
}) {
  const { t } = useI18n();

  return (
    <Settings.Actions>
      {hasPrevious && (
        <Button variant="ghost" disabled={query.isFetching} onClick={previous}>
          {t('AiActivityRecent')}
        </Button>
      )}
      {query.data?.next && (
        <Button
          variant="ghost"
          disabled={query.isFetching}
          onClick={() => {
            const cursor = query.data?.next;

            if (cursor) next(cursor);
          }}
        >
          {t('AiActivityOlder')}
        </Button>
      )}
    </Settings.Actions>
  );
}

function executionLabel(item: Execution) {
  return item.outcome === 'failure'
    ? ('workspace.state.failure' as const)
    : (`workspace.state.${item.status}` as const);
}

function executionStatus(item: Execution): AgentActivityStatus {
  if (item.outcome === 'failure') return 'failed';

  switch (item.status) {
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'cancelling':
      return 'stopping';
    default:
      return 'waiting';
  }
}

function executionIcon(item: Execution) {
  if (item.outcome === 'failure') return ErrorIcon;

  switch (item.status) {
    case 'completed':
      return CompletedIcon;
    case 'cancelled':
      return CancelledIcon;
    case 'running':
      return ThinkingIcon;
    default:
      return QueuedIcon;
  }
}
