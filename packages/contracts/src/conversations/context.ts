import { Schema } from 'effect';

import {
  documentIdSchema,
  materialIdSchema,
  materialVersionIdSchema,
  sessionIdSchema,
  messageIdSchema,
  versionIdSchema,
  partIdSchema
} from '../ids.ts';
import {
  blockIdSchema,
  anchorSchema,
  documentTextRangeSchema,
  blockContentSchema,
  documentSchema
} from '../sources/schemas.ts';

export const messageRoleSchema = Schema.Literals(['assistant', 'user']);

export const conversationMessageSnapshotSchema = Schema.Struct({
  messageId: messageIdSchema,
  versionId: versionIdSchema,
  role: messageRoleSchema,
  text: Schema.String
});

/** Active context is independent of material membership; removal is an explicit guarded update. */
export const sessionSelectionTargetSchema = Schema.Struct({
  versionId: materialVersionIdSchema,
  documentId: Schema.optional(documentIdSchema),
  scope: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('document') }),
    Schema.Struct({
      kind: Schema.Literal('blocks'),
      blockIds: Schema.Array(blockIdSchema).check(Schema.isBetweenLength(1, 200))
    }),
    Schema.Struct({
      kind: Schema.Literal('ranges'),
      ranges: Schema.Array(documentTextRangeSchema).check(Schema.isBetweenLength(1, 200))
    })
  ])
});
export const selectionTargetsSchema = Schema.Array(sessionSelectionTargetSchema).check(
  Schema.isMaxLength(20)
);
export const sessionSelectionInputSchema = Schema.Struct({ sessionId: sessionIdSchema });
export const sessionSelectionSchema = Schema.Struct({
  revision: Schema.BigInt,
  targets: selectionTargetsSchema
});
export const updateSessionSelectionSchema = Schema.Struct({
  sessionId: sessionIdSchema,
  expectedRevision: Schema.BigInt,
  targets: selectionTargetsSchema
});
export const runPreferencesSchema = Schema.Struct({
  language: Schema.optional(Schema.Literals(['english', 'italian'])),
  detail: Schema.optional(Schema.Literals(['brief', 'balanced', 'detailed']))
});
export const captureSessionContextSchema = Schema.Struct({
  sessionId: sessionIdSchema,
  threadRoot: Schema.optional(partIdSchema),
  throughMessageId: Schema.optional(messageIdSchema),
  intentKey: Schema.String.check(Schema.isBetweenLength(1, 200)),
  instruction: Schema.String.check(Schema.isMaxLength(100000)),
  preferences: runPreferencesSchema
});
export const resolvedSelectionSchema = Schema.Struct({
  ...sessionSelectionTargetSchema.fields,
  documentId: documentIdSchema,
  materialId: materialIdSchema,
  name: Schema.String,
  document: Schema.optional(documentSchema),
  excerpts: Schema.Array(
    Schema.Struct({
      blockId: blockIdSchema,
      blockOrdinal: Schema.Int,
      start: Schema.Int,
      end: Schema.Int,
      text: Schema.String,
      anchor: anchorSchema,
      content: Schema.optional(blockContentSchema)
    })
  )
});
export const runSelectionContextSchema = Schema.Struct({
  requestId: Schema.String,
  ...captureSessionContextSchema.fields,
  selectionRevision: Schema.BigInt,
  inputs: Schema.Array(resolvedSelectionSchema),
  messages: Schema.Array(conversationMessageSnapshotSchema),
  excludedMessages: Schema.Int
});
