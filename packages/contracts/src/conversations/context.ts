import { Schema } from 'effect';

import {
  contentSnapshotIdSchema,
  studyDocumentIdSchema,
  sessionIdSchema,
  messageIdSchema,
  versionIdSchema,
  partIdSchema
} from '../ids.ts';
import { contentInputSchema, contentInputKey, contentRangeSchema } from '../inputs.ts';
import {
  blockIdSchema,
  anchorSchema,
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

/** A selection pins an authored version or an exact completed source extraction. */
export const selectionReferenceSchema = contentInputSchema;

export const selectionRangeSchema = contentRangeSchema;

export const sessionSelectionTargetSchema = Schema.Struct({
  input: selectionReferenceSchema,
  scope: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('document') }),
    Schema.Struct({
      kind: Schema.Literal('blocks'),
      blockIds: Schema.Array(blockIdSchema).check(Schema.isBetweenLength(1, 200))
    }),
    Schema.Struct({
      kind: Schema.Literal('ranges'),
      ranges: Schema.Array(selectionRangeSchema).check(Schema.isBetweenLength(1, 200))
    })
  ])
});

/** Stable identity includes the source revision and extraction, never a mutable head. */
export const selectionReferenceKey = contentInputKey;

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
  additionalSessionIds: Schema.optional(Schema.Array(sessionIdSchema).check(Schema.isMinLength(1))),
  threadRoot: Schema.optional(partIdSchema),
  throughMessageId: Schema.optional(messageIdSchema),
  intentKey: Schema.String.check(Schema.isBetweenLength(1, 200)),
  instruction: Schema.String.check(Schema.isMaxLength(100000)),
  preferences: runPreferencesSchema
});

/** Persisted owner intent, not a client-supplied capture option. */
export const sessionContextIntentSchema = Schema.Struct({
  ...captureSessionContextSchema.fields,
  /** Digest of the complete normalized atomic Ask input. */
  askDigest: Schema.optional(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)))
});

export const resolvedSelectionSchema = Schema.Struct({
  ...sessionSelectionTargetSchema.fields,
  snapshotId: contentSnapshotIdSchema,
  documentId: Schema.NullOr(studyDocumentIdSchema),
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
  ...sessionContextIntentSchema.fields,
  selectionRevision: Schema.BigInt,
  includedSessions: Schema.optional(
    Schema.Array(
      Schema.Struct({
        sessionId: sessionIdSchema,
        title: Schema.NullOr(Schema.String),
        selectionRevision: Schema.BigInt
      })
    )
  ),
  inputs: Schema.Array(resolvedSelectionSchema),
  messages: Schema.Array(conversationMessageSnapshotSchema),
  excludedMessages: Schema.Int
});
