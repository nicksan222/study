import type { ChatMessage } from '@study/contracts/conversations/messages';
import type { assistantAskInputSchema } from '@study/contracts/conversations/rpc';
import type { MessageId, SessionId } from '@study/contracts/ids';
import type { executionIdSchema } from '@study/contracts/workflows/schemas';
import type { QueryClient } from '@tanstack/react-query';
import {
  infiniteQueryOptions,
  mutationOptions,
  queryOptions,
  skipToken
} from '@tanstack/react-query';

import { loadAppearance } from '#web/lib/study-client/operations.ts';
import { request } from '#web/lib/study-client/request.ts';

export const assistantKey = ['assistant'] as const;

export const assistantSessionOptions = (id?: SessionId) =>
  queryOptions({
    queryKey: [...assistantKey, 'session', id?.toString()],
    queryFn: ({ signal }) => request((rpc) => rpc['conversations.assistantSession']({ id }), signal)
  });

export const assistantThreadOptions = (sessionId?: SessionId) =>
  infiniteQueryOptions({
    queryKey: [...assistantKey, 'thread', sessionId?.toString()],
    initialPageParam: undefined as MessageId | undefined,
    queryFn:
      sessionId === undefined
        ? skipToken
        : ({ pageParam, signal }) =>
            request(
              (rpc) => rpc['conversations.thread']({ sessionId, before: pageParam, limit: 30 }),
              signal
            ),
    getNextPageParam: (page) => page.next ?? undefined,
    refetchInterval: (query) =>
      query.state.data?.pages[0]?.items.some(
        (message) =>
          message.role === 'assistant' &&
          message.versions.find((version) => version.id === message.activeVersionId)?.status !==
            'complete'
      )
        ? 1000
        : false
  });

export const assistantAskOptions = () =>
  mutationOptions({
    mutationFn: (input: typeof assistantAskInputSchema.Type) =>
      request((rpc) => rpc['conversations.assistantAsk'](input)),
    retry: false
  });

export const assistantReplyOptions = (message?: ChatMessage) =>
  queryOptions({
    queryKey: [
      ...assistantKey,
      'reply',
      message?.id.toString(),
      message?.activeVersionId?.toString()
    ],
    queryFn: message?.activeVersionId
      ? ({ signal }) =>
          request(
            (rpc) =>
              rpc['conversations.replyVersion']({
                sessionId: message.sessionId,
                messageId: message.id,
                versionId: message.activeVersionId!
              }),
            signal
          )
      : skipToken
  });

export const assistantExecutionOptions = (requestId?: string) =>
  queryOptions({
    queryKey: [...assistantKey, 'execution', requestId],
    queryFn: requestId
      ? ({ signal }) =>
          request(
            (rpc) => rpc['workflows.executions']({ correlationId: requestId, limit: 1 }),
            signal
          )
      : skipToken,
    refetchInterval: 1000
  });

export const retryAssistantReplyOptions = () =>
  mutationOptions({
    mutationFn: (messageId: MessageId) =>
      request((rpc) => rpc['conversations.reanswer']({ messageId })),
    retry: false
  });

export const stopAssistantReplyOptions = () =>
  mutationOptions({
    mutationFn: (id: typeof executionIdSchema.Type) =>
      request((rpc) => rpc['workflows.cancelExecution']({ id, mode: 'safe' })),
    retry: false
  });

export async function loadAssistant({ context }: { context: { queryClient: QueryClient } }) {
  const session = await context.queryClient.ensureQueryData(assistantSessionOptions());

  await context.queryClient.ensureInfiniteQueryData(assistantThreadOptions(session.id));
}

export const assistantAuthOptions = (enabled: boolean) =>
  queryOptions({
    queryKey: [...assistantKey, 'auth'],
    queryFn: ({ signal }) => request((rpc) => rpc['auth.status']({}), signal),
    enabled,
    refetchInterval: 3000
  });

export const assistantAppearanceOptions = () =>
  queryOptions({
    queryKey: ['appearance'],
    queryFn: ({ signal }) => loadAppearance(signal),
    staleTime: 0
  });

export const assistantChatsOptions = () =>
  infiniteQueryOptions({
    queryKey: [...assistantKey, 'chats'],
    initialPageParam: undefined as SessionId | undefined,
    queryFn: ({ pageParam, signal }) =>
      request(
        (rpc) => rpc['conversations.assistantChats']({ limit: 30, before: pageParam }),
        signal
      ),
    getNextPageParam: (page) => page.next ?? undefined
  });

export const newAssistantChatOptions = () =>
  mutationOptions({
    mutationFn: (key: string) =>
      request((rpc) => rpc['conversations.newAssistantSession']({ key })),
    retry: false
  });

export const assistantContextOptions = (sessionId?: SessionId, active = false) =>
  queryOptions({
    queryKey: [...assistantKey, 'context', sessionId?.toString()],
    queryFn:
      sessionId === undefined
        ? skipToken
        : ({ signal }) =>
            request((rpc) => rpc['conversations.assistantContext']({ sessionId }), signal),
    refetchInterval: active ? 1000 : false
  });

/** Completed tool activity remains inspectable from the authoritative workflow snapshot. */
export const assistantToolProgressOptions = (requestId?: string, pending = false) =>
  queryOptions({
    queryKey: [...assistantKey, 'tool-progress', requestId],
    queryFn: requestId
      ? ({ signal }) =>
          request((rpc) => rpc['workflows.agentProgress']({ correlationId: requestId }), signal)
      : skipToken,
    refetchInterval: (query) => {
      if (!query.state.data?.length) return pending ? 1000 : false;

      return query.state.data.some((run) =>
        ['running', 'suspended', 'cancelling'].includes(run.executionStatus)
      )
        ? 500
        : false;
    }
  });
