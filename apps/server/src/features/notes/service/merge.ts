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

import { StudyError } from '@study/contracts';
import type {
  attachInputSchema,
  copyNoteContentSchema,
  mergeNotesInputSchema
} from '@study/contracts';
import type { Transaction } from '@study/server';
import { transaction } from '@study/server';
import { Context, Effect, Layer, Option } from 'effect';

import { NoteBodyStore } from '#server/features/notes/store/body';
import { NoteStore } from '#server/features/notes/store/index';
import { NoteMergeStore } from '#server/features/notes/store/merge';
import { TitleStore } from '#server/features/notes/store/title';
import { Pages } from '#server/features/pages/index';
import { Recordings } from '#server/features/recordings/index';
import { Sources } from '#server/features/sources/index';

type AttachMaterial = (tx: Transaction, value: typeof attachInputSchema.Type) => void;

const NoteMergeMaterials = Context.Service<AttachMaterial>('study/NoteMergeMaterials');

export const mergeMaterialsLayer = (attach: AttachMaterial) =>
  Layer.succeed(NoteMergeMaterials, attach);

export const mergeNotes = Effect.fnUntraced(function* (input: typeof mergeNotesInputSchema.Type) {
  const materialAttachment = yield* Effect.serviceOption(NoteMergeMaterials);

  return yield* transaction((tx) => {
    const result = tx.store(NoteMergeStore).merge(input);

    if (result.created) {
      const copying = { noteIds: input.noteIds, targetNoteId: result.id };
      const recordingCopies = Recordings.copyNotesInTransaction(tx, copying);

      tx.store(NoteMergeStore).copyMessages({ ...copying, recordingCopies });
      copyNotebookBody(tx, copying);
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

      for (const materialId of content.materials) {
        if (Option.isNone(materialAttachment))
          throw new StudyError('internal', 'Material link participant is unavailable');

        materialAttachment.value(tx, { noteId: result.id, materialId });
      }

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
});

function copyNotebookBody(
  tx: Transaction,
  { noteIds, targetNoteId }: typeof copyNoteContentSchema.Type
) {
  const store = tx.store(NoteBodyStore);
  const ids = noteIds.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const bodies = ids.map((noteId) => store.body({ noteId }));

  if (bodies.every((body) => body.versionId === null)) return;

  store.saveBody({
    noteId: targetNoteId,
    text: bodies
      .map((body) => body.text)
      .filter((text) => text.trim())
      .join('\n\n'),
    expectedVersionId: null
  });
}

function archivedLinks<T extends { id: bigint; archivedAt: bigint | null }>(links: readonly T[]) {
  const active = new Set(links.filter((link) => link.archivedAt === null).map((link) => link.id));

  return links.filter((link) => link.archivedAt !== null && !active.has(link.id));
}
