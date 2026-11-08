/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reads a note’s ordered message history and associated source references.           │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps message ordering and source references in the persistence read model.            │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the notes service applies policy and            │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { MessageId, PartId, NoteId } from '@study/contracts/ids';
import { NoteMode } from '@study/contracts/notes/schemas';
import type { noteMessageSnapshotSchema } from '@study/contracts/notes/schemas';
import { and, desc, eq, isNull, lte } from '@study/db';
import { messages, message_versions, notes, note_merges } from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

import { activeMessageCondition } from './archive.ts';

/** Capture a bounded window of complete, selected versions without reading attachments. */
export function makeHistory({ db }: StoreResources) {
  function selectedMessages() {
    return db.orm
      .select({ message: messages, version: message_versions })
      .from(messages)
      .leftJoin(
        message_versions,
        and(
          eq(message_versions.id, messages.active_version_id),
          eq(message_versions.message_id, messages.id)
        )
      );
  }

  /** Captures complete selected versions; title callers may omit a pending assistant reply. */
  function noteHistory(
    noteId: NoteId,
    through?: MessageId,
    threadRoot?: PartId,
    allowEmpty = false,
    policy: { pendingAssistant?: 'omit'; bounded?: boolean } = {}
  ) {
    const rows = selectedMessages()
      .where(
        and(
          eq(messages.note_id, noteId),
          activeMessageCondition(),
          threadRoot === undefined
            ? isNull(messages.thread_root)
            : eq(messages.thread_root, threadRoot),
          through === undefined ? undefined : lte(messages.id, through)
        )
      )
      .orderBy(desc(messages.id))
      .all()
      .filter(
        ({ message, version }) =>
          !(
            policy.pendingAssistant === 'omit' &&
            message.role === 'assistant' &&
            version?.status === 'pending'
          )
      );
    const mode = db.orm
      .select({ mode: notes.mode })
      .from(notes)
      .where(eq(notes.id, noteId))
      .get()?.mode;
    const bounded = boundedHistory(noteId, policy.bounded);
    let remaining = 200_000;
    const history: Array<typeof noteMessageSnapshotSchema.Type> = [];

    for (const { message, version } of rows) {
      if (!version || version.status !== 'complete')
        throw new StudyError('invalid_input', 'note has an unfinished message');

      if (contextFull(mode, version.text.length, remaining, history.length, bounded)) break;

      remaining -= version.text.length;
      history.push({
        messageId: message.id,
        versionId: version.id,
        role: message.role,
        text: version.text
      });
    }

    if (!history.length && !allowEmpty)
      throw new StudyError('invalid_input', 'note has no complete messages');

    return history.reverse();
  }

  /** Read a specific complete message for use as an attachment thread's root. */
  function noteRoot(noteId: NoteId, messageId: MessageId) {
    const row = selectedMessages()
      .where(
        and(
          eq(messages.note_id, noteId),
          activeMessageCondition(),
          eq(messages.id, messageId),
          isNull(messages.thread_root)
        )
      )
      .get();

    if (!row?.version || row.version.status !== 'complete')
      throw new StudyError('invalid_input', 'thread root is unavailable');

    return {
      messageId: row.message.id,
      versionId: row.version.id,
      role: row.message.role,
      text: row.version.text
    };
  }

  function isMergedNote(noteId: NoteId) {
    return (
      db.orm
        .select({ id: note_merges.note_id })
        .from(note_merges)
        .where(eq(note_merges.note_id, noteId))
        .get() !== undefined
    );
  }

  /** Merged notebooks retain all text on disk while captures use the existing recent window. */
  function boundedHistory(noteId: NoteId, explicit?: boolean) {
    return explicit ?? isMergedNote(noteId);
  }

  /** Titles use complete context while an assistant reply is still being generated. */
  function titleHistory(noteId: NoteId) {
    const merged = isMergedNote(noteId);

    return noteHistory(noteId, undefined, undefined, merged, {
      pendingAssistant: 'omit',
      bounded: merged
    });
  }

  return { noteHistory, noteRoot, titleHistory };
}

function contextFull(
  mode: NoteMode | undefined,
  size: number,
  remaining: number,
  count: number,
  bounded = false
) {
  if (size <= remaining) return false;

  if ((bounded || mode === NoteMode.Assistant) && count > 0) return true;

  throw new StudyError('not_enough', 'Active note messages exceed the context limit');
}
