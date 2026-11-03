import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

import { failureSchema } from '../errors.ts';
import {
  materialVersionIdSchema,
  messageIdSchema,
  partIdSchema,
  projectIdSchema,
  sessionIdSchema,
  sourceIdSchema,
  versionIdSchema
} from '../ids.ts';
import {
  sessionSelectionInputSchema,
  sessionSelectionSchema,
  updateSessionSelectionSchema,
  captureSessionContextSchema,
  runSelectionContextSchema
} from './context.ts';
import { sessionDeletionSchema } from './deletion.ts';
import { sessionSummariesSchema } from './schemas.ts';
import { captureKeySchema } from './schemas.ts';
import {
  messageDescriptionSchema,
  messageFormatSchema,
  replySnapshotInputSchema,
  replySnapshotSchema,
  chatMessageSchema,
  sessionSchema,
  replyRequestInputSchema,
  replyRequestSchema,
  reanswerInputSchema,
  rewriteMessageInputSchema,
  askInputSchema,
  askResultSchema,
  replyVersionInputSchema,
  replyVersionSchema,
  titleRequestSchema
} from './schemas.ts';

export const sessionGenerationPageInputSchema = Schema.Struct({
  sessionId: sessionIdSchema,
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  before: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)))
});

export const sessionGenerationSchema = Schema.Struct({
  requestId: Schema.String,
  contextRequestId: Schema.NullOr(Schema.String),
  state: Schema.Literals(['available', 'retired', 'unavailable']),
  cancelled: Schema.Boolean,
  resultVersionId: Schema.NullOr(materialVersionIdSchema),
  proposedVersionId: Schema.NullOr(materialVersionIdSchema),
  baseVersionId: Schema.NullOr(materialVersionIdSchema)
});

const sessionGenerationPageSchema = Schema.Struct({
  items: Schema.Array(sessionGenerationSchema),
  next: Schema.NullOr(Schema.String)
});

export const messageVersionCitationsSchema = Schema.Struct({
  sessionId: sessionIdSchema,
  messageId: messageIdSchema,
  versionId: versionIdSchema,
  citations: chatMessageSchema.fields.citations
});

const sessionCursorSchema = Schema.Struct({ updatedAt: Schema.BigInt, id: sessionIdSchema });

export const setSessionSettledInputSchema = Schema.Struct({
  id: sessionIdSchema,
  settled: Schema.Boolean
});

export const sessionPageInputSchema = Schema.Struct({
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  project: Schema.optional(Schema.NullOr(projectIdSchema)),
  before: Schema.optional(sessionCursorSchema)
});

const sessionPageSchema = Schema.Struct({
  items: Schema.Array(sessionSchema),
  next: Schema.NullOr(sessionCursorSchema)
});

const sessionIdInputSchema = Schema.Struct({ id: sessionIdSchema });

export const createSessionInputSchema = Schema.Struct({
  project: Schema.optional(projectIdSchema),
  title: Schema.String
});

const createUntitledSessionInputSchema = Schema.Struct({
  project: Schema.optional(projectIdSchema)
});

const messageIdInputSchema = Schema.Struct({ id: messageIdSchema });

export const threadInputSchema = Schema.Struct({
  sessionId: sessionIdSchema,
  threadRoot: Schema.optional(partIdSchema),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  before: Schema.optional(messageIdSchema)
});

const threadPageSchema = Schema.Struct({
  items: Schema.Array(chatMessageSchema),
  next: Schema.NullOr(messageIdSchema)
});

export const postMessageInputSchema = Schema.Struct({
  format: Schema.optional(messageFormatSchema),
  captureKey: Schema.optional(captureKeySchema),
  sessionId: sessionIdSchema,
  threadRoot: Schema.optional(partIdSchema),
  requestReply: Schema.optional(Schema.Boolean),
  text: Schema.String,
  sourceIds: Schema.optional(Schema.Array(sourceIdSchema))
});

export const editMessageInputSchema = Schema.Struct({
  expectedActiveVersionId: Schema.optional(versionIdSchema),
  messageId: messageIdSchema,
  text: Schema.String
});

export const updateMessageDescriptionInputSchema = Schema.Struct({
  messageId: messageIdSchema,
  description: Schema.NullOr(messageDescriptionSchema),
  expectedDescription: Schema.NullOr(messageDescriptionSchema)
});

export const setActiveVersionInputSchema = Schema.Struct({
  messageId: messageIdSchema,
  versionId: versionIdSchema
});

export const renameSessionInputSchema = Schema.Struct({
  id: sessionIdSchema,
  title: Schema.String
});

export const ConversationsRpc = RpcGroup.make(
  Rpc.make('setSessionSettled', {
    payload: setSessionSettledInputSchema,
    success: Schema.Struct({}),
    error: failureSchema
  }),
  Rpc.make('sessionSummaries', {
    payload: {},
    success: sessionSummariesSchema,
    error: failureSchema
  }),
  Rpc.make('ask', { payload: askInputSchema, success: askResultSchema, error: failureSchema }),
  Rpc.make('replyVersion', {
    payload: replyVersionInputSchema,
    success: replyVersionSchema,
    error: failureSchema
  }),
  Rpc.make('sessionSelection', {
    payload: sessionSelectionInputSchema,
    success: sessionSelectionSchema,
    error: failureSchema
  }),
  Rpc.make('updateSessionSelection', {
    payload: updateSessionSelectionSchema,
    success: sessionSelectionSchema,
    error: failureSchema
  }),
  Rpc.make('captureSessionContext', {
    payload: captureSessionContextSchema,
    success: runSelectionContextSchema,
    error: failureSchema
  }),
  Rpc.make('inspectSessionContext', {
    payload: replySnapshotInputSchema,
    success: runSelectionContextSchema,
    error: failureSchema
  }),
  Rpc.make('sessionContext', {
    payload: replySnapshotInputSchema,
    success: runSelectionContextSchema,
    error: failureSchema
  }),
  Rpc.make('replySnapshot', {
    payload: replySnapshotInputSchema,
    success: replySnapshotSchema,
    error: failureSchema
  }),
  Rpc.make('createUntitledSession', {
    payload: createUntitledSessionInputSchema,
    success: sessionSchema,
    error: failureSchema
  }),
  Rpc.make('requestTitle', {
    payload: replyRequestInputSchema,
    success: titleRequestSchema,
    error: failureSchema
  }),
  Rpc.make('requestReply', {
    payload: replyRequestInputSchema,
    success: replyRequestSchema,
    error: failureSchema
  }),
  Rpc.make('reanswer', {
    payload: reanswerInputSchema,
    success: replyRequestSchema,
    error: failureSchema
  }),
  Rpc.make('rewriteMessage', {
    payload: rewriteMessageInputSchema,
    success: replyRequestSchema,
    error: failureSchema
  }),
  Rpc.make('message', {
    payload: messageIdInputSchema,
    success: chatMessageSchema,
    error: failureSchema
  }),
  Rpc.make('thread', {
    payload: threadInputSchema,
    success: threadPageSchema,
    error: failureSchema
  }),
  Rpc.make('postMessage', {
    payload: postMessageInputSchema,
    success: chatMessageSchema,
    error: failureSchema
  }),
  Rpc.make('updateMessageDescription', {
    payload: updateMessageDescriptionInputSchema,
    success: chatMessageSchema,
    error: failureSchema
  }),
  Rpc.make('editMessage', {
    payload: editMessageInputSchema,
    success: chatMessageSchema,
    error: failureSchema
  }),
  Rpc.make('deleteMessage', {
    payload: messageIdInputSchema,
    success: Schema.Boolean,
    error: failureSchema
  }),
  Rpc.make('setActiveVersion', {
    payload: setActiveVersionInputSchema,
    success: chatMessageSchema,
    error: failureSchema
  }),
  Rpc.make('renameSession', {
    payload: renameSessionInputSchema,
    success: sessionSchema,
    error: failureSchema
  }),
  Rpc.make('session', {
    payload: sessionIdInputSchema,
    success: sessionSchema,
    error: failureSchema
  }),
  Rpc.make('findSession', {
    payload: sessionIdInputSchema,
    success: Schema.Option(sessionSchema),
    error: failureSchema
  }),
  Rpc.make('sessionGenerations', {
    payload: sessionGenerationPageInputSchema,
    success: sessionGenerationPageSchema,
    error: failureSchema
  }),
  Rpc.make('messageVersionCitations', {
    payload: replyVersionInputSchema,
    success: messageVersionCitationsSchema,
    error: failureSchema
  }),
  Rpc.make('sessions', {
    payload: sessionPageInputSchema,
    success: sessionPageSchema,
    error: failureSchema
  }),
  Rpc.make('createSession', {
    payload: createSessionInputSchema,
    success: sessionSchema,
    error: failureSchema
  }),
  Rpc.make('sessionDeletion', {
    payload: sessionIdInputSchema,
    success: sessionDeletionSchema,
    error: failureSchema
  }),
  Rpc.make('retrySessionDeletion', {
    payload: sessionIdInputSchema,
    success: sessionDeletionSchema,
    error: failureSchema
  }),
  Rpc.make('deleteSession', {
    payload: sessionIdInputSchema,
    success: sessionDeletionSchema,
    error: failureSchema
  })
).prefix('conversations.');
