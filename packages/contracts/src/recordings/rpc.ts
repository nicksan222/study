import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

import { failureSchema } from '../errors.ts';
import { recordingIdSchema, sessionIdSchema } from '../ids.ts';
import { recordingViewSchema, recordingPostSchema } from './schemas.ts';

export const recordingPageInputSchema = Schema.Struct({
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  before: Schema.optional(recordingIdSchema)
});

const recordingPageSchema = Schema.Struct({
  items: Schema.Array(recordingViewSchema),
  next: Schema.NullOr(recordingIdSchema)
});

export const appendRecordingInputSchema = Schema.Struct({
  id: recordingIdSchema,
  samples: Schema.Array(
    Schema.Int.check(Schema.isBetween({ minimum: -32768, maximum: 32767 }))
  ).check(Schema.isMinLength(1), Schema.isMaxLength(960000))
});

export const postRecordingInputSchema = Schema.Struct({
  session: sessionIdSchema,
  recording: recordingIdSchema,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255))
});

export const RecordingsRpc = RpcGroup.make(
  Rpc.make('createRecording', {
    payload: { id: sessionIdSchema },
    success: recordingViewSchema,
    error: failureSchema
  }),
  Rpc.make('appendRecording', {
    payload: appendRecordingInputSchema,
    success: Schema.Void,
    error: failureSchema
  }),
  Rpc.make('recording', {
    payload: { id: recordingIdSchema },
    success: recordingViewSchema,
    error: failureSchema
  }),
  Rpc.make('recordings', {
    payload: recordingPageInputSchema,
    success: recordingPageSchema,
    error: failureSchema
  }),
  Rpc.make('deleteRecording', {
    payload: { id: recordingIdSchema },
    success: Schema.Boolean,
    error: failureSchema
  }),
  Rpc.make('recordingPost', {
    payload: { requestId: Schema.String.check(Schema.isMinLength(1)) },
    success: recordingPostSchema,
    error: failureSchema
  }),
  Rpc.make('postRecording', {
    payload: postRecordingInputSchema,
    success: recordingPostSchema,
    error: failureSchema
  })
).prefix('recordings.');
