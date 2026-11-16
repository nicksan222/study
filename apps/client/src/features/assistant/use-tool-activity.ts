import type { ChatMessage } from '@study/contracts';
import { rpc } from '@study/contracts/react';

import { settledAgentTool } from '../agent-progress';
import { useAssistantReply } from './assistant.queries';

/** Keeps the disclosure mounted as a reply settles, and reloads it after navigation. */
export function useToolActivity(message: ChatMessage) {
  const provenance = useAssistantReply(message);
  const requestId = provenance.data?.state === 'available' ? provenance.data.requestId : undefined;
  const progress = rpc.workflows.agentProgress.useQuery(
    requestId ? { correlationId: requestId } : undefined
  );
  const runs =
    progress.data?.filter(
      (run) => run.agentId === 'assistant' || run.agentId === 'note-assistant'
    ) ?? [];

  return {
    tools: runs.flatMap((run) =>
      run.tools.map((tool) => ({
        ...settledAgentTool(tool, run),
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
