/** @file Owns reply snapshots within this feature. */

import type { replySnapshotInputSchema } from '@study/contracts';
import { StudyError } from '@study/contracts';
import { eq, message_versions, messages, note_reply_requests, notes } from '@study/db';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

import { makeAssertContextAvailable } from './context-availability.ts';
import { makeReplyAttachments } from './reply-attachments.ts';
import { makeReplyCapture } from './reply-capture.ts';
import { matchesRequest, replyContextMatches, replySelectionMatches } from './reply-identity.ts';
import { codec } from './reply-schemas.ts';

export function makeReplySnapshots({ db, clock, timestampClock }: StoreResources) {
  const { sourceInputs } = makeReplyCapture({ db, clock, timestampClock });
  const { assertSnapshotAttachments } = makeReplyAttachments({ db, clock, timestampClock });
  const assertContextAvailable = makeAssertContextAvailable({ db, clock, timestampClock });

  function replyContext(requestId: string, actionable = true) {
    assertContextAvailable(requestId, actionable);

    const row = db.orm
      .select()
      .from(note_reply_requests)
      .where(eq(note_reply_requests.request_id, requestId))
      .get();

    if (!row) throw new StudyError('not_found', 'reply request not found');

    const result = Schema.decodeUnknownSync(codec)(row.snapshot);

    const note = db.orm.select().from(notes).where(eq(notes.id, row.note_id)).get();

    const target = db.orm.select().from(messages).where(eq(messages.id, result.messageId)).get();

    const version = db.orm
      .select()
      .from(message_versions)
      .where(eq(message_versions.id, row.version_id))
      .get();

    return { row, result, note, target, version };
  }

  /** Rejects stale selections and unavailable evidence before returning an actionable capture. */
  function readReplySnapshot(input: typeof replySnapshotInputSchema.Type) {
    const { row, result, note, target, version } = replyContext(input.requestId);

    if (
      !note ||
      !matchesRequest(result, row) ||
      !replyContextMatches(result, note) ||
      !replySelectionMatches(target, version, result)
    )
      throw new StudyError('invalid_input', 'reply request is stale');

    sourceInputs.assert(result);
    assertSnapshotAttachments(result);

    return result;
  }

  return { readReplySnapshot, replyContext };
}
