import type { MessageId } from '@study/contracts/ids';
import { rpc } from '@study/contracts/react';
import type { executionSchema } from '@study/contracts/workflows/schemas';

import { useAgentProgress } from '#client/features/agent-progress/index.tsx';
import { useAiReadiness } from '#client/lib/ai-readiness.ts';

/** Keeps cancellation, retry and live progress tied to the exact durable reply request. */
export function useReply(requestId: string, messageId: MessageId) {
  const readiness = useAiReadiness('smart');
  const progress = useAgentProgress({ correlationId: requestId });
  const work = rpc.workflows.executions.useQuery({ correlationId: requestId, limit: 1 });
  const execution = work.data?.items[0];
  const outcome = replyOutcome(execution);
  const account = rpc.auth.status.useQuery({}, { enabled: outcome.suspended });
  const retry = rpc.notes.reanswer.useMutation();
  const stop = rpc.workflows.cancelExecution.useMutation();

  return {
    run: progress.runs.findLast(
      (run) => run.agentId === 'assistant' || run.agentId === 'note-assistant'
    ),
    compacting: progress.runs.some(
      (run) => run.agentId === 'assistant-compaction' && run.status === 'running'
    ),
    needsSignIn: account.data?.signedIn === false,
    ...outcome,
    actionError: [retry, stop, work].some((result) => result.isError),
    stopping: stop.isPending || outcome.cancelling,
    readiness,
    retrying: retry.isPending,
    retry: () => {
      if (readiness === 'ready') void retry.mutateAsync({ messageId }).catch(() => {});
    },
    stop: () => {
      if (execution) void stop.mutateAsync({ id: execution.id, mode: 'safe' }).catch(() => {});
    }
  };
}

function replyOutcome(execution: typeof executionSchema.Type | undefined) {
  return {
    failed: execution?.outcome === 'failure' || execution?.status === 'cancelled',
    stopped: execution?.status === 'cancelled',
    auth: execution?.failureKind === 'auth',
    suspended: execution?.status === 'suspended',
    cancelling: execution?.status === 'cancelling',
    canStop: execution?.canCancel
  };
}
