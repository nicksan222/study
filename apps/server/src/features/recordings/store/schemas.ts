/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Defines internal request, post-completion, and post-snapshot schemas shared by     │
 * │ recording store operations.                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Feature stores own SQLite access and map rows to typed contracts.                      │
 * │ - Queries or mutates feature-owned database records.                                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Keeps SQL and schema mapping behind typed store operations.                              │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

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
  projectId: Schema.NullOr(projectIdSchema),
  name: Schema.String,
  bytes: Schema.Uint8Array,
  durationMs: Schema.Int
});
