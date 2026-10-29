import { Schema } from 'effect';

import { jobSchema } from '#server/shared/jobs/schemas';
import {
  anchorSchema,
  documentWithIdSchema as documentSchema
} from '#server/shared/sources/schemas';
import { sourceKinds } from '#server/shared/sources/sniff';

const idSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

export const titleSourceSchema = Schema.Literals(['generated', 'provisional', 'user']);

export const messageRoleSchema = Schema.Literals(['assistant', 'user']);

export const versionStatusSchema = Schema.Literals(['complete', 'pending', 'writing']);

export const versionOriginSchema = Schema.Literals([
  'answer',
  'edited',
  'improve',
  'instruction',
  'summarize',
  'typed'
]);

export const sourceKindSchema = Schema.Literals(sourceKinds);

export const sessionSchema = Schema.Struct({
  id: idSchema,
  projectId: idSchema,
  title: Schema.String,
  titleSource: titleSourceSchema,
  createdAt: Schema.BigInt,
  updatedAt: Schema.BigInt
});

export { anchorSchema };

export { documentSchema };

export const citationSchema = Schema.Struct({
  marker: Schema.Number,
  sourceId: Schema.NullOr(idSchema),
  sourceName: Schema.String,
  anchor: anchorSchema,
  quote: Schema.String
});

export const messageVersionSchema = Schema.Struct({
  id: idSchema,
  number: Schema.BigInt,
  origin: versionOriginSchema,
  status: versionStatusSchema,
  text: Schema.String,
  basedOn: Schema.NullOr(idSchema),
  instruction: Schema.NullOr(Schema.String),
  createdAt: Schema.BigInt
});

export const messagePartSchema = Schema.Struct({
  id: idSchema,
  sourceId: Schema.NullOr(idSchema),
  sourceName: Schema.String,
  sourceKind: sourceKindSchema
});

export const chatMessageSchema = Schema.Struct({
  id: idSchema,
  sessionId: idSchema,
  role: messageRoleSchema,
  threadRoot: Schema.NullOr(idSchema),
  replyTo: Schema.NullOr(idSchema),
  activeVersionId: Schema.NullOr(idSchema),
  recordingId: Schema.NullOr(idSchema),
  recordingMs: Schema.NullOr(Schema.BigInt),
  recordedIn: Schema.NullOr(idSchema),
  createdAt: Schema.BigInt,
  versions: Schema.Array(messageVersionSchema),
  parts: Schema.Array(messagePartSchema),
  citations: Schema.Array(citationSchema)
});

export const threadSummarySchema = Schema.Struct({
  replies: Schema.BigInt,
  lastReplyAt: Schema.NullOr(Schema.BigInt)
});

export const messagePartViewSchema = Schema.Struct({
  id: idSchema,
  sourceId: Schema.NullOr(idSchema),
  sourceName: Schema.String,
  sourceKind: sourceKindSchema,
  content: Schema.Struct({
    sourceId: Schema.NullOr(idSchema),
    name: Schema.String,
    kind: sourceKindSchema
  }),
  document: Schema.NullOr(documentSchema),
  jobs: Schema.Array(jobSchema),
  thread: threadSummarySchema
});

export const messageViewSchema = Schema.Struct({
  id: idSchema,
  sessionId: idSchema,
  role: messageRoleSchema,
  threadRoot: Schema.NullOr(idSchema),
  replyTo: Schema.NullOr(idSchema),
  activeVersionId: Schema.NullOr(idSchema),
  recordingId: Schema.NullOr(idSchema),
  recordingMs: Schema.NullOr(Schema.BigInt),
  recordedIn: Schema.NullOr(idSchema),
  createdAt: Schema.BigInt,
  versions: Schema.Array(messageVersionSchema),
  citations: Schema.Array(citationSchema),
  status: versionStatusSchema,
  parts: Schema.Array(messagePartViewSchema),
  activeVersion: Schema.NullOr(idSchema),
  reply: Schema.NullOr(jobSchema)
});

export type SessionDto = typeof sessionSchema.Type;

export type ChatMessageDto = typeof chatMessageSchema.Type;

export type MessageViewDto = typeof messageViewSchema.Type;
