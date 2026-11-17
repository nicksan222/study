/** @file Schedules automatic section naming without delaying raw capture or changing document generation. */

import type { ChatMessage } from '@study/contracts';
import { publicationTransaction, transaction } from '@study/server';
import type { Transaction } from '@study/server';

import { SectionTitleStore } from '#server/features/notes/store/section-title';
import type {
  publishSectionTitleInputSchema,
  sectionTitleInputSchema
} from '#server/features/notes/store/section-title';

/** The committed event is also the deduplication receipt across reads and process restarts. */
export function scheduleSectionTitle(tx: Transaction, message: ChatMessage) {
  const version = message.versions.find((item) => item.id === message.activeVersionId);

  if (message.format === 'document' || version?.status !== 'complete' || !version.text.trim())
    return;

  const input = { messageId: message.id, expectedActiveVersionId: version.id };
  const store = tx.store(SectionTitleStore);

  if (!store.sectionTitleEligible(input)) return;

  const snapshot = store.sectionTitleSnapshot(input);

  if (snapshot.title || snapshot.scheduled) return;

  const eventId = `section-title/${message.id}/${version.id}`;

  tx.emit({
    type: 'NoteSectionTitleRequested',
    eventId,
    causationId: null,
    correlationId: eventId,
    inputVersion: 1,
    depth: 0,
    noteId: message.noteId,
    messageId: message.id,
    versionId: version.id
  });
}

export function noteSectionTitleOperations() {
  return {
    sectionTitleSnapshot: (input: typeof sectionTitleInputSchema.Type) =>
      transaction((tx) => tx.store(SectionTitleStore).sectionTitleSnapshot(input)),
    publishSectionTitle: (input: typeof publishSectionTitleInputSchema.Type) =>
      publicationTransaction((tx) => tx.store(SectionTitleStore).publishSectionTitle(input))
  };
}
