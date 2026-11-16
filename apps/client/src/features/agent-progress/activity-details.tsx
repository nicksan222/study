import type { agentProgressInputSchema, agentProgressSchema } from '@study/contracts';
import { agentProgressLimit } from '@study/contracts';
import { CompletedIcon, ErrorIcon, CancelledIcon, ThinkingIcon } from '@study/icons';
import { Dialog, DialogPopup, DialogBody } from '@study/ui';
import { DialogHeading } from '@study/ui';
import { GenerationPreview } from '@study/ui';
import { Trace, TraceLine, TraceIcon, TraceTitle, TraceDescription } from '@study/ui';
import type { ReactNode } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import type { AgentActivityStatus as Status } from './activity';
import { AgentToolCall } from './tool-call';
import { settledAgentTool } from './tool-state';
import { useAgentProgress } from './use-agent-progress';

type Run = typeof agentProgressSchema.Type;

const labels = {
  running: 'workspace.state.running',
  completed: 'AgentActivityStepComplete',
  failed: 'AgentActivityStepFailed',
  cancelled: 'AgentActivityStepCancelled'
} as const;

const icons = {
  running: ThinkingIcon,
  completed: CompletedIcon,
  failed: ErrorIcon,
  cancelled: CancelledIcon
};

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
        <TraceDescription>{t('AgentActivityWaiting')}</TraceDescription>
      )}
      {runs.map((run, index) => {
        const Icon = icons[run.status];
        const text = run.mode === 'text' ? run.text : undefined;

        return (
          <div key={run.runId}>
            <TraceLine
              status={
                run.status === 'running' ? 'running' : run.status === 'failed' ? 'error' : undefined
              }
            >
              <TraceIcon>
                <Icon />
              </TraceIcon>
              <TraceTitle>{t('AgentActivityStep', { number: index + 1 })}</TraceTitle>
              <TraceDescription>{t(labels[run.status])}</TraceDescription>
            </TraceLine>
            {run.tools.map((tool) => (
              <AgentToolCall key={tool.toolCallId} tool={settledAgentTool(tool, run)} />
            ))}
            {text && (
              <GenerationPreview
                label={t(labels[run.status])}
                text={text}
                variant="compact"
                streaming={run.status === 'running'}
              />
            )}
          </div>
        );
      })}
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
