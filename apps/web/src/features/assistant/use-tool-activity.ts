import type { agentProgressSchema, agentToolProgressSchema } from '@study/contracts/ai/progress';
import type { ChatMessage } from '@study/contracts/conversations/messages';
import { useQuery } from '@tanstack/react-query';

import { assistantReplyOptions, assistantToolProgressOptions } from './assistant.queries';

/** Keeps the disclosure mounted as a reply settles, and reloads it after navigation. */
export function useToolActivity(message: ChatMessage) {
  const provenance = useQuery(assistantReplyOptions(message));
  const requestId = provenance.data?.state === 'available' ? provenance.data.requestId : undefined;
  const pending =
    message.versions.find((version) => version.id === message.activeVersionId)?.status !==
    'complete';
  const progress = useQuery(assistantToolProgressOptions(requestId, pending));
  const runs = progress.data?.filter((run) => run.agentId === 'assistant') ?? [];

  return {
    tools: runs.flatMap((run) =>
      run.tools.map((tool) => ({
        ...settledTool(tool, run),
        activityId: `${run.runId}:${tool.toolCallId}`
      }))
    ),
    error: provenance.isError || progress.isError,
    retry: () => {
      void provenance.refetch();

      if (requestId) void progress.refetch();
    }
  };
}

function settledTool(
  tool: typeof agentToolProgressSchema.Type,
  run: typeof agentProgressSchema.Type
): typeof agentToolProgressSchema.Type {
  if (tool.status !== 'running') return tool;

  if (run.status === 'cancelled' || run.executionStatus === 'cancelled')
    return { ...tool, status: 'cancelled' };

  if (run.status === 'failed' || run.executionStatus === 'completed')
    return {
      ...tool,
      status: 'failed',
      errorKind: tool.errorKind ?? run.failureKind ?? 'internal'
    };

  return tool;
}
