import type { MessageId, NoteId, ChatMessage } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { useState } from 'react';

/** Route preparation is a bounded one-shot read; mounted views always open live snapshots. */
export async function loadAssistant() {
  const note = await rpc.notes.assistantNote.read({});

  await rpc.notes.thread.read({ noteId: note.id, limit: 30 });
}

/** Explicit cursor navigation replaces the visible page rather than accumulating stale membership. */
export function useAssistantChats(enabled: boolean) {
  const [before, setBefore] = useState<NoteId>();
  const query = rpc.notes.assistantChats.useQuery(enabled ? { limit: 30, before } : undefined);

  return {
    ...query,
    data: query.data ? { pages: [query.data] } : undefined,
    hasNextPage: !!query.data?.next,
    isFetchingNextPage: query.isFetching,
    fetchNextPage: () => {
      if (query.data?.next) setBefore(query.data.next);
    }
  };
}

export function useAssistantThread(noteId?: NoteId) {
  const [page, setPage] = useState<{ noteId: NoteId; before: MessageId }>();
  const before = page && page.noteId === noteId ? page.before : undefined;
  const query = rpc.notes.thread.useQuery(
    noteId === undefined ? undefined : { noteId, before, limit: 30 }
  );

  return {
    ...query,
    data: query.data ? { pages: [query.data] } : undefined,
    hasNextPage: !!query.data?.next,
    isFetchingNextPage: query.isFetching,
    fetchNextPage: () => {
      if (noteId !== undefined && query.data?.next) setPage({ noteId, before: query.data.next });
    }
  };
}

export function useAssistantReply(message?: ChatMessage) {
  return rpc.notes.replyVersion.useQuery(
    message?.activeVersionId
      ? {
          noteId: message.noteId,
          messageId: message.id,
          versionId: message.activeVersionId
        }
      : undefined
  );
}
