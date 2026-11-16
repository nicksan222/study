/** @file Builds notes reply requests queries and mutations with bound store resources. */

import { replyRequestSchema, replySnapshotInputSchema } from '@study/contracts';
/** Owns reply requests within this feature. */
import { eq, note_reply_requests } from '@study/db';
import { Option, Schema } from 'effect';

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

import { makeReplyAttachments } from './reply-attachments.ts';
import { codec } from './reply-schemas.ts';

export const ReplyRequestStore = defineStore({
  name: 'study/ReplyRequestStore',
  entity: { singular: 'replyRequest', plural: 'replyRequests' },
  make: (resources) => {
    const { db } = resources;
    const { assertSnapshotAttachments } = makeReplyAttachments(resources);

    return {
      queries: {
        findReplyRequest: storeQuery({
          role: 'optional',
          input: replySnapshotInputSchema,
          output: Schema.Option(replyRequestSchema),
          run: ({ requestId }) => {
            const row = db.orm
              .select()
              .from(note_reply_requests)
              .where(eq(note_reply_requests.request_id, requestId))
              .get();

            if (!row) return Option.none();

            const snapshot = Schema.decodeUnknownSync(codec)(row.snapshot);

            assertSnapshotAttachments(snapshot, true);

            return Option.some(snapshot);
          }
        })
      },
      mutations: {}
    };
  }
});
