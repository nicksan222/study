import type { MessageId } from '@study/contracts/ids';
import type { executionSchema } from '@study/contracts/workflows/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAgentProgress } from '#web/features/agent-progress/index.tsx';

import {
  assistantAuthOptions,
  assistantExecutionOptions,
  assistantKey,
  retryAssistantReplyOptions,
  stopAssistantReplyOptions
} from './assistant.queries';

/** Keeps cancellation, retry and live progress tied to the exact durable reply request. */
export function useReply(requestId: string, messageId: MessageId) {
  const cache = useQueryClient();
  const progress = useAgentProgress({ correlationId: requestId });
  const work = useQuery(assistantExecutionOptions(requestId));
  const execution = work.data?.items[0];
  const outcome = replyOutcome(execution);
  const account = useQuery(assistantAuthOptions(outcome.suspended));
  const refresh = () => cache.invalidateQueries({ queryKey: assistantKey });
  const retry = useMutation({ ...retryAssistantReplyOptions(), onSuccess: refresh });
  const stop = useMutation({ ...stopAssistantReplyOptions(), onSuccess: refresh });

  return {
    run: progress.runs.at(-1),
    needsSignIn: account.data?.signedIn === false,
    reconnecting: progress.connection !== 'connected',
    ...outcome,
    actionError: [retry, stop, work].some((result) => result.isError),
    stopping: stop.isPending || outcome.cancelling,
    retrying: retry.isPending,
    retry: () => retry.mutate(messageId),
    stop: () => {
      if (execution) stop.mutate(execution.id);
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
