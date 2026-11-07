/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates conversation operations across persistence, evidence lookup, and       │
 * │ durable workflow requests.                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns session, message, reply, title, and recording behavior across domain services.    │
 * │ - Coordinates typed failures and persistence effects for feature callers.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ This is the conversations feature boundary for RPC and workflow callers;                 │
 * │ store implementations stay private to the service.                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import type { mergeSessionsInputSchema } from '@study/contracts/conversations/rpc';

import { SessionStore } from '#server/features/conversations/store/index';
import { SessionMergeStore } from '#server/features/conversations/store/merge';
import { TitleStore } from '#server/features/conversations/store/title';
import { Documents } from '#server/features/documents/index';
import { Materials } from '#server/features/materials/index';
import { Recordings } from '#server/features/recordings/index';
import { Sources } from '#server/features/sources/index';
import { transaction } from '#server/platform/definitions/define-store';

export const mergeSessions = (input: typeof mergeSessionsInputSchema.Type) =>
  transaction((tx) => {
    const result = tx.store(SessionMergeStore).merge(input);

    if (result.created) {
      const copying = { sessionIds: input.sessionIds, targetSessionId: result.id };
      const recordingCopies = Recordings.copySessionsInTransaction(tx, copying);

      tx.store(SessionMergeStore).copyMessages({ ...copying, recordingCopies });
      const content = tx.store(SessionMergeStore).sessionMerge(input.sessionIds);

      for (const link of content.documents)
        Documents.attachInTransaction(tx, { sessionId: result.id, documentId: link.id });

      for (const link of archivedLinks(content.documents)) {
        Documents.archiveSessionInTransaction(tx, {
          sessionId: result.id,
          documentId: link.id,
          archivedAt: link.archivedAt
        });
      }

      for (const link of content.sources)
        Sources.attachInTransaction(tx, { sessionId: result.id, sourceId: link.id });

      for (const link of archivedLinks(content.sources)) {
        Sources.archiveSessionInTransaction(tx, {
          sessionId: result.id,
          sourceId: link.id,
          archivedAt: link.archivedAt
        });
      }

      for (const materialId of content.materials)
        Materials.attachInTransaction(tx, { sessionId: result.id, materialId });

      const requestId = randomUUID();
      const snapshot = tx.store(TitleStore).captureTitle({ sessionId: result.id, requestId });

      tx.emit({
        type: 'ConversationTitleRequested',
        eventId: randomUUID(),
        causationId: null,
        correlationId: requestId,
        inputVersion: 1,
        depth: 0,
        ...snapshot
      });
    }

    return tx.store(SessionStore).session(result.id);
  });

function archivedLinks<T extends { id: bigint; archivedAt: bigint | null }>(links: readonly T[]) {
  const active = new Set(links.filter((link) => link.archivedAt === null).map((link) => link.id));

  return links.filter((link) => link.archivedAt !== null && !active.has(link.id));
}
