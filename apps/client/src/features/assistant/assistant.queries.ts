import type { MessageId, NoteId } from '@study/contracts/ids';
import type { ChatMessage } from '@study/contracts/notes/messages';
import type { assistantAskInputSchema } from '@study/contracts/notes/rpc';
import type { executionIdSchema } from '@study/contracts/workflows/schemas';
import type { QueryClient } from '@tanstack/react-query';
import {
  infiniteQueryOptions,
  mutationOptions,
  queryOptions,
  skipToken
} from '@tanstack/react-query';

import { loadAppearance } from '#client/lib/study-client/operations.ts';
import { request } from '#client/lib/study-client/request.ts';

export const assistantKey = ['assistant'] as const;

export const assistantNoteOptions = (id?: NoteId, scope?: NoteId) =>
  queryOptions({
    queryKey:
      scope === undefined
        ? [...assistantKey, 'note', id?.toString()]
        : [...assistantKey, 'scoped-note', String(scope)],
    queryFn: ({ signal }) =>
      scope === undefined
        ? request((rpc) => rpc['notes.assistantNote']({ id }), signal)
        : request((rpc) => rpc['notes.noteAssistant']({ noteId: scope }), signal)
  });

export const assistantThreadOptions = (noteId?: NoteId) =>
  infiniteQueryOptions({
    queryKey: [...assistantKey, 'thread', noteId?.toString()],
    initialPageParam: undefined as MessageId | undefined,
    queryFn:
      noteId === undefined
        ? skipToken
        : ({ pageParam, signal }) =>
            request((rpc) => rpc['notes.thread']({ noteId, before: pageParam, limit: 30 }), signal),
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
      request((rpc) => rpc['notes.assistantAsk'](input)),
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
              rpc['notes.replyVersion']({
                noteId: message.noteId,
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
    mutationFn: (messageId: MessageId) => request((rpc) => rpc['notes.reanswer']({ messageId })),
    retry: false
  });

export const stopAssistantReplyOptions = () =>
  mutationOptions({
    mutationFn: (id: typeof executionIdSchema.Type) =>
      request((rpc) => rpc['workflows.cancelExecution']({ id, mode: 'safe' })),
    retry: false
  });

export async function loadAssistant({ context }: { context: { queryClient: QueryClient } }) {
  const note = await context.queryClient.ensureQueryData(assistantNoteOptions());

  await context.queryClient.ensureInfiniteQueryData(assistantThreadOptions(note.id));
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
    initialPageParam: undefined as NoteId | undefined,
    queryFn: ({ pageParam, signal }) =>
      request((rpc) => rpc['notes.assistantChats']({ limit: 30, before: pageParam }), signal),
    getNextPageParam: (page) => page.next ?? undefined
  });

export const newAssistantChatOptions = () =>
  mutationOptions({
    mutationFn: (key: string) => request((rpc) => rpc['notes.newAssistantNote']({ key })),
    retry: false
  });

export const assistantContextOptions = (noteId?: NoteId, active = false) =>
  queryOptions({
    queryKey: [...assistantKey, 'context', noteId?.toString()],
    queryFn:
      noteId === undefined
        ? skipToken
        : ({ signal }) => request((rpc) => rpc['notes.assistantContext']({ noteId }), signal),
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
