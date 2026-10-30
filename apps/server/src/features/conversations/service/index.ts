import { randomUUID } from 'node:crypto';

import type {
  createSessionInputSchema,
  editMessageInputSchema,
  postMessageInputSchema,
  setActiveVersionInputSchema,
  threadInputSchema,
  renameSessionInputSchema,
  sessionPageInputSchema
} from '@study/contracts/conversations/rpc';
import type {
  publishReplyInputSchema,
  publishTitleInputSchema,
  replyRequestSchema,
  replyRequestInputSchema,
  reanswerInputSchema,
  rewriteMessageInputSchema
} from '@study/contracts/conversations/schemas';
import type { MessageId, ProjectId, SessionId, SourceId } from '@study/contracts/ids';
import { mentionLabel, text } from '@study/localization';
import { Effect } from 'effect';

import { SessionStore } from '#server/features/conversations/store/index';
import { MessageStore } from '#server/features/conversations/store/message';
import { RecordingPostStore } from '#server/features/conversations/store/recording';
import {
  ReplyStore,
  ReplyReadinessStore,
  ReplyWakeStore
} from '#server/features/conversations/store/reply';
import { TitleStore } from '#server/features/conversations/store/title';
import { Settings } from '#server/features/settings/index';
import { Database } from '#server/platform/database/database';
import { defineService } from '#server/platform/definitions/define-service';
import { transaction } from '#server/platform/definitions/define-store';
import { emitEvent } from '#server/platform/workflows/events';
import { PublicationGuard } from '#server/platform/workflows/publication';

export const Conversations = defineService(
  'study/Conversations',
  Effect.gen(function* () {
    const { store: context } = yield* Database;
    const store = SessionStore.make(context);
    const messages = MessageStore.make(context);
    const replies = ReplyStore.make(context);
    const titles = TitleStore.make(context);

    return {
      titleSnapshot: titles.titleSnapshot,
      createUntitledSession: (input: { project: ProjectId }) =>
        Effect.gen(function* () {
          const settings = yield* Settings;
          const language = yield* settings.language();

          return yield* transaction(context, (tx) =>
            tx.store(SessionStore).createSession({
              ...input,
              title: text(language, 'NewSession'),
              titleSource: 'provisional'
            })
          );
        }),
      requestTitle: (input: { sessionId: SessionId }) =>
        transaction(context, (tx) => {
          const requestId = randomUUID();
          const snapshot = tx.store(TitleStore).captureTitle({ ...input, requestId });

          emitEvent(
            context,
            {
              type: 'ConversationTitleRequested',
              eventId: randomUUID(),
              causationId: null,
              correlationId: requestId,
              inputVersion: 1,
              depth: 0,
              ...snapshot
            },
            context.clock.currentTimeMillisUnsafe()
          );

          return { requestId, sessionId: input.sessionId };
        }),
      publishTitle: (input: typeof publishTitleInputSchema.Type) =>
        Effect.gen(function* () {
          const guard = yield* PublicationGuard;

          return yield* transaction(context, (tx) => {
            guard.assert();

            return tx.store(TitleStore).publishTitle(input);
          });
        }),
      replySnapshot: replies.replySnapshot,
      replyReadiness: ReplyReadinessStore.make(context).replyReadiness,
      replyWakes: ReplyWakeStore.make(context).replyWakes,
      sealReplyAttachments: (input: { requestId: string }) =>
        Effect.gen(function* () {
          const guard = yield* PublicationGuard;

          return yield* transaction(context, (tx) => {
            guard.assert();

            return tx.store(ReplyStore).sealReplyAttachments(input);
          });
        }),
      abandonReply: (input: typeof replyRequestSchema.Type) =>
        Effect.gen(function* () {
          const guard = yield* PublicationGuard;

          return yield* transaction(context, (tx) => {
            guard.assert();

            return tx.store(ReplyStore).abandonReply(input);
          });
        }),
      publishReply: (input: typeof publishReplyInputSchema.Type) =>
        Effect.gen(function* () {
          const guard = yield* PublicationGuard;

          return yield* transaction(context, (tx) => {
            guard.assert();

            return tx.store(ReplyStore).publishReply(input);
          });
        }),
      requestReply: (input: typeof replyRequestInputSchema.Type) =>
        transaction(context, (tx) => {
          const requestId = randomUUID();
          const result = tx.store(ReplyStore).requestReply({ ...input, requestId });

          emitEvent(
            context,
            {
              type: 'ConversationGenerationRequested',
              eventId: randomUUID(),
              causationId: null,
              correlationId: requestId,
              inputVersion: 1,
              depth: 0,
              ...result,
              operation: 'reply'
            },
            context.clock.currentTimeMillisUnsafe()
          );

          return result;
        }),
      reanswer: (input: typeof reanswerInputSchema.Type) =>
        transaction(context, (tx) => {
          const requestId = randomUUID();
          const result = tx
            .store(ReplyStore)
            .requestTarget({ ...input, requestId, origin: 'answer' });

          emitEvent(
            context,
            {
              type: 'ConversationGenerationRequested',
              eventId: randomUUID(),
              causationId: null,
              correlationId: requestId,
              inputVersion: 1,
              depth: 0,
              ...result,
              operation: 'reply'
            },
            context.clock.currentTimeMillisUnsafe()
          );

          return result;
        }),
      rewriteMessage: (input: typeof rewriteMessageInputSchema.Type) =>
        transaction(context, (tx) => {
          const requestId = randomUUID();
          const result = tx.store(ReplyStore).requestTarget({ ...input, requestId });

          emitEvent(
            context,
            {
              type: 'ConversationGenerationRequested',
              eventId: randomUUID(),
              causationId: null,
              correlationId: requestId,
              inputVersion: 1,
              depth: 0,
              ...result,
              operation: 'rewrite'
            },
            context.clock.currentTimeMillisUnsafe()
          );

          return result;
        }),
      message: messages.message,
      thread: (input: typeof threadInputSchema.Type) =>
        Effect.gen(function* () {
          const items = yield* messages.messages(input);
          const first = items[0];
          const more =
            first && items.length === input.limit
              ? yield* messages.messages({
                  sessionId: input.sessionId,
                  threadRoot: input.threadRoot,
                  limit: 1,
                  before: first.id
                })
              : [];

          return { items, next: more.length && first ? first.id : null };
        }),
      postRecordingMessage: (input: {
        requestId: string;
        sessionId: SessionId;
        sourceId: SourceId;
        projectId: ProjectId;
        durationMs: number;
      }) =>
        Effect.gen(function* () {
          const guard = yield* PublicationGuard;

          return yield* transaction(context, (tx) => {
            guard.assert();
            const recording = tx.store(RecordingPostStore);
            const existing = recording.prepareRecordingPost(input);

            if (existing !== null) return existing;

            const message = tx.store(MessageStore).postMessage({
              sessionId: input.sessionId,
              text: '',
              sourceIds: [input.sourceId]
            });

            return recording.finishRecordingPost({ ...input, messageId: message.id });
          });
        }),
      postMessage: (input: typeof postMessageInputSchema.Type) =>
        transaction(context, (tx) => {
          const message = tx.store(MessageStore).postMessage(input);
          const mentioned = [...input.text.matchAll(/(?:^|\s)(@[a-z]+)/giu)].some(
            (match) => match[1]!.toLowerCase() === mentionLabel('assistant')
          );

          if (input.requestReply ?? mentioned) {
            const requestId = randomUUID();
            const result = tx.store(ReplyStore).requestReply({
              sessionId: input.sessionId,
              threadRoot: input.threadRoot,
              requestId
            });

            emitEvent(
              context,
              {
                type: 'ConversationGenerationRequested',
                eventId: randomUUID(),
                causationId: null,
                correlationId: requestId,
                inputVersion: 1,
                depth: 0,
                ...result,
                operation: 'reply'
              },
              context.clock.currentTimeMillisUnsafe()
            );
          }

          return message;
        }),
      editMessage: (input: typeof editMessageInputSchema.Type) =>
        transaction(context, (tx) => tx.store(MessageStore).editMessage(input)),
      setActiveVersion: (input: typeof setActiveVersionInputSchema.Type) =>
        transaction(context, (tx) => tx.store(MessageStore).setActiveVersion(input)),
      deleteMessage: (id: MessageId) =>
        transaction(context, (tx) => tx.store(MessageStore).deleteMessage(id)),
      renameSession: (input: typeof renameSessionInputSchema.Type) =>
        transaction(context, (tx) => tx.store(SessionStore).renameSession(input)),
      session: store.session,
      findSession: store.findSession,
      sessions: (input: typeof sessionPageInputSchema.Type) =>
        Effect.gen(function* () {
          const items = yield* store.sessions(input);
          const last = items.at(-1);
          const more =
            last && items.length === input.limit
              ? yield* store.sessions({
                  limit: 1,
                  before: { updatedAt: last.updatedAt, id: last.id }
                })
              : [];

          return {
            items,
            next: more.length && last ? { updatedAt: last.updatedAt, id: last.id } : null
          };
        }),
      createSession: (input: typeof createSessionInputSchema.Type) =>
        transaction(context, (tx) =>
          tx.store(SessionStore).createSession({ ...input, titleSource: 'user' })
        ),
      deleteSession: (id: SessionId) =>
        transaction(context, (tx) => tx.store(SessionStore).deleteSession(id))
    };
  })
);
