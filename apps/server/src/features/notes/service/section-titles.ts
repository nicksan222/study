/** @file Schedules automatic section naming without delaying raw capture or changing document generation. */

import type { ChatMessage } from '@study/contracts';
import { publicationTransaction, transaction } from '@study/server';
import type { Transaction } from '@study/server';

import { SectionTitleStore } from '#server/features/notes/store/section-title';
import type {
  publishSectionTitleInputSchema,
  sectionTitleInputSchema
} from '#server/features/notes/store/section-title';
import { Workflows } from '#server/features/workflows/index';

function requestStillOwned(tx: Transaction, correlationId: string, eventId: string) {
  const runs = Workflows.correlatedExecutions(tx, correlationId, eventId);

  // An undispatched receipt, pending retry or terminal failure keeps its original owner.
  // Retain cancellation too: reading a note must not restart work the user stopped.
  return (
    !runs.length || runs.some((run) => run.status !== 'completed' || run.outcome !== 'success')
  );
}

/** A restored section can renew successfully retired work without duplicating pending requests. */
export function scheduleSectionTitle(tx: Transaction, message: ChatMessage) {
  const version = message.versions.find((item) => item.id === message.activeVersionId);

  if (message.format === 'document' || version?.status !== 'complete' || !version.text.trim())
    return;

  const input = { messageId: message.id, expectedActiveVersionId: version.id };
  const store = tx.store(SectionTitleStore);

  if (!store.sectionTitleEligible(input)) return;

  const snapshot = store.sectionTitleSnapshot(input);

  if (snapshot.title) return;

  const correlationId = `section-title/${message.id}/${version.id}`;

  if (snapshot.requestEventIds.some((id) => requestStillOwned(tx, correlationId, id))) return;

  const eventId = snapshot.requestEventIds.length
    ? `${correlationId}/${snapshot.requestEventIds.length + 1}`
    : correlationId;

  tx.emit({
    type: 'NoteSectionTitleRequested',
    eventId,
    causationId: null,
    correlationId,
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
