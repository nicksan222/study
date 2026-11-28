import { notebookBodyCaptureKey } from '@study/contracts';
import type { NoteId, PageId, MessageId, ChatMessage, PageSummary } from '@study/contracts';

export const notebookTargetId = (
  noteId: NoteId,
  kind: 'message' | 'page',
  id: MessageId | PageId
) => `notebook-${noteId}-${kind}-${id}`;

function isVisibleNotebookMessage(message: ChatMessage) {
  if (message.captureKey === notebookBodyCaptureKey) return false;

  return (
    message.role !== 'user' ||
    !message.parts.length ||
    message.versions.some((version) => version.text.trim())
  );
}

/** Both the board and its index use the same loaded, current-note timeline. */

export function notebookMessages(noteId: NoteId, messages: readonly ChatMessage[]) {
  return [
    ...new Map(
      messages
        .filter((message) => message.noteId === noteId && isVisibleNotebookMessage(message))
        .map((message) => [message.id, message])
    ).values()
  ].toSorted((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1
  );
}

export function notebookTimeline(messages: readonly ChatMessage[], pages: readonly PageSummary[]) {
  const entries = [
    ...messages.map((message) => ({ kind: 'message' as const, message, time: message.createdAt })),
    ...[...new Map(pages.map((page) => [page.id, page])).values()].map((page) => ({
      kind: 'page' as const,
      page,
      time: page.createdAt
    }))
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
