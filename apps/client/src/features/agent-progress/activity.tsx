import type { agentProgressInputSchema, agentProgressSchema } from '@study/contracts/ai/progress';
import { agentProgressLimit } from '@study/contracts/ai/progress';
import {
  CompletedIcon,
  ErrorIcon,
  CancelledIcon,
  ThinkingIcon,
  DisclosureIcon
} from '@study/icons';
import { AiActivity } from '@study/ui/ai-button';
import { Disclosure } from '@study/ui/disclosure';
import { GenerationPreview } from '@study/ui/generation-preview';
import { Trace, TraceLine, TraceIcon, TraceTitle, TraceDescription } from '@study/ui/trace';

import { useI18n } from '#client/lib/i18n.tsx';

import { AgentToolCall } from './tool-call';
import { settledAgentTool } from './tool-state';
import { useAgentProgress } from './use-agent-progress';

type Run = typeof agentProgressSchema.Type;

type Status = Run['status'] | 'waiting' | 'stopping';

const labels = {
  running: 'workspace.state.running',
  completed: 'workspace.state.completed',
  failed: 'workspace.state.failure',
  cancelled: 'workspace.state.cancelled'
} as const;

const icons = {
  running: ThinkingIcon,
  completed: CompletedIcon,
  failed: ErrorIcon,
  cancelled: CancelledIcon
};

/** Compact persisted steps; feature-owned terminal state takes precedence over stale previews. */
export function AgentActivity({
  label,
  status,
  ...input
}: typeof agentProgressInputSchema.Type & { label: string; status: Status }) {
  const { t } = useI18n();
  const progress = useAgentProgress(input);
  const runs = progress.runs.map((run) => settleRun(run, status));
  const completed = runs.filter((run) => run.status === 'completed').length;

  return (
    <Disclosure
      variant="activity"
      summary={
        <>
          <AiActivity label={label} state={activityState(status)} />
          {completed > 0 && (
            <span>
              {completed === 1
                ? t('AgentActivityStepCompleted')
                : t('AgentActivityStepsCompleted', { count: completed })}
            </span>
          )}
          <DisclosureIcon aria-hidden="true" />
        </>
      }
    >
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
                  run.status === 'running'
                    ? 'running'
                    : run.status === 'failed'
                      ? 'error'
                      : undefined
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
    </Disclosure>
  );
}

function activityState(status: Status) {
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

function settleRun(run: Run, owner: Status): Run {
  if (run.status !== 'running') return run;

  if (owner === 'failed' || owner === 'cancelled' || owner === 'completed')
    return { ...run, status: owner };

  if (run.executionStatus === 'cancelled') return { ...run, status: 'cancelled' };

  if (run.executionStatus === 'completed') return { ...run, status: 'failed' };

  return run;
}
