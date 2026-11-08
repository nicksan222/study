/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Creates, reads, updates, and removes note threads.                                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Scopes thread reads and writes to their owning note and attachments.                   │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the notes service applies policy and            │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { PartId, NoteId } from '@study/contracts/ids';
import { eq, sql } from '@study/db';
import { message_parts, messages } from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

export function makeThread({ db }: StoreResources) {
  function assertThreadRoot(noteId: NoteId, threadRoot: PartId) {
    const root = db.orm
      .select({
        noteId: messages.note_id,
        threadRoot: messages.thread_root,
        archivedAt: messages.archived_at,
        sourceArchived: sql<boolean>`EXISTS (SELECT 1 FROM note_sources a WHERE a.note_id=${messages.note_id} AND a.source_id=${message_parts.source_id} AND a.archived_at IS NOT NULL)`
      })
      .from(message_parts)
      .innerJoin(messages, eq(messages.id, message_parts.message_id))
      .where(eq(message_parts.id, threadRoot))
      .get();

    if (
      !root ||
      root.noteId !== noteId ||
      root.threadRoot !== null ||
      root.archivedAt !== null ||
      root.sourceArchived
    )
      throw new StudyError('invalid_input', 'invalid thread root');
  }

  return { assertThreadRoot };
}
