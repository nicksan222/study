import { Schema } from 'effect';

import { messageIdSchema, sessionIdSchema, sourceIdSchema, studyDocumentIdSchema } from '../ids.ts';

/** Archive state belongs to a session membership, never to another session's shared original. */
const sessionArchiveTargetSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('message'), id: messageIdSchema }),
  Schema.Struct({ kind: Schema.Literal('document'), id: studyDocumentIdSchema }),
  Schema.Struct({ kind: Schema.Literal('source'), id: sourceIdSchema })
]);

export const sessionArchiveInputSchema = Schema.Struct({ sessionId: sessionIdSchema });

export const setSessionItemArchivedSchema = Schema.Struct({
  ...sessionArchiveInputSchema.fields,
  target: sessionArchiveTargetSchema,
  archived: Schema.Boolean
});

export const archivedSessionItemSchema = Schema.Struct({
  target: sessionArchiveTargetSchema,
  name: Schema.String,
  archivedAt: Schema.BigInt
});

export type SessionArchiveTarget = typeof sessionArchiveTargetSchema.Type;

export type ArchivedSessionItem = typeof archivedSessionItemSchema.Type;
