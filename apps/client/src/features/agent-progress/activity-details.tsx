import type { agentProgressInputSchema, agentProgressSchema } from '@study/contracts';
import { agentProgressLimit } from '@study/contracts';
import { Dialog, DialogPopup, DialogBody, DialogHeading, Trace, TraceDescription } from '@study/ui';
import type { ReactNode } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import type { AgentActivityStatus as Status } from './activity';
import { RunHistory } from './run-history';
import { useAgentProgress } from './use-agent-progress';

type Run = typeof agentProgressSchema.Type;

/** The same persisted history opens on demand, outside the sidebar's compact status. */
export function AgentActivityDetails({
  open,
  onOpenChange,
  title,
  children,
  ...input
}: typeof agentProgressInputSchema.Type & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  status: Status;
  children?: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup closeLabel={t('Close')}>
        <DialogHeading title={t('AgentActivityDetails')} description={title} />
        <DialogBody>
          {children}
          <ActivityHistory {...input} />
        </DialogBody>
      </DialogPopup>
    </Dialog>
  );
}

function ActivityHistory({
  status,
  ...input
}: typeof agentProgressInputSchema.Type & { status: Status }) {
  const { t } = useI18n();
  const progress = useAgentProgress(input);
  const runs = progress.runs.map((run) => settleRun(run, status));

  return (
    <Trace density="compact" aria-label={t('AgentActivitySteps')}>
      {runs.length === agentProgressLimit && (
        <TraceDescription>{t('AgentActivityRecentSteps')}</TraceDescription>
      )}
      {progress.isError && <TraceDescription>{t('AgentActivityUnavailable')}</TraceDescription>}
      {!progress.isError && !runs.length && (
        <TraceDescription>
          {t(
            status === 'running' || status === 'waiting' || status === 'stopping'
              ? 'AgentActivityWaiting'
              : 'AgentActivityEmpty'
          )}
        </TraceDescription>
      )}
      <RunHistory runs={runs} />
    </Trace>
  );
}

function settleRun(run: Run, owner: Status): Run {
  if (run.status !== 'running') return run;

  if (owner === 'failed' || owner === 'cancelled' || owner === 'completed')
    return { ...run, status: owner };

  if (run.executionStatus === 'cancelled') return { ...run, status: 'cancelled' };

  if (run.executionStatus === 'completed') return { ...run, status: 'failed' };

  return run;
}
