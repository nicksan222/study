import { ConversationsRpc } from '@study/contracts/conversations/rpc';
import { Effect } from 'effect';

import { Conversations } from '#server/features/conversations/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const ConversationsRpcLive = defineRpc(
  ConversationsRpc,
  Effect.gen(function* () {
    const conversations = yield* Conversations;

    return {
      'conversations.createUntitledSession': (input) => conversations.createUntitledSession(input),
      'conversations.requestTitle': (input) => conversations.requestTitle(input),
      'conversations.requestReply': (input) => conversations.requestReply(input),
      'conversations.reanswer': (input) => conversations.reanswer(input),
      'conversations.rewriteMessage': (input) => conversations.rewriteMessage(input),
      'conversations.message': ({ id }) => conversations.message(id),
      'conversations.thread': (input) => conversations.thread(input),
      'conversations.postMessage': (input) => conversations.postMessage(input),
      'conversations.editMessage': (input) => conversations.editMessage(input),
      'conversations.deleteMessage': ({ id }) => conversations.deleteMessage(id),
      'conversations.setActiveVersion': (input) => conversations.setActiveVersion(input),
      'conversations.renameSession': (input) => conversations.renameSession(input),
      'conversations.session': ({ id }) => conversations.session(id),
      'conversations.findSession': ({ id }) => conversations.findSession(id),
      'conversations.sessions': (input) => conversations.sessions(input),
      'conversations.createSession': (input) => conversations.createSession(input),
      'conversations.deleteSession': ({ id }) => conversations.deleteSession(id)
    };
  })
);
