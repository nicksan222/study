import { Schema } from 'effect';

import {
  contentSnapshotIdSchema,
  messageIdSchema,
  partIdSchema,
  projectIdSchema,
  recordingIdSchema,
  noteIdSchema,
  sourceIdSchema,
  versionIdSchema
} from '../ids.ts';
import { anchorSchema, blockIdSchema } from '../sources/schemas.ts';
import { sourceKindSchema } from '../sources/sniff.ts';
import { selectionReferenceSchema, selectionRangeSchema } from './context.ts';
import {
  runSelectionContextSchema,
  runPreferencesSchema,
  noteMessageSnapshotSchema,
  messageRoleSchema
} from './context.ts';
import { messageConversionSchema } from './conversion.ts';

export const titleSourceSchema = Schema.Literals(['generated', 'provisional', 'user']);

export { messageRoleSchema, noteMessageSnapshotSchema };

export const versionStatusSchema = Schema.Literals(['complete', 'pending', 'writing', 'failed']);

export const versionOriginSchema = Schema.Literals([
  'answer',
  'edited',
  'convert',
  'improve',
  'instruction',
  'summarize',
  'typed'
]);

export const noteSchema = Schema.Struct({
  projectIds: Schema.Array(projectIdSchema),
  id: noteIdSchema,
  title: Schema.String,
  titleSource: titleSourceSchema,
  archivedAt: Schema.NullOr(Schema.BigInt),
  createdAt: Schema.BigInt,
  updatedAt: Schema.BigInt
});

export { anchorSchema };

const citationSchema = Schema.Struct({
  origin: Schema.optional(Schema.Literal('agent')),
  precision: Schema.optional(Schema.Literals(['exact', 'approximate', 'unavailable'])),
  evidence: Schema.optional(
    Schema.Union([
      Schema.Struct({
        availability: Schema.Literal('available'),
        precision: Schema.Literals(['exact', 'approximate']),
        excerpt: Schema.String,
        snapshotId: contentSnapshotIdSchema
      }),
      Schema.Struct({
        availability: Schema.Literal('unavailable'),
        precision: Schema.Literal('unavailable'),
        reason: Schema.Literal('captured_input_unavailable')
      })
    ])
  ),
  support: Schema.optional(Schema.Struct({ state: Schema.Literal('unassessed') })),
  marker: Schema.Number,
  sourceId: Schema.NullOr(sourceIdSchema),
  input: Schema.optional(Schema.NullOr(selectionReferenceSchema)),
  documentId: Schema.optional(Schema.NullOr(contentSnapshotIdSchema)),
  blockId: Schema.optional(Schema.NullOr(blockIdSchema)),
  rangeStart: Schema.optional(Schema.NullOr(Schema.Int)),
  rangeEnd: Schema.optional(Schema.NullOr(Schema.Int)),
  sourceName: Schema.String,
  anchor: anchorSchema,
  quote: Schema.String
});

export const messageVersionSchema = Schema.Struct({
  id: versionIdSchema,
  number: Schema.BigInt,
  origin: versionOriginSchema,
  status: versionStatusSchema,
  generationRequestId: Schema.optional(Schema.String),
  text: Schema.String,
  basedOn: Schema.NullOr(versionIdSchema),
  instruction: Schema.NullOr(Schema.String),
  createdAt: Schema.BigInt
});

export const messagePartSchema = Schema.Struct({
  id: partIdSchema,
  sourceId: Schema.NullOr(sourceIdSchema),
  sourceName: Schema.String,
  sourceKind: sourceKindSchema
});

export const captureKeySchema = Schema.String.check(Schema.isBetweenLength(1, 200));

export const messageFormats = ['text', 'document'] as const;

export const messageFormatSchema = Schema.Literals(messageFormats);

export const messageDescriptionSchema = Schema.String.check(Schema.isMaxLength(240));

const questionKindSchema = Schema.Literals(['note', 'question', 'undetermined']);

export const questionVersionInputSchema = Schema.Struct({
  messageId: messageIdSchema,
  expectedActiveVersionId: versionIdSchema
});

export const setMessageKindInputSchema = Schema.Struct({
  ...questionVersionInputSchema.fields,
  kind: Schema.Literals(['note', 'question'])
});

export const questionInputSchema = Schema.Struct({ text: Schema.String });

export const questionClassificationSchema = Schema.Struct({ kind: questionKindSchema });

export const chatMessageSchema = Schema.Struct({
  question: Schema.optional(
    Schema.Struct({
      kind: questionKindSchema,
      origin: Schema.Literals(['automatic', 'manual']),
      versionId: versionIdSchema,
      answerMessageId: Schema.optional(messageIdSchema),
      answerVersionId: Schema.optional(versionIdSchema),
      answerRequestId: Schema.optional(Schema.String),
      answerArchived: Schema.optional(Schema.Boolean)
    })
  ),
  format: Schema.optional(messageFormatSchema),
  description: Schema.optional(Schema.NullOr(messageDescriptionSchema)),
  captureKey: Schema.optional(Schema.NullOr(captureKeySchema)),
  id: messageIdSchema,
  noteId: noteIdSchema,
  role: messageRoleSchema,
  threadRoot: Schema.NullOr(partIdSchema),
  replyTo: Schema.NullOr(messageIdSchema),
  activeVersionId: Schema.NullOr(versionIdSchema),
  recordingId: Schema.NullOr(recordingIdSchema),
  recordingMs: Schema.NullOr(Schema.BigInt),
  recordedIn: Schema.NullOr(sourceIdSchema),
  createdAt: Schema.BigInt,
  versions: Schema.mutable(Schema.Array(messageVersionSchema)),
  parts: Schema.mutable(Schema.Array(messagePartSchema)),
  citations: Schema.mutable(Schema.Array(citationSchema))
});

export type NoteDto = typeof noteSchema.Type;

export const replyRequestInputSchema = Schema.Struct({
  noteId: noteIdSchema,
  threadRoot: Schema.optional(partIdSchema),
  intentKey: Schema.optional(Schema.String.check(Schema.isBetweenLength(1, 200))),
  instruction: Schema.optional(Schema.String.check(Schema.isMaxLength(100000))),
  preferences: Schema.optional(runPreferencesSchema)
});

export const reanswerInputSchema = Schema.Struct({ messageId: messageIdSchema });

export const rewriteMessageInputSchema = Schema.Struct({
  messageId: messageIdSchema,
  origin: Schema.Literals(['improve', 'summarize', 'instruction']),
  instruction: Schema.optional(Schema.String.check(Schema.isMaxLength(4000)))
});

export const rewriteAgentInputSchema = Schema.Struct({
  messages: Schema.Array(Schema.Struct({ role: messageRoleSchema, content: Schema.String })),
  origin: Schema.Literals(['improve', 'summarize', 'instruction']),
  instruction: Schema.NullOr(Schema.String),
  preferences: Schema.optional(runPreferencesSchema)
});

export const replyRequestSchema = Schema.Struct({
  requestId: Schema.String,
  noteId: noteIdSchema,
  messageId: messageIdSchema,
  versionId: versionIdSchema
});

export const askInputSchema = Schema.Struct({
  noteId: noteIdSchema,
  threadRoot: Schema.optional(partIdSchema),
  intentKey: Schema.String.check(Schema.isBetweenLength(1, 200)),
  expectedSelectionRevision: Schema.BigInt,
  text: Schema.String,
  sourceIds: Schema.optional(Schema.Array(sourceIdSchema)),
  instruction: Schema.optional(Schema.String.check(Schema.isMaxLength(100000))),
  preferences: Schema.optional(runPreferencesSchema)
});

export const askResultSchema = Schema.Struct({
  ...replyRequestSchema.fields,
  userMessageId: messageIdSchema,
  userVersionId: versionIdSchema
});

export const replyVersionInputSchema = Schema.Struct({
  noteId: noteIdSchema,
  messageId: messageIdSchema,
  versionId: versionIdSchema
});

/** Exact provenance only; private input remains behind inspectNoteContext. */
export const replyVersionSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal('manual') }),
  Schema.Struct({ state: Schema.Literal('unavailable'), requestId: Schema.NullOr(Schema.String) }),
  Schema.Struct({ state: Schema.Literal('retired'), requestId: Schema.String }),
  Schema.Struct({ state: Schema.Literal('available'), requestId: Schema.String })
]);

export const replySnapshotInputSchema = Schema.Struct({ requestId: Schema.String });

export const pendingReplyAttachmentSchema = Schema.Struct({
  messageId: messageIdSchema,
  partId: partIdSchema,
  sourceId: sourceIdSchema,
  projectId: Schema.NullOr(projectIdSchema),
  sourceName: Schema.String,
  inputRevision: Schema.BigInt,
  requestId: Schema.String
});

export const replySnapshotSchema = Schema.Struct({
  ...replyRequestSchema.fields,
  contextRevision: Schema.BigInt,
  context: Schema.optional(runSelectionContextSchema),
  historyBoundary: Schema.optional(
    Schema.Struct({
      includedMessages: Schema.Int,
      excludedMessages: Schema.Int,
      reason: Schema.Literal('note-boundary')
    })
  ),
  generation: Schema.optional(
    Schema.Struct({
      origin: Schema.Literals(['answer', 'improve', 'summarize', 'instruction', 'convert']),
      conversion: Schema.optional(messageConversionSchema),
      instruction: Schema.NullOr(Schema.String),
      questionVersionId: Schema.optional(versionIdSchema)
    }).check(
      Schema.makeFilter(
        (generation) =>
          (generation.origin === 'convert') === (generation.conversion !== undefined) &&
          (generation.questionVersionId === undefined || generation.origin === 'answer')
      )
    )
  ),
  pendingAttachments: Schema.optional(Schema.Array(pendingReplyAttachmentSchema)),
  messages: Schema.Array(
    Schema.Struct({
      ...noteMessageSnapshotSchema.fields,
      attachments: Schema.Array(
        Schema.Struct({
          partId: partIdSchema,
          sourceId: sourceIdSchema,
          sourceName: Schema.String,
          revision: Schema.BigInt.check(Schema.isGreaterThanBigInt(0n)),
          snapshotId: contentSnapshotIdSchema,
          projectId: Schema.NullOr(projectIdSchema)
        })
      )
    })
  )
}).check(
  Schema.makeFilter((snapshot) => {
    const conversion = snapshot.generation?.conversion;

    return (
      !conversion ||
      snapshot.messages.some(
        (message) =>
          message.messageId === snapshot.messageId &&
          message.versionId === conversion.baseVersionId &&
          message.role === 'user'
      )
    );
  })
);

export const publishReplyInputSchema = Schema.Struct({
  requestId: Schema.String,
  text: Schema.String,
  citations: Schema.Array(
    Schema.Struct({
      marker: Schema.Number,
      sourceId: Schema.NullOr(sourceIdSchema),
      input: selectionReferenceSchema,
      selectedRange: Schema.optional(selectionRangeSchema),
      documentId: contentSnapshotIdSchema,
      blockOrdinal: Schema.Number,
      quote: Schema.String
    })
  )
});

export const titleSnapshotSchema = Schema.Struct({
  requestId: Schema.String,
  noteId: noteIdSchema,
  contextRevision: Schema.BigInt,
  titleSource: titleSourceSchema,
  title: Schema.String,
  messages: Schema.Array(noteMessageSnapshotSchema)
});

export const titleRequestSchema = Schema.Struct({
  requestId: Schema.String,
  noteId: noteIdSchema
});

export const titleSnapshotInputSchema = Schema.Struct({
  requestId: Schema.String,
  eventId: Schema.optional(Schema.String)
});

export const publishTitleInputSchema = Schema.Struct({
  requestId: Schema.String,
  title: Schema.String
});

const noteSummarySchema = Schema.Struct({
  settledOverride: Schema.optional(Schema.NullOr(Schema.Boolean)),
  id: noteIdSchema,
  generatedPageCount: Schema.BigInt,
  running: Schema.Boolean,
  activity: Schema.Literals(['idle', 'generating', 'processing', 'answering'])
});

export const noteSummariesSchema = Schema.Struct({ items: Schema.Array(noteSummarySchema) });

export const transformSuggestionFieldSchema = Schema.Literals(['title', 'instruction']);

export const transformSuggestionLanguageSchema = Schema.Literals(['english', 'italian']);

export const NoteMode = { Notebook: 'notebook', Assistant: 'assistant' } as const;

export type NoteMode = (typeof NoteMode)[keyof typeof NoteMode];

export const noteModes = [NoteMode.Notebook, NoteMode.Assistant] as const;

export const noteModeSchema = Schema.Literals(noteModes);
