import type { NoteId } from '@study/contracts/ids';
import type { ChatMessage } from '@study/contracts/notes/messages';
import { rpc } from '@study/contracts/react';
import type { executionSchema } from '@study/contracts/workflows/schemas';
import { useEffect } from 'react';

import { useAiReadiness } from '#client/lib/ai-readiness.ts';
import type { AiReadiness } from '#client/lib/ai-readiness.ts';

import { useAssistantChats, useAssistantReply, useAssistantThread } from './assistant.queries';
import { useAssistantDraft, useAssistantSelection } from './note';

/** Reads committed history and keeps idempotent sends recoverable after transport failures. */
export function useAssistant(scope?: NoteId) {
  const readiness = useAiReadiness('smart');
  const { selectedId, select, takeNewChatKey, clearNewChatKey, clearSentDraft } =
    useAssistantSelection();
  const globalNote = rpc.notes.assistantNote.useQuery(
    scope === undefined ? { id: selectedId } : undefined
  );
  const scopedNote = rpc.notes.noteAssistant.useQuery(
    scope === undefined ? undefined : { noteId: scope }
  );
  const note = scope === undefined ? globalNote : scopedNote;
  const { draft, setDraft } = useAssistantDraft(note.data?.id);

  useEffect(() => {
    if (scope !== undefined || selectedId !== undefined || !note.data) return;

    select(note.data.id);
  }, [select, selectedId, note.data, scope]);
  const chats = useAssistantChats(scope === undefined);
  const createChat = rpc.notes.newAssistantNote.useMutation();
  const history = useAssistantThread(note.data?.id);
  const latest = rpc.notes.thread.useQuery(
    note.data ? { noteId: note.data.id, limit: 30 } : undefined
  );
  const messages = orderedMessages(history.data?.pages.flatMap((page) => page.items));
  const pending = latest.data?.items.findLast(pendingReply);
  const provenance = useAssistantReply(pending);
  const { requestId, work } = useReplyExecution(provenance.data);
  const execution = work.data?.items[0];
  const busy = replyBusy(pending, execution);
  const context = rpc.notes.assistantContext.useQuery(
    note.data ? { noteId: note.data.id } : undefined
  );
  const mutation = rpc.notes.assistantAsk.useMutation();
  const blocked = sendBlocked(readiness, busy, mutation.isPending, history.isSuccess);

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

      void createChat
        .mutateAsync({ key: takeNewChatKey() })
        .then((created) => {
          clearNewChatKey();
          mutation.reset();
          select(created.id);
        })
        .catch(() => {});
    },
    messages,
    pending,
    requestId,
    execution,
    history,
    note,
    mutation,
    draft: draft.text,
    readiness,
    blocked,
    error: [note, history, mutation, provenance, work].find((result) => result.error)?.error,
    retry: () => {
      if (mutation.isError) mutation.reset();

      [note, history, latest, provenance, work, chats, context].forEach((query) => query.refetch());
    },
    setDraft: (text: string) => {
      if (!mutation.isPending) mutation.reset();

      setDraft({ ...draft, text });
    },
    send: () => {
      const text = draft.text.trim();

      if (blocked || !text) return false;

      const intentKey = draft.intent?.text === text ? draft.intent.key : crypto.randomUUID();

      setDraft({ ...draft, intent: { text, key: intentKey } });
      const noteId = note.data?.id;

      void mutation
        .mutateAsync({ text, intentKey, noteId })
        .then(() => {
          if (noteId !== undefined) clearSentDraft(noteId, text);
        })
        .catch(() => {});

      return true;
    }
  };
}

function sendBlocked(
  readiness: AiReadiness,
  busy: boolean,
  sending: boolean,
  historyReady: boolean
) {
  return readiness !== 'ready' || busy || sending || !historyReady;
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

function orderedMessages(messages: readonly ChatMessage[] = []) {
  return [...new Map(messages.map((message) => [message.id, message])).values()].toSorted((a, b) =>
    a.id < b.id ? -1 : 1
  );
}

function useReplyExecution(provenance: ReturnType<typeof useAssistantReply>['data']) {
  const requestId = provenance?.state === 'available' ? provenance.requestId : undefined;
  const work = rpc.workflows.executions.useQuery(
    requestId ? { correlationId: requestId, limit: 1 } : undefined
  );

  return { requestId, work };
}
