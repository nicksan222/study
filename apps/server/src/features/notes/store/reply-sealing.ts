/** @file Builds notes reply sealing queries and mutations with bound store resources. */

import { StudyError, replySnapshotInputSchema, replySnapshotSchema } from '@study/contracts';
/** Owns reply sealing within this feature. */
import { eq, message_parts, note_reply_requests, source_processing } from '@study/db';
import { storeMutation } from '@study/server';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

import { makeReplyAttachments } from './reply-attachments.ts';
import { codec } from './reply-schemas.ts';
import { makeReplySnapshots } from './reply-snapshots.ts';
import { makeReplySourceInputs } from './reply-source-inputs.ts';

export function makeReplySealingMutations({ db, clock, timestampClock }: StoreResources) {
  const { readReplySnapshot } = makeReplySnapshots({ db, clock, timestampClock });
  const { attachmentDocument } = makeReplyAttachments({ db, clock, timestampClock });

  return {
    sealReplyAttachments: storeMutation({
      changes: ['notes'],
      input: replySnapshotInputSchema,
      output: replySnapshotSchema,
      run: (input) => {
        const snapshot = readReplySnapshot(input);

        if (!snapshot.pendingAttachments?.length) return snapshot;

        const messages = snapshot.messages.map((message) => ({
          ...message,
          attachments: [...message.attachments]
        }));

        for (const part of snapshot.pendingAttachments) {
          const state = db.orm
            .select()
            .from(source_processing)
            .where(eq(source_processing.source_id, part.sourceId))
            .get();

          const document = attachmentDocument(state, part.sourceId);

          const message = messages.find((item) => item.messageId === part.messageId);

          if (
            !state ||
            state.revision !== part.inputRevision ||
            state.published_request_id !== part.requestId ||
            !document ||
            !message
          )
            throw new StudyError('invalid_input', 'attachment document is not ready');

          message.attachments.push({
            partId: part.partId,
            sourceId: part.sourceId,
            sourceName: part.sourceName,
            projectId: part.projectId,
            snapshotId: document.id,
            revision: part.inputRevision
          });
        }

        for (const message of messages) {
          const order = db.orm
            .select()
            .from(message_parts)
            .where(eq(message_parts.message_id, message.messageId))
            .all();

          message.attachments.sort((a, b) =>
            Number(
              (order.find((part) => part.id === a.partId)?.ordinal ?? 0n) -
                (order.find((part) => part.id === b.partId)?.ordinal ?? 0n)
            )
          );
        }

        const { pendingAttachments: _pending, ...rest } = snapshot;

        const sealed = { ...rest, messages };

        db.orm
          .update(note_reply_requests)
          .set({ snapshot: Schema.encodeSync(codec)(sealed) })
          .where(eq(note_reply_requests.request_id, input.requestId))
          .run();

        makeReplySourceInputs({ db, clock, timestampClock }).retain(sealed);

        return sealed;
      }
    })
  };
}
