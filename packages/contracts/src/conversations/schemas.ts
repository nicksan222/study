import { Schema } from 'effect';

import {
  documentIdSchema,
  materialVersionIdSchema,
  messageIdSchema,
  partIdSchema,
  projectIdSchema,
  recordingIdSchema,
  sessionIdSchema,
  sourceIdSchema,
  versionIdSchema
} from '../ids.ts';
import { anchorSchema, blockIdSchema, documentTextRangeSchema } from '../sources/schemas.ts';
import { sourceKindSchema } from '../sources/sniff.ts';
import {
  runSelectionContextSchema,
  runPreferencesSchema,
  conversationMessageSnapshotSchema,
  messageRoleSchema
} from './context.ts';

export const titleSourceSchema = Schema.Literals(['generated', 'provisional', 'user']);

export { messageRoleSchema, conversationMessageSnapshotSchema };

export const versionStatusSchema = Schema.Literals(['complete', 'pending', 'writing']);

export const versionOriginSchema = Schema.Literals([
  'answer',
  'edited',
  'improve',
  'instruction',
  'summarize',
  'typed'
]);

export const sessionSchema = Schema.Struct({
  projectIds: Schema.Array(projectIdSchema),
  id: sessionIdSchema,
  title: Schema.String,
  titleSource: titleSourceSchema,
  createdAt: Schema.BigInt,
  updatedAt: Schema.BigInt
});

export { anchorSchema };

const citationSchema = Schema.Struct({
  marker: Schema.Number,
  sourceId: Schema.NullOr(sourceIdSchema),
  materialVersionId: Schema.optional(Schema.NullOr(materialVersionIdSchema)),
  documentId: Schema.optional(Schema.NullOr(documentIdSchema)),
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

export const chatMessageSchema = Schema.Struct({
  id: messageIdSchema,
  sessionId: sessionIdSchema,
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

export type SessionDto = typeof sessionSchema.Type;

export const replyRequestInputSchema = Schema.Struct({
  sessionId: sessionIdSchema,
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
  sessionId: sessionIdSchema,
  messageId: messageIdSchema,
  versionId: versionIdSchema
});

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
      reason: Schema.Literal('conversation-boundary')
    })
  ),
  generation: Schema.optional(
    Schema.Struct({
      origin: Schema.Literals(['answer', 'improve', 'summarize', 'instruction']),
      instruction: Schema.NullOr(Schema.String)
    })
  ),
  pendingAttachments: Schema.optional(Schema.Array(pendingReplyAttachmentSchema)),
  messages: Schema.Array(
    Schema.Struct({
      ...conversationMessageSnapshotSchema.fields,
      attachments: Schema.Array(
        Schema.Struct({
          partId: partIdSchema,
          sourceId: sourceIdSchema,
          sourceName: Schema.String,
          documentId: documentIdSchema,
          projectId: Schema.NullOr(projectIdSchema)
        })
      )
    })
  )
});

export const publishReplyInputSchema = Schema.Struct({
  requestId: Schema.String,
  text: Schema.String,
  citations: Schema.Array(
    Schema.Struct({
      marker: Schema.Number,
      sourceId: Schema.NullOr(sourceIdSchema),
      materialVersionId: Schema.optional(materialVersionIdSchema),
      selectedRange: Schema.optional(documentTextRangeSchema),
      documentId: documentIdSchema,
      blockOrdinal: Schema.Number,
      quote: Schema.String
    })
  )
});

export const titleSnapshotSchema = Schema.Struct({
  requestId: Schema.String,
  sessionId: sessionIdSchema,
  contextRevision: Schema.BigInt,
  titleSource: titleSourceSchema,
  title: Schema.String,
  messages: Schema.Array(conversationMessageSnapshotSchema)
});

export const titleRequestSchema = Schema.Struct({
  requestId: Schema.String,
  sessionId: sessionIdSchema
});

export const titleSnapshotInputSchema = Schema.Struct({
  requestId: Schema.String,
  eventId: Schema.optional(Schema.String)
});

export const publishTitleInputSchema = Schema.Struct({
  requestId: Schema.String,
  title: Schema.String
});
