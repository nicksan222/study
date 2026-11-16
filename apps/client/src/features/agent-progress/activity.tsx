import type { agentProgressInputSchema, agentProgressSchema } from '@study/contracts';
import { AiActivity } from '@study/ui';
import type { ReactNode } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

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
  const phaseLabel =
    current?.phase === 'preparing'
      ? t('AgentActivityPreparing')
      : current?.phase === 'compacting'
        ? t('AgentActivityCompacting')
        : label;

  return (
    <AiActivity
      action={action}
      label={phaseLabel}
      state={current ? 'running' : activityState(status)}
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
