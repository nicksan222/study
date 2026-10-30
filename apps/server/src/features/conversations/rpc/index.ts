import { ConversationsRpc } from '@study/contracts/conversations/rpc';
import type { StudyError } from '@study/contracts/errors';
import { Effect } from 'effect';

import { Conversations } from '#server/features/conversations/service/index';

const failure = (error: StudyError) => ({
  kind: error.kind,
  message: error.message,
  retryAfterMs: error.retryAfterMs
});

export const ConversationsRpcLive = ConversationsRpc.toLayer(
  Effect.gen(function* () {
    const conversations = yield* Conversations;

    return {
      'conversations.createUntitledSession': (input) =>
        conversations.createUntitledSession(input).pipe(Effect.mapError(failure)),
      'conversations.requestTitle': (input) =>
        conversations.requestTitle(input).pipe(Effect.mapError(failure)),
      'conversations.requestReply': (input) =>
        conversations.requestReply(input).pipe(Effect.mapError(failure)),
      'conversations.reanswer': (input) =>
        conversations.reanswer(input).pipe(Effect.mapError(failure)),
      'conversations.rewriteMessage': (input) =>
        conversations.rewriteMessage(input).pipe(Effect.mapError(failure)),
      'conversations.message': ({ id }) => conversations.message(id).pipe(Effect.mapError(failure)),
      'conversations.thread': (input) => conversations.thread(input).pipe(Effect.mapError(failure)),
      'conversations.postMessage': (input) =>
        conversations.postMessage(input).pipe(Effect.mapError(failure)),
      'conversations.editMessage': (input) =>
        conversations.editMessage(input).pipe(Effect.mapError(failure)),
      'conversations.deleteMessage': ({ id }) =>
        conversations.deleteMessage(id).pipe(Effect.mapError(failure)),
      'conversations.setActiveVersion': (input) =>
        conversations.setActiveVersion(input).pipe(Effect.mapError(failure)),
      'conversations.renameSession': (input) =>
        conversations.renameSession(input).pipe(Effect.mapError(failure)),
      'conversations.session': ({ id }) => conversations.session(id).pipe(Effect.mapError(failure)),
      'conversations.findSession': ({ id }) =>
        conversations.findSession(id).pipe(Effect.mapError(failure)),
      'conversations.sessions': (input) =>
        conversations.sessions(input).pipe(Effect.mapError(failure)),
      'conversations.createSession': (input) =>
        conversations.createSession(input).pipe(Effect.mapError(failure)),
      'conversations.deleteSession': ({ id }) =>
        conversations.deleteSession(id).pipe(Effect.mapError(failure))
    };
  })
);
