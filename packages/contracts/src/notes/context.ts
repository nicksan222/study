import { Schema } from 'effect';

import {
  contentSnapshotIdSchema,
  pageIdSchema,
  noteIdSchema,
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

export const noteMessageSnapshotSchema = Schema.Struct({
  messageId: messageIdSchema,
  versionId: versionIdSchema,
  role: messageRoleSchema,
  text: Schema.String
});

/** A selection pins an authored version or an exact completed source extraction. */
export const selectionReferenceSchema = contentInputSchema;

export const selectionRangeSchema = contentRangeSchema;

export const noteSelectionTargetSchema = Schema.Struct({
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

export const selectionTargetsSchema = Schema.Array(noteSelectionTargetSchema).check(
  Schema.isMaxLength(20)
);

export const noteSelectionInputSchema = Schema.Struct({ noteId: noteIdSchema });

export const noteSelectionSchema = Schema.Struct({
  revision: Schema.BigInt,
  targets: selectionTargetsSchema
});

export const updateNoteSelectionSchema = Schema.Struct({
  noteId: noteIdSchema,
  expectedRevision: Schema.BigInt,
  targets: selectionTargetsSchema
});

export const runPreferencesSchema = Schema.Struct({
  language: Schema.optional(Schema.Literals(['english', 'italian'])),
  detail: Schema.optional(Schema.Literals(['brief', 'balanced', 'detailed']))
});

export const captureNoteContextSchema = Schema.Struct({
  noteId: noteIdSchema,
  additionalNoteIds: Schema.optional(Schema.Array(noteIdSchema).check(Schema.isMinLength(1))),
  threadRoot: Schema.optional(partIdSchema),
  throughMessageId: Schema.optional(messageIdSchema),
  intentKey: Schema.String.check(Schema.isBetweenLength(1, 200)),
  instruction: Schema.String.check(Schema.isMaxLength(100000)),
  preferences: runPreferencesSchema
});

/** Persisted owner intent, not a client-supplied capture option. */
export const noteContextIntentSchema = Schema.Struct({
  ...captureNoteContextSchema.fields,
  /** Digest of the complete normalized atomic Ask input. */
  askDigest: Schema.optional(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)))
});

export const resolvedSelectionSchema = Schema.Struct({
  ...noteSelectionTargetSchema.fields,
  snapshotId: contentSnapshotIdSchema,
  pageId: Schema.NullOr(pageIdSchema),
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
  ...noteContextIntentSchema.fields,
  selectionRevision: Schema.BigInt,
  includedNotes: Schema.optional(
    Schema.Array(
      Schema.Struct({
        noteId: noteIdSchema,
        title: Schema.NullOr(Schema.String),
        selectionRevision: Schema.BigInt
      })
    )
  ),
  inputs: Schema.Array(resolvedSelectionSchema),
  messages: Schema.Array(noteMessageSnapshotSchema),
  excludedMessages: Schema.Int
});
