import type { MessageId } from '@study/contracts/ids';
import type { executionSchema } from '@study/contracts/workflows/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useAgentProgress } from '#web/features/agent-progress/index.tsx';
import { useAiReadiness } from '#web/lib/ai-readiness.ts';
import { applyAppearance } from '#web/lib/appearance.ts';

import {
  assistantAppearanceOptions,
  assistantAuthOptions,
  assistantExecutionOptions,
  assistantKey,
  retryAssistantReplyOptions,
  stopAssistantReplyOptions
} from './assistant.queries';

/** Keeps cancellation, retry and live progress tied to the exact durable reply request. */
export function useReply(requestId: string, messageId: MessageId) {
  const cache = useQueryClient();
  const readiness = useAiReadiness('smart');
  const progress = useAgentProgress({ correlationId: requestId });
  const observedTools = useRef(new Set<string>());
  const completedTools = progress.runs.flatMap((run) =>
    run.tools.filter((tool) => tool.status === 'completed')
  );
  const toolRevision = completedTools.map((tool) => tool.toolCallId).join('|');

  useEffect(() => {
    const fresh = completedTools.filter((tool) => !observedTools.current.has(tool.toolCallId));

    if (!fresh.length) return;

    for (const tool of fresh) observedTools.current.add(tool.toolCallId);

    void cache.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] !== assistantKey[0] && query.queryKey[0] !== 'note-drafts'
    });

    if (
      fresh.some((tool) => tool.toolName.startsWith('update_') || tool.toolName.includes('theme'))
    )
      void cache
        .fetchQuery(assistantAppearanceOptions())
        .then(applyAppearance)
        .catch(() => {});
  }, [cache, completedTools, toolRevision]);

  const work = useQuery(assistantExecutionOptions(requestId));
  const execution = work.data?.items[0];
  const outcome = replyOutcome(execution);
  const account = useQuery(assistantAuthOptions(outcome.suspended));
  const refresh = () => cache.invalidateQueries({ queryKey: assistantKey });
  const retry = useMutation({ ...retryAssistantReplyOptions(), onSuccess: refresh });
  const stop = useMutation({ ...stopAssistantReplyOptions(), onSuccess: refresh });

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
      if (readiness === 'ready') retry.mutate(messageId);
    },
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
