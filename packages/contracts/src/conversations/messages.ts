import { Schema } from 'effect';

import { sourceIdSchema } from '../ids.ts';
import type { recordingSchema } from '../recordings/schemas.ts';
import type { messagePartSchema, versionOriginSchema, versionStatusSchema } from './schemas.ts';
import { chatMessageSchema, messageVersionSchema } from './schemas.ts';

export type VersionOrigin = typeof versionOriginSchema.Type;

export type VersionStatus = typeof versionStatusSchema.Type;

export type ChatMessage = typeof chatMessageSchema.Type;

export type MessageVersion = typeof messageVersionSchema.Type;

export type MessagePart = typeof messagePartSchema.Type;

export const newMessageSchema = Schema.Struct({
  sessionId: chatMessageSchema.fields.sessionId,
  threadRoot: Schema.optional(chatMessageSchema.fields.threadRoot),
  role: Schema.optional(chatMessageSchema.fields.role),
  replyTo: Schema.optional(chatMessageSchema.fields.replyTo),
  recordingId: Schema.optional(chatMessageSchema.fields.recordingId),
  recordingMs: Schema.optional(chatMessageSchema.fields.recordingMs),
  text: messageVersionSchema.fields.text,
  attachments: Schema.optional(Schema.mutable(Schema.Array(sourceIdSchema)))
});

export type NewMessage = typeof newMessageSchema.Type;

export type Recording = typeof recordingSchema.Type;
