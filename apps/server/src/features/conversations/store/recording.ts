import { createHash } from 'node:crypto';

import { StudyError } from '@study/contracts/errors';
import {
  messageIdSchema,
  projectIdSchema,
  sessionIdSchema,
  sourceIdSchema
} from '@study/contracts/ids';
import { eq } from '@study/db';
import { conversation_recording_posts, messages, sessions, sources } from '@study/db/schema';
import { Schema } from 'effect';

import { defineStore, storeMutation } from '#server/platform/definitions/define-store';

const inputSchema = Schema.Struct({
  requestId: Schema.String,
  sessionId: sessionIdSchema,
  sourceId: sourceIdSchema,
  projectId: projectIdSchema,
  durationMs: Schema.Number
});

function hash(input: typeof inputSchema.Type) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        input.requestId,
        input.sessionId.toString(),
        input.sourceId.toString(),
        input.projectId.toString(),
        input.durationMs
      ])
    )
    .digest('hex');
}

export const RecordingPostStore = defineStore({
  name: 'study/ConversationRecordingPostStore',
  entity: { singular: 'recordingPost', plural: 'recordingPosts' },
  make: ({ db }) => ({
    queries: {},
    mutations: {
      prepareRecordingPost: storeMutation({
        input: inputSchema,
        output: Schema.NullOr(messageIdSchema),
        run: (input) => {
          if (
            !input.requestId.trim() ||
            !Number.isSafeInteger(input.durationMs) ||
            input.durationMs < 0
          )
            throw new StudyError('invalid_input', 'invalid recording publication');

          const receipt = db.orm
            .select()
            .from(conversation_recording_posts)
            .where(eq(conversation_recording_posts.request_id, input.requestId))
            .get();

          if (receipt && receipt.input_hash !== hash(input))
            throw new StudyError('invalid_input', 'recording request does not match');

          if (receipt) return receipt.message_id;

          const session = db.orm
            .select()
            .from(sessions)
            .where(eq(sessions.id, input.sessionId))
            .get();
          const source = db.orm.select().from(sources).where(eq(sources.id, input.sourceId)).get();

          assertRecordingContext(input, session, source);

          return null;
        }
      }),
      finishRecordingPost: storeMutation({
        input: Schema.Struct({ ...inputSchema.fields, messageId: messageIdSchema }),
        output: messageIdSchema,
        run: (input) => {
          db.orm
            .update(messages)
            .set({ recording_ms: BigInt(input.durationMs), recorded_in: input.sourceId })
            .where(eq(messages.id, input.messageId))
            .run();
          db.orm
            .insert(conversation_recording_posts)
            .values({
              request_id: input.requestId,
              session_id: input.sessionId,
              input_hash: hash(input),
              message_id: input.messageId
            })
            .run();

          return input.messageId;
        }
      })
    }
  })
});

function assertRecordingContext(
  input: typeof inputSchema.Type,
  session: typeof sessions.$inferSelect | undefined,
  source: typeof sources.$inferSelect | undefined
) {
  if (
    !session ||
    session.project_id !== input.projectId ||
    !source ||
    source.project_id !== input.projectId ||
    source.origin !== 'recording' ||
    source.kind !== 'audio' ||
    !source.mime.startsWith('audio/')
  )
    throw new StudyError('invalid_input', 'recording session or source is unavailable');
}
