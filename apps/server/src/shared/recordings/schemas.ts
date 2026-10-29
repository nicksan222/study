import { Schema } from 'effect';

const recordingIdSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

export const recordingSchema = Schema.Struct({
  id: recordingIdSchema,
  sessionId: recordingIdSchema,
  startedAt: Schema.BigInt,
  updatedAt: Schema.BigInt
});

export const recordingViewSchema = Schema.Struct({
  ...recordingSchema.fields,
  samples: Schema.BigInt
});

export type Recording = typeof recordingSchema.Type;

export type RecordingView = typeof recordingViewSchema.Type;
