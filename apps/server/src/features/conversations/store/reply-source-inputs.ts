import type { replySnapshotSchema } from '@study/contracts/conversations/schemas';
import { StudyError } from '@study/contracts/errors';
import { and, eq } from '@study/db';
import { conversation_reply_sources } from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

type Snapshot = typeof replySnapshotSchema.Type;
export function makeReplySourceInputs({ db }: StoreResources) {
  function expected(snapshot: Snapshot) {
    return [
      ...snapshot.messages.flatMap((message) =>
        message.attachments.map((part) => ({
          request_id: snapshot.requestId,
          part_id: part.partId,
          source_id: part.sourceId,
          revision: part.revision,
          snapshot_id: part.snapshotId
        }))
      ),
      ...(snapshot.pendingAttachments ?? []).map((part) => ({
        request_id: snapshot.requestId,
        part_id: part.partId,
        source_id: part.sourceId,
        revision: part.inputRevision,
        snapshot_id: null
      }))
    ];
  }
  function retain(snapshot: Snapshot) {
    for (const input of expected(snapshot)) {
      const old = db.orm
        .select()
        .from(conversation_reply_sources)
        .where(
          and(
            eq(conversation_reply_sources.request_id, input.request_id),
            eq(conversation_reply_sources.part_id, input.part_id)
          )
        )
        .get();
      if (
        old &&
        (old.source_id !== input.source_id ||
          old.revision !== input.revision ||
          (old.snapshot_id !== null && old.snapshot_id !== input.snapshot_id))
      )
        throw new StudyError('invalid_input', 'Captured reply source identity changed');
      db.orm
        .insert(conversation_reply_sources)
        .values(input)
        .onConflictDoUpdate({
          target: [conversation_reply_sources.request_id, conversation_reply_sources.part_id],
          set: { snapshot_id: input.snapshot_id }
        })
        .run();
    }
  }
  function assert(snapshot: Snapshot) {
    const rows = db.orm
      .select()
      .from(conversation_reply_sources)
      .where(eq(conversation_reply_sources.request_id, snapshot.requestId))
      .all();
    const inputs = expected(snapshot);
    if (
      rows.length !== inputs.length ||
      inputs.some(
        (input) =>
          !rows.some(
            (row) =>
              row.part_id === input.part_id &&
              row.source_id === input.source_id &&
              row.revision === input.revision &&
              row.snapshot_id === input.snapshot_id
          )
      )
    )
      throw new StudyError('invalid_input', 'Captured reply source pins are unavailable');
  }
  return { retain, assert };
}
