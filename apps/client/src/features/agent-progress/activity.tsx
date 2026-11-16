import type { agentProgressInputSchema, agentProgressSchema } from '@study/contracts';
import { AiActivity } from '@study/ui';
import type { ReactNode } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { runPurposeLabels } from './run-labels';
import { useAgentProgress } from './use-agent-progress';

export type AgentActivityStatus =
  | (typeof agentProgressSchema.Type)['status']
  | 'waiting'
  | 'stopping';

/** Sidebar work names only its current phase; history belongs in the details dialog. */
export function AgentActivity({
  label,
  status,
  action,
  ...input
}: typeof agentProgressInputSchema.Type & {
  label: string;
  status: AgentActivityStatus;
  action?: ReactNode;
}) {
  const { t } = useI18n();
  const { runs } = useAgentProgress(input);
  const live = status === 'running' || status === 'waiting';
  const current = live
    ? runs.findLast((run) => run.status === 'running' && run.executionStatus === 'running')
    : undefined;
  const phaseLabel = activityLabel(current, label, t);

  const state = current ? 'running' : activityState(status);

  return (
    <AiActivity
      action={action}
      label={phaseLabel}
      state={state}
      variant={state === 'attention' || state === 'waiting' ? 'chip' : 'plain'}
    />
  );
}

function activityState(status: AgentActivityStatus) {
  switch (status) {
    case 'running':
      return 'running';
    case 'stopping':
      return 'stopping';
    case 'failed':
      return 'attention';
    default:
      return 'waiting';
  }
}

function activityLabel(
  current: typeof agentProgressSchema.Type | undefined,
  fallback: string,
  t: ReturnType<typeof useI18n>['t']
) {
  if (current?.phase === 'preparing') return t('AgentActivityPreparing');

  if (current?.phase === 'compacting') return t('AgentActivityCompacting');

  return current?.trace ? t(runPurposeLabels[current.trace.purpose]) : fallback;
}
