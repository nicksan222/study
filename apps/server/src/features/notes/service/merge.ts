/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates note operations across persistence, evidence lookup, and               │
 * │ durable workflow requests.                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns note, message, reply, title, and recording behavior across domain services.       │
 * │ - Coordinates typed failures and persistence effects for feature callers.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ This is the notes feature boundary for RPC and workflow callers;                         │
 * │ store implementations stay private to the service.                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { mergeNotesInputSchema } from '@study/contracts/notes/rpc';

import { Materials } from '#server/features/materials/index';
import { NoteStore } from '#server/features/notes/store/index';
import { NoteMergeStore } from '#server/features/notes/store/merge';
import { TitleStore } from '#server/features/notes/store/title';
import { Pages } from '#server/features/pages/index';
import { Recordings } from '#server/features/recordings/index';
import { Sources } from '#server/features/sources/index';
import { transaction } from '#server/platform/definitions/define-store';

export const mergeNotes = (input: typeof mergeNotesInputSchema.Type) =>
  transaction((tx) => {
    const result = tx.store(NoteMergeStore).merge(input);

    if (result.created) {
      const copying = { noteIds: input.noteIds, targetNoteId: result.id };
      const recordingCopies = Recordings.copyNotesInTransaction(tx, copying);

      tx.store(NoteMergeStore).copyMessages({ ...copying, recordingCopies });
      const content = tx.store(NoteMergeStore).noteMerge(input.noteIds);

      for (const link of content.pages)
        Pages.attachInTransaction(tx, { noteId: result.id, pageId: link.id });

      for (const link of archivedLinks(content.pages)) {
        Pages.archiveNoteInTransaction(tx, {
          noteId: result.id,
          pageId: link.id,
          archivedAt: link.archivedAt
        });
      }

      for (const link of content.sources)
        Sources.attachInTransaction(tx, { noteId: result.id, sourceId: link.id });

      for (const link of archivedLinks(content.sources)) {
        Sources.archiveNoteInTransaction(tx, {
          noteId: result.id,
          sourceId: link.id,
          archivedAt: link.archivedAt
        });
      }

      for (const materialId of content.materials)
        Materials.attachInTransaction(tx, { noteId: result.id, materialId });

      const requestId = crypto.randomUUID();
      const snapshot = tx.store(TitleStore).captureTitle({ noteId: result.id, requestId });

      tx.emit({
        type: 'NoteTitleRequested',
        eventId: crypto.randomUUID(),
        causationId: null,
        correlationId: requestId,
        inputVersion: 1,
        depth: 0,
        ...snapshot
      });
    }

    return tx.store(NoteStore).note(result.id);
  });

function archivedLinks<T extends { id: bigint; archivedAt: bigint | null }>(links: readonly T[]) {
  const active = new Set(links.filter((link) => link.archivedAt === null).map((link) => link.id));

  return links.filter((link) => link.archivedAt !== null && !active.has(link.id));
}
