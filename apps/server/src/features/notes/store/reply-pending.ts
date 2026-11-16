/** @file Owns reply pending within this feature. */

import type { replyRequestInputSchema } from '@study/contracts';
import { StudyError } from '@study/contracts';
import { and, eq, message_versions, messages, note_reply_requests, sql } from '@study/db';
import type { StoreResources } from '@study/server';

import { makeDiscardPending } from './pending.ts';
import { makeReplySnapshots } from './reply-snapshots.ts';

export function makeReplyPending({ db, clock, timestampClock }: StoreResources) {
  const { readReplySnapshot } = makeReplySnapshots({ db, clock, timestampClock });
  const discardPending = makeDiscardPending({ db, clock, timestampClock });

  function retirePending(message: typeof messages.$inferSelect, preserveShell = false) {
    const pending = db.orm
      .select()
      .from(message_versions)
      .where(
        and(
          eq(message_versions.message_id, message.id),
          sql`${message_versions.status} IN ('pending', 'writing')`
        )
      )
      .all();

    for (const version of pending) discardPending(message, version, preserveShell);
  }

  /** Blocks overlapping active work and ignores failed conversions when preparing a new reply. */
  function prepareReply(input: typeof replyRequestInputSchema.Type) {
    const pending = db.orm
      .select({ message: messages, version: message_versions })
      .from(messages)
      .innerJoin(message_versions, eq(message_versions.message_id, messages.id))
      .where(
        and(
          eq(messages.note_id, input.noteId),
          sql`${message_versions.status} NOT IN ('complete', 'failed')`
        )
      )
      .limit(101)
      .all();

    if (pending.length > 100) throw new StudyError('invalid_input', 'too many pending versions');

    let activeRequest = false;

    for (const item of pending) {
      const request = db.orm
        .select()
        .from(note_reply_requests)
        .where(eq(note_reply_requests.version_id, item.version.id))
        .get();

      if (!request) {
        activeRequest = true;
        continue;
      }

      try {
        readReplySnapshot({ requestId: request.request_id });
        activeRequest = true;
      } catch (error) {
        if (!(error instanceof StudyError) || !['invalid_input', 'not_found'].includes(error.kind))
          throw error;

        discardPending(item.message, item.version);
      }
    }

    if (activeRequest) throw new StudyError('invalid_input', 'note already has a pending version');
  }

  return { discardPending, retirePending, prepareReply };
}
