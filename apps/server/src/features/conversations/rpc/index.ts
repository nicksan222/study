/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Maps typed conversation RPC requests to their corresponding conversation service   │
 * │ operations.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Delegates request handling to the conversation service without owning domain rules.    │
 * │ - Preserves the public contract while delegating domain behavior to the service.         │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ RPC schemas come from @study/contracts; domain decisions and persistence remain owned by │
 * │ the conversations service.                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { ConversationsRpc } from '@study/contracts/conversations/rpc';
import { Effect } from 'effect';

import { Conversations } from '#server/features/conversations/service/index';
import { suggestTransformField } from '#server/features/conversations/service/transform-suggestion';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const ConversationsRpcLive = defineRpc(
  ConversationsRpc,
  Effect.gen(function* () {
    const conversations = yield* Conversations;

    return {
      'conversations.suggestTransformField': suggestTransformField,
      'conversations.setMessageKind': (input) => conversations.setMessageKind(input),
      'conversations.answerQuestion': (input) => conversations.answerQuestion(input),
      'conversations.archivedItems': (input) => conversations.archivedItems(input),
      'conversations.setItemArchived': (input) => conversations.setItemArchived(input),
      'conversations.sessionSelection': (input) => conversations.sessionSelection(input),
      'conversations.updateSessionSelection': (input) =>
        conversations.updateSessionSelection(input),
      'conversations.captureSessionContext': (input) => conversations.captureSessionContext(input),
      'conversations.inspectSessionContext': (input) => conversations.inspectSessionContext(input),
      'conversations.sessionContext': (input) => conversations.sessionContext(input),
      'conversations.replySnapshot': (input) => conversations.inspectReplySnapshot(input),
      'conversations.createUntitledSession': (input) => conversations.createUntitledSession(input),
      'conversations.requestTitle': (input) => conversations.requestTitle(input),
      'conversations.ask': (input) => conversations.ask(input),
      'conversations.messageVersionCitations': (input) =>
        conversations.messageVersionCitations(input),
      'conversations.sessionGenerations': (input) => conversations.sessionGenerations(input),
      'conversations.replyVersion': (input) => conversations.replyVersion(input),
      'conversations.requestReply': (input) => conversations.requestReply(input),
      'conversations.reanswer': (input) => conversations.reanswer(input),
      'conversations.rewriteMessage': (input) => conversations.rewriteMessage(input),
      'conversations.message': ({ id }) => conversations.message(id),
      'conversations.thread': (input) => conversations.thread(input),
      'conversations.postMessage': (input) => conversations.postMessage(input),
      'conversations.updateMessageDescription': (input) =>
        conversations.updateMessageDescription(input),
      'conversations.editMessage': (input) => conversations.editMessage(input),
      'conversations.deleteMessageVersion': (input) => conversations.deleteMessageVersion(input),
      'conversations.deleteMessage': ({ id }) => conversations.deleteMessage(id),
      'conversations.setActiveVersion': (input) => conversations.setActiveVersion(input),
      'conversations.renameSession': (input) => conversations.renameSession(input),
      'conversations.session': ({ id }) => conversations.session(id),
      'conversations.findSession': ({ id }) => conversations.findSession(id),
      'conversations.setSessionSettled': (input) => conversations.setSessionSettled(input),
      'conversations.sessionWork': (input) => conversations.sessionWork(input),
      'conversations.sessionSummaries': (input) => conversations.sessionSummaries(input),
      'conversations.sessions': (input) => conversations.sessions(input),
      'conversations.createSession': (input) => conversations.createSession(input),
      'conversations.sessionDeletion': ({ id }) => conversations.sessionDeletion(id),
      'conversations.retrySessionDeletion': ({ id }) => conversations.retrySessionDeletion(id),
      'conversations.deleteSession': ({ id }) => conversations.deleteSession(id)
    };
  })
);
