import type { ChatMessage } from '@study/contracts/conversations/messages';
import type { StudyDocumentSummary } from '@study/contracts/documents/types';
import type { SessionId, StudyDocumentId, MessageId, PartId } from '@study/contracts/ids';

export const notebookTargetId = (
  sessionId: SessionId,
  kind: 'message' | 'document' | 'attachment',
  id: MessageId | StudyDocumentId | PartId
) => `notebook-${sessionId}-${kind}-${id}`;

/** Both the board and its index use the same loaded, current-session timeline. */

export function notebookMessages(sessionId: SessionId, messages: readonly ChatMessage[]) {
  return [
    ...new Map(
      messages
        .filter((message) => message.sessionId === sessionId)
        .map((message) => [message.id, message])
    ).values()
  ].toSorted((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1
  );
}

export function notebookTimeline(
  messages: readonly ChatMessage[],
  documents: readonly StudyDocumentSummary[]
) {
  const entries = [
    ...messages.map((message) => ({ kind: 'message' as const, message, time: message.createdAt })),
    ...[...new Map(documents.map((document) => [document.id, document])).values()].map(
      (document) => ({
        kind: 'document' as const,
        document,
        time: document.createdAt
      })
    )
  ];

  return entries.toSorted((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

export function jumpToNotebookTarget(id: string) {
  const target = document.getElementById(id);

  if (!target) return;

  target.focus({ preventScroll: true });
  target.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start',
    inline: 'nearest'
  });
}
