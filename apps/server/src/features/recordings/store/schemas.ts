import { messageIdSchema, projectIdSchema, sourceIdSchema } from '@study/contracts/ids';
import { recordingPostSchema } from '@study/contracts/recordings/schemas';
import { Schema } from 'effect';

const requestSchema = Schema.Struct({ requestId: Schema.String.check(Schema.isMinLength(1)) });

export const finishRecordingPostInputSchema = Schema.Struct({
  ...requestSchema.fields,
  sourceId: sourceIdSchema,
  messageId: messageIdSchema
});

export const recordingPostSnapshotSchema = Schema.Struct({
  ...recordingPostSchema.fields,
  projectId: projectIdSchema,
  name: Schema.String,
  bytes: Schema.Uint8Array,
  durationMs: Schema.Int
});
