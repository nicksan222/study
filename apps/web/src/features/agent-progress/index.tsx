import type { agentProgressInputSchema } from '@study/contracts/ai/progress';
import { RetryButton } from '@study/ui/action-button';
import { GenerationPreview } from '@study/ui/generation-preview';
import { Trace } from '@study/ui/trace';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

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
 * Render read-only text and tool previews with connection and terminal-state labels.
 * Refresh the authoritative feature queries when an observed workflow finishes or retires;
 * raw structured output stays hidden until its owning feature publishes validated results.
 */
export function AgentProgress(input: typeof agentProgressInputSchema.Type) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const { runs, connection, reconnect } = useAgentProgress(input);
  const previous = useRef('');
  const settled = runs.map((run) => `${run.runId}:${run.executionStatus}`).join('|');

  useEffect(() => {
    const changed = previous.current !== settled;
    const hadRuns = previous.current.length > 0;

    previous.current = settled;

    if (
      !changed ||
      !(runs.some((run) => run.executionStatus === 'completed') || (hadRuns && !runs.length))
    )
      return;

    for (const queryKey of [
      ['session-workspace'],
      ['session-generation'],
      ['session-execution'],
      ['session-work'],
      ['materials'],
      ['library'],
      ['sessions']
    ])
      void cache.invalidateQueries({ queryKey });
  }, [cache, runs, settled]);

  if (connection === 'reconnecting')
    return <GenerationPreview label={t('AgentStreamReconnecting')} />;

  if (connection === 'unavailable')
    return (
      <>
        <GenerationPreview label={t('AgentStreamUnavailable')} />
        <RetryButton
          size="sm"
          variant="ghost-muted"
          label={t('LibraryRefresh')}
          onClick={reconnect}
        />
      </>
    );

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
            <GenerationPreview label={t(progressLabels[run.status])} text={text} />
          </div>
        );
      })}
    </>
  );
}

export { useAgentProgress } from './use-agent-progress';

export { AgentToolCall, AgentToolOutcome } from './tool-call';

export { settledAgentTool } from './tool-state';
