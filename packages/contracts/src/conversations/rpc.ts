import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';

import { failureSchema } from '../errors.ts';
import {
  messageIdSchema,
  partIdSchema,
  projectIdSchema,
  sessionIdSchema,
  sourceIdSchema,
  versionIdSchema
} from '../ids.ts';
import {
  chatMessageSchema,
  sessionSchema,
  replyRequestInputSchema,
  replyRequestSchema,
  reanswerInputSchema,
  rewriteMessageInputSchema,
  titleRequestSchema
} from './schemas.ts';

const sessionCursorSchema = Schema.Struct({ updatedAt: Schema.BigInt, id: sessionIdSchema });

export const sessionPageInputSchema = Schema.Struct({
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  before: Schema.optional(sessionCursorSchema)
});

const sessionPageSchema = Schema.Struct({
  items: Schema.Array(sessionSchema),
  next: Schema.NullOr(sessionCursorSchema)
});

const sessionIdInputSchema = Schema.Struct({ id: sessionIdSchema });

export const createSessionInputSchema = Schema.Struct({
  project: projectIdSchema,
  title: Schema.String
});

const createUntitledSessionInputSchema = Schema.Struct({ project: projectIdSchema });

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
  sessionId: sessionIdSchema,
  threadRoot: Schema.optional(partIdSchema),
  requestReply: Schema.optional(Schema.Boolean),
  text: Schema.String,
  sourceIds: Schema.optional(Schema.Array(sourceIdSchema))
});

export const editMessageInputSchema = Schema.Struct({
  messageId: messageIdSchema,
  text: Schema.String
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
  Rpc.make('deleteSession', {
    payload: sessionIdInputSchema,
    success: Schema.Boolean,
    error: failureSchema
  })
).prefix('conversations.');
