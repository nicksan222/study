import type { agentProgressInputSchema } from '@study/contracts';
import { GenerationPreview, Trace } from '@study/ui';

import { useI18n } from '#client/lib/i18n.tsx';

import { AgentToolCall } from './tool-call';
import { settledAgentTool } from './tool-state';
import { useAgentProgress } from './use-agent-progress';

const progressLabels = {
  running: 'AgentStreamingPreview',
  completed: 'workspace.state.completed',
  failed: 'AgentStreamInterrupted',
  cancelled: 'AgentStreamInterrupted'
} as const;

/**
 * Render read-only text and tool previews with terminal-state labels.
 * Authoritative feature snapshots follow committed workflow writes;
 * raw structured output stays hidden until its owning feature publishes validated results.
 */
export function AgentProgress({
  variant = 'inline',
  ...input
}: typeof agentProgressInputSchema.Type & { variant?: 'inline' | 'compact' }) {
  const { t } = useI18n();
  const { runs } = useAgentProgress(input);

  return (
    <>
      {runs.map((run) => {
        const text = run.mode === 'text' ? run.text : undefined;
        const tools = run.tools;

        if (!text && !tools.length) return null;

        return (
          <div key={run.runId}>
            <Trace aria-label={t('AssistantActivity')}>
              {tools.map((tool) => (
                <AgentToolCall key={tool.toolCallId} tool={settledAgentTool(tool, run)} />
              ))}
            </Trace>
            <GenerationPreview
              label={t(progressLabels[run.status])}
              text={text}
              variant={variant}
              streaming={run.status === 'running'}
            />
          </div>
        );
      })}
    </>
  );
}

export { useAgentProgress } from './use-agent-progress';

export { AgentToolCall, AgentToolOutcome } from './tool-call';

export { settledAgentTool } from './tool-state';

export { AgentActivity } from './activity';

export { AgentActivityDetails } from './activity-details';

export type { AgentActivityStatus } from './activity';
export { workflowLabel } from './workflow-label';
