import type { agentProgressSchema, agentToolProgressSchema } from '@study/contracts/ai/progress';

export function settledAgentTool(
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
