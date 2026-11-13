import type { NoteId, PageId, MessageId, PartId } from '@study/contracts/ids';
import type { ChatMessage } from '@study/contracts/notes/messages';
import type { PageSummary } from '@study/contracts/pages/types';

export const notebookTargetId = (
  noteId: NoteId,
  kind: 'message' | 'page' | 'attachment',
  id: MessageId | PageId | PartId
) => `notebook-${noteId}-${kind}-${id}`;

/** Both the board and its index use the same loaded, current-note timeline. */

export function notebookMessages(noteId: NoteId, messages: readonly ChatMessage[]) {
  return [
    ...new Map(
      messages
        .filter((message) => message.noteId === noteId)
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
