import type { ChatMessage } from '@study/contracts/conversations/messages';
import type { executionSchema } from '@study/contracts/workflows/schemas';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  assistantAskOptions,
  assistantExecutionOptions,
  assistantKey,
  assistantReplyOptions,
  assistantSessionOptions,
  assistantThreadOptions
} from './assistant.queries';
import { useAssistantDraft } from './conversation';

/** Reads committed history and keeps idempotent sends recoverable after transport failures. */
export function useAssistant() {
  const cache = useQueryClient();
  const { draft, setDraft } = useAssistantDraft();
  const session = useQuery(assistantSessionOptions());
  const history = useInfiniteQuery(assistantThreadOptions(session.data?.id));
  const messages = [
    ...new Map(
      (history.data?.pages.flatMap((page) => page.items) ?? []).map((message) => [
        message.id,
        message
      ])
    ).values()
  ].toSorted((a, b) => (a.id < b.id ? -1 : 1));
  const pending = messages.findLast(pendingReply);
  const provenance = useQuery(assistantReplyOptions(pending));
  const requestId = provenance.data?.state === 'available' ? provenance.data.requestId : undefined;
  const work = useQuery(assistantExecutionOptions(requestId));
  const execution = work.data?.items[0];
  const busy = replyBusy(pending, execution);
  const mutation = useMutation({
    ...assistantAskOptions(),
    onSuccess: (_result, input) => {
      setDraft((current) => (current.text.trim() === input.text ? { text: '' } : current));

      return cache.invalidateQueries({ queryKey: assistantKey });
    },
    onError: () => cache.invalidateQueries({ queryKey: assistantKey })
  });

  return {
    messages,
    pending,
    requestId,
    execution,
    history,
    session,
    mutation,
    draft: draft.text,
    blocked: busy || mutation.isPending || !history.isSuccess,
    error: [session, history, mutation, provenance, work].find((result) => result.error)?.error,
    retry: () => {
      void cache.invalidateQueries({ queryKey: assistantKey });
    },
    setDraft: (text: string) => {
      mutation.reset();
      setDraft({ ...draft, text });
    },
    send: () => {
      const text = draft.text.trim();

      if (!text || busy || mutation.isPending || !history.isSuccess) return false;

      const intentKey = draft.intent?.text === text ? draft.intent.key : crypto.randomUUID();

      setDraft({ ...draft, intent: { text, key: intentKey } });
      mutation.mutate({ text, intentKey });

      return true;
    }
  };
}

function pendingReply(message: ChatMessage) {
  return (
    message.role === 'assistant' &&
    message.versions.find((version) => version.id === message.activeVersionId)?.status !==
      'complete'
  );
}

function replyBusy(
  message: ChatMessage | undefined,
  execution: typeof executionSchema.Type | undefined
) {
  return (
    !!message && (!execution || ['running', 'suspended', 'cancelling'].includes(execution.status))
  );
}
