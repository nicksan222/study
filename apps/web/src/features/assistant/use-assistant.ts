import type { NoteId } from '@study/contracts/ids';
import type { ChatMessage } from '@study/contracts/notes/messages';
import type { executionSchema } from '@study/contracts/workflows/schemas';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  assistantAskOptions,
  assistantChatsOptions,
  assistantContextOptions,
  newAssistantChatOptions,
  assistantExecutionOptions,
  assistantKey,
  assistantReplyOptions,
  assistantNoteOptions,
  assistantThreadOptions
} from './assistant.queries';
import { useAssistantDraft, useAssistantSelection } from './note';

/** Reads committed history and keeps idempotent sends recoverable after transport failures. */
export function useAssistant(scope?: NoteId) {
  const cache = useQueryClient();
  const { selectedId, select, takeNewChatKey, clearNewChatKey, clearSentDraft } =
    useAssistantSelection();
  const note = useQuery(assistantNoteOptions(selectedId, scope));
  const { draft, setDraft } = useAssistantDraft(note.data?.id);

  useEffect(() => {
    if (scope !== undefined || selectedId !== undefined || !note.data) return;

    cache.setQueryData(assistantNoteOptions(note.data.id).queryKey, note.data);
    select(note.data.id);
  }, [cache, select, selectedId, note.data, scope]);
  const chats = useInfiniteQuery({ ...assistantChatsOptions(), enabled: scope === undefined });
  const createChat = useMutation({
    ...newAssistantChatOptions(),
    onSuccess: (created) => {
      clearNewChatKey();
      mutation.reset();
      select(created.id);

      return cache.invalidateQueries({ queryKey: assistantKey });
    }
  });
  const history = useInfiniteQuery(assistantThreadOptions(note.data?.id));
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
  const context = useQuery(assistantContextOptions(note.data?.id, busy));
  const mutation = useMutation({
    ...assistantAskOptions(),
    onSuccess: (_result, input) => {
      if (input.noteId !== undefined) clearSentDraft(input.noteId, input.text);

      return cache.invalidateQueries({ queryKey: assistantKey });
    },
    onError: () => cache.invalidateQueries({ queryKey: assistantKey })
  });

  return {
    chats,
    context,
    createChat,
    selectChat: (id: NonNullable<typeof selectedId>) => {
      mutation.reset();
      select(id);
    },
    newChat: () => {
      if (createChat.isPending) return;

      createChat.mutate(takeNewChatKey());
    },
    messages,
    pending,
    requestId,
    execution,
    history,
    note,
    mutation,
    draft: draft.text,
    blocked: busy || mutation.isPending || !history.isSuccess,
    error: [note, history, mutation, provenance, work].find((result) => result.error)?.error,
    retry: () => {
      if (mutation.isError) mutation.reset();

      void cache.invalidateQueries({ queryKey: assistantKey });
    },
    setDraft: (text: string) => {
      if (!mutation.isPending) mutation.reset();

      setDraft({ ...draft, text });
    },
    send: () => {
      const text = draft.text.trim();

      if (!text || busy || mutation.isPending || !history.isSuccess) return false;

      const intentKey = draft.intent?.text === text ? draft.intent.key : crypto.randomUUID();

      setDraft({ ...draft, intent: { text, key: intentKey } });
      mutation.mutate({ text, intentKey, noteId: note.data?.id });

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
