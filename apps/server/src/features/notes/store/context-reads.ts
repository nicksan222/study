/** @file Owns context reads within this feature. */

import type { noteSelectionInputSchema } from '@study/contracts';
import { StudyError } from '@study/contracts';
import { and, eq, message_versions, note_deletions, note_run_contexts, notes } from '@study/db';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

import { makeAssertContextAvailable } from './context-availability.ts';
import { contextCodec, targetsCodec } from './context-schemas.ts';

export function makeContextReads({ db, clock, timestampClock }: StoreResources) {
  function note(id: typeof noteSelectionInputSchema.Type.noteId) {
    const row = db.orm.select().from(notes).where(eq(notes.id, id)).get();

    if (!row) throw new StudyError('not_found', 'Note is unavailable');

    return row;
  }

  function selection(input: typeof noteSelectionInputSchema.Type) {
    const row = note(input.noteId);

    return {
      revision: row.selection_revision,
      targets: Schema.decodeUnknownSync(targetsCodec)(row.selection)
    };
  }

  function decodeContext(value: string) {
    const snapshot = Schema.decodeUnknownSync(contextCodec)(value);

    for (const id of [snapshot.noteId, ...(snapshot.additionalNoteIds ?? [])]) {
      if (db.orm.select().from(note_deletions).where(eq(note_deletions.note_id, id)).get())
        throw new StudyError('not_found', 'Captured note is unavailable');
    }

    for (const item of snapshot.messages) {
      const version = db.orm
        .select()
        .from(message_versions)
        .where(
          and(
            eq(message_versions.id, item.versionId),
            eq(message_versions.message_id, item.messageId)
          )
        )
        .get();

      if (!version || version.text !== item.text || version.status !== 'complete')
        throw new StudyError('not_found', 'Captured note version is unavailable');
    }

    return snapshot;
  }

  function retainedContext(requestId: string) {
    return db.orm
      .select()
      .from(note_run_contexts)
      .where(eq(note_run_contexts.request_id, requestId))
      .get();
  }

  const assertContextAvailable = makeAssertContextAvailable({ db, clock, timestampClock });

  function requiredContext(requestId: string, available: boolean) {
    assertContextAvailable(requestId, available);

    const row = retainedContext(requestId);

    if (!row) throw new StudyError('not_found', 'Captured context is unavailable');

    return available
      ? decodeContext(row.snapshot)
      : Schema.decodeUnknownSync(contextCodec)(row.snapshot);
  }

  return {
    note,
    selection,
    decodeContext,
    retainedContext,
    requiredContext,
    assertContextAvailable
  };
}
