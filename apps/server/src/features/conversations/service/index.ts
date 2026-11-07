/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates conversation operations across persistence, evidence lookup, and       │
 * │ durable workflow requests.                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Owns session, message, reply, title, and recording behavior across domain services.    │
 * │ - Coordinates typed failures and persistence effects for feature callers.                │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ This is the conversations feature boundary for RPC and workflow callers;                 │
 * │ store implementations stay private to the service.                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import type {
  sessionArchiveInputSchema,
  setSessionItemArchivedSchema
} from '@study/contracts/conversations/archive';
import {
  resolvedSelectionSchema,
  selectionReferenceKey
} from '@study/contracts/conversations/context';
import type {
  runSelectionContextSchema,
  sessionContextIntentSchema,
  captureSessionContextSchema,
  updateSessionSelectionSchema
} from '@study/contracts/conversations/context';
import { canConvertMessage } from '@study/contracts/conversations/conversion';
import type { convertMessageInputSchema } from '@study/contracts/conversations/conversion';
import type { sessionDeletionSchema } from '@study/contracts/conversations/deletion';
import type { ChatMessage } from '@study/contracts/conversations/messages';
import type { transformSuggestionInputSchema } from '@study/contracts/conversations/rpc';
import type {
  assistantAskInputSchema,
  createSessionInputSchema,
  createUntitledSessionInputSchema,
  updateMessageDescriptionInputSchema,
  editMessageInputSchema,
  postMessageInputSchema,
  setActiveVersionInputSchema,
  threadInputSchema,
  renameSessionInputSchema,
  sessionPageInputSchema,
  setSessionSettledInputSchema,
  sessionGenerationPageInputSchema
} from '@study/contracts/conversations/rpc';
import type {
  questionVersionInputSchema,
  setMessageKindInputSchema,
  questionClassificationSchema,
  askInputSchema,
  replyVersionInputSchema,
  publishReplyInputSchema,
  publishTitleInputSchema,
  replyRequestSchema,
  replyRequestInputSchema,
  reanswerInputSchema,
  rewriteMessageInputSchema
} from '@study/contracts/conversations/schemas';
import { ConversationMode } from '@study/contracts/conversations/schemas';
import type { sessionWorkInputSchema } from '@study/contracts/conversations/work';
import type * as editing from '@study/contracts/documents/editing';
import type {
  transformRequestSchema,
  transformPublicationSchema
} from '@study/contracts/documents/transform';
import type { ErrorKind } from '@study/contracts/errors';
import { StudyError } from '@study/contracts/errors';
import type { MessageId, ProjectId, SessionId, SourceId } from '@study/contracts/ids';
import type { ContentInput } from '@study/contracts/inputs';
import type { SearchProjectionPageInput } from '@study/contracts/search/schemas';
import { mentionLabel, text } from '@study/localization';
import { Effect, Option, Schema } from 'effect';

import { SessionArchiveStore } from '#server/features/conversations/store/archive';
import { SessionModeStore } from '#server/features/conversations/store/assistant';
import { ConversationBackupStore } from '#server/features/conversations/store/backup';
import {
  SessionContextStore,
  SessionContextValidityStore,
  SessionSelectionStore,
  RetainedSessionContextStore,
  SessionContextIntentStore
} from '#server/features/conversations/store/context';
import {
  SessionDeletionStore,
  SessionDeletionOwnershipStore,
  SessionDeletionCorrelationStore
} from '#server/features/conversations/store/deletion';
import { SessionStore } from '#server/features/conversations/store/index';
import {
  MessageStore,
  MessageVersionCitationsStore
} from '#server/features/conversations/store/message';
import { QuestionStore, QuestionAnswerStore } from '#server/features/conversations/store/questions';
import { RecordingPostStore } from '#server/features/conversations/store/recording';
import {
  ReplyStore,
  ReplyRequestStore,
  ReplyVersionStore,
  RetainedReplySnapshotStore,
  ReplyReadinessStore,
  ReplyWakeStore
} from '#server/features/conversations/store/reply';
import { ConversationSearchStore } from '#server/features/conversations/store/search';
import { SessionSummaryStore } from '#server/features/conversations/store/sidebar-summary';
import { TitleStore } from '#server/features/conversations/store/title';
import { SessionWorkStore } from '#server/features/conversations/store/work';
import { Documents } from '#server/features/documents/index';
import { Settings } from '#server/features/settings/index';
import { Sources } from '#server/features/sources/index';
import { Workflows } from '#server/features/workflows/index';
import { defineService } from '#server/platform/definitions/define-service';
import type { Transaction } from '#server/platform/definitions/define-store';
import {
  transaction,
  useStore,
  publicationTransaction
} from '#server/platform/definitions/define-store';
import { impactToken } from '#server/platform/definitions/impact-token';

import { activeSessionTargets } from './active-inputs.ts';
import { allArchivedItems } from './archive.ts';
import { resolveMessageCitations, resolveVersionCitations } from './citations.ts';
import { resolveSelection } from './selection.ts';

function requireAvailableSession(tx: Transaction, sessionId: SessionId) {
  tx.store(SessionStore).session(sessionId);

  if (Option.isSome(tx.store(SessionDeletionStore).findSessionDeletion(sessionId)))
    throw new StudyError('not_found', 'Session is unavailable');
}

/** Recognizes whole assistant mention tokens without matching identifier suffixes. */
function mentionsAssistant(text: string) {
  return [...text.matchAll(/(?:^|\s)(@[\p{L}\p{M}\p{N}_]+)/gu)].some(
    (match) => match[1]!.toLowerCase() === mentionLabel('assistant')
  );
}

function readWorkspacePreferences() {
  return Effect.flatMap(Settings, (settings) => settings.workspacePreferences()).pipe(
    Effect.provide(Settings.layer)
  );
}

/** Captures at most one automatic title request per provisional session revision. */
function scheduleAutomaticTitle(tx: Transaction, sessionId: SessionId) {
  const requestId = randomUUID();
  const snapshot = tx.store(TitleStore).captureAutomaticTitle({ sessionId, requestId });

  if (Option.isSome(snapshot))
    tx.emit({
      type: 'ConversationTitleRequested',
      eventId: randomUUID(),
      causationId: null,
      correlationId: requestId,
      inputVersion: 1,
      depth: 0,
      ...snapshot.value
    });
}

function normalizeAsk(input: typeof askInputSchema.Type) {
  return {
    sessionId: input.sessionId,
    threadRoot: input.threadRoot ?? null,
    intentKey: input.intentKey,
    expectedSelectionRevision: input.expectedSelectionRevision,
    text: input.text.trim(),
    sourceIds: input.sourceIds ?? [],
    instruction: input.instruction ?? '',
    preferences: {
      language: input.preferences?.language,
      detail: input.preferences?.detail
    }
  };
}

import { makeAssistantConversations } from './assistant.ts';
import { ensureSession, notebookSession } from './ensure-session.ts';

export const Conversations = defineService(
  'study/Conversations',
  Effect.gen(function* () {
    const readReplyReadinessStore = yield* useStore(ReplyReadinessStore);

    const readReplyWakeStore = yield* useStore(ReplyWakeStore);

    const store = yield* useStore(SessionStore);
    const modes = yield* useStore(SessionModeStore);
    const summaries = yield* useStore(SessionSummaryStore);

    const titles = yield* useStore(TitleStore);

    const selections = yield* useStore(SessionSelectionStore);

    const retainedContexts = yield* useStore(RetainedSessionContextStore);

    const assistant = yield* makeAssistantConversations;
    const { assistantSession } = assistant;

    const ask = (input: typeof askInputSchema.Type) =>
      Effect.gen(function* () {
        const preferences = yield* readWorkspacePreferences();

        return yield* transaction((tx) => {
          const normalized = normalizeAsk(input);
          const askDigest = impactToken(normalized);
          const intent = {
            sessionId: input.sessionId,
            threadRoot: input.threadRoot,
            intentKey: input.intentKey,
            instruction: normalized.instruction,
            preferences: normalized.preferences,
            askDigest
          };
          const existing = tx.store(SessionContextIntentStore).findSessionContextIntent(intent);

          if (Option.isSome(existing)) {
            const context = existing.value;
            const previous = tx
              .store(ReplyRequestStore)
              .findReplyRequest({ requestId: context.requestId });
            const note = askUserTarget(context);

            if (Option.isNone(previous) || !note || note.role !== 'user')
              throw new StudyError('not_found', 'Captured Ask is unavailable');

            for (const target of context.inputs) assertCapturedTarget(tx, target);

            return {
              ...previous.value,
              userMessageId: note.messageId,
              userVersionId: note.versionId
            };
          }

          const selection = tx
            .store(SessionSelectionStore)
            .sessionSelection({ sessionId: input.sessionId });

          if (selection.revision !== input.expectedSelectionRevision)
            throw new StudyError('invalid_input', 'Session selection changed');

          if (
            tx.store(SessionModeStore).sessionMode(input.sessionId) === ConversationMode.Assistant
          )
            retireAssistantReplies(tx, input.sessionId);

          tx.store(ReplyStore).prepareReply(input);
          const note = postMessage(tx, input);
          const context = captureContext(
            tx,
            { ...intent, throughMessageId: note.id },
            randomUUID(),
            true
          );
          const result = tx
            .store(ReplyStore)
            .requestReply({ ...input, requestId: context.requestId, context });

          emitReplyRequest(tx, result, 'reply');

          retainExplicitQuestionAnswer(tx, note, result);

          if (preferences.textConversionMode === 'automatic')
            scheduleAutomaticConversion(tx, note, preferences.textConversionStrategy);

          return { ...result, userMessageId: note.id, userVersionId: note.activeVersionId! };
        });
      });

    return {
      sessionMode: modes.sessionMode,
      ...assistant,
      /** A manual question mark commits its answer request with the classification. */
      setMessageKind: (input: typeof setMessageKindInputSchema.Type) =>
        transaction((tx) => {
          tx.store(QuestionStore).setQuestionKind(input);

          if (input.kind === 'question') answerQuestion(tx, input);

          return tx.store(MessageStore).message(input.messageId);
        }),
      answerQuestion: (input: typeof questionVersionInputSchema.Type) =>
        transaction((tx) => answerQuestion(tx, input)),
      questionSnapshot: (input: typeof questionVersionInputSchema.Type) =>
        transaction((tx) => tx.store(QuestionStore).questionSnapshot(input)),
      /** Commits detection independently so rejected automatic answers cannot erase the saved kind. */
      publishQuestion: (
        input: typeof questionVersionInputSchema.Type & typeof questionClassificationSchema.Type
      ) =>
        Effect.gen(function* () {
          yield* publicationTransaction((tx) => {
            tx.store(QuestionStore).publishQuestion(input);
          });

          if (input.kind !== 'question') return;

          const preferences = yield* readWorkspacePreferences();

          if (preferences.autoAnswerQuestions)
            yield* publicationTransaction((tx) => {
              answerQuestion(tx, input);
            });
        }),
      applyDocumentProposal: (value: typeof editing.applyProposalSchema.Type) =>
        transaction((tx) => {
          const replay = Documents.findProposalReceiptInTransaction(tx, {
            ...value,
            operation: 'apply'
          });

          if (replay) return replay;

          const request = Documents.findTransformInTransaction(tx, value);
          let relevantValid = true;

          if (request) {
            if (request.cancelled)
              throw new StudyError('cancelled', 'Proposal generation is unavailable');

            const context = readCapturedContext(tx, request.contextRequestId);

            relevantValid =
              context.inputs.every((item) => inputIsCurrent(tx, item.input)) &&
              tx
                .store(SessionContextValidityStore)
                .sessionContextValidity({ requestId: request.contextRequestId });
          }

          return Documents.applyProposalInTransaction(tx, value, relevantValid);
        }),
      keepDocumentProposal: (value: typeof editing.keepProposalSchema.Type) =>
        transaction((tx) => {
          const replay = Documents.findProposalReceiptInTransaction(tx, {
            ...value,
            operation: 'keep'
          });

          if (replay) return replay;

          const request = Documents.findTransformInTransaction(tx, value);

          if (request) {
            if (request.cancelled)
              throw new StudyError('cancelled', 'Proposal generation is unavailable');

            readCapturedContext(tx, request.contextRequestId);
          }

          return Documents.keepProposalInTransaction(tx, value);
        }),
      requestDocumentTransform: (value: typeof transformRequestSchema.Type) =>
        transaction((tx) =>
          Documents.requestTransformInTransaction(
            tx,
            readCapturedContext(tx, value.contextRequestId),
            value
          )
        ),
      documentTransformContext: (value: { requestId: string }) =>
        transaction((tx) => {
          const request = Documents.transformInTransaction(tx, value);
          const context = readCapturedContext(tx, request.contextRequestId);

          if (request.cancelled || context.instruction !== request.instruction)
            throw new StudyError('cancelled', 'Document generation is unavailable');

          return context;
        }),
      publishDocumentTransform: (value: typeof transformPublicationSchema.Type) =>
        publicationTransaction((tx) => {
          const request = Documents.transformInTransaction(tx, value);
          const context =
            request.resultVersionId === null
              ? readCapturedContext(tx, request.contextRequestId)
              : undefined;

          return Documents.publishTransformInTransaction(tx, context, value);
        }),
      retryDocumentTransform: (value: { requestId: string; retryId: string }) =>
        transaction((tx) => {
          const request = Documents.transformInTransaction(tx, value);

          if (request.resultVersionId === null) readCapturedContext(tx, request.contextRequestId);

          return Documents.retryTransformInTransaction(tx, value);
        }),
      archivedItems: (input: typeof sessionArchiveInputSchema.Type) =>
        transaction((tx) => allArchivedItems(tx, input.sessionId)),
      setItemArchived: (input: typeof setSessionItemArchivedSchema.Type) =>
        transaction((tx) => {
          const archivedAt = tx.store(SessionArchiveStore).setItemArchived(input);

          if (input.target.kind === 'document')
            Documents.archiveSessionInTransaction(tx, {
              sessionId: input.sessionId,
              documentId: input.target.id,
              archivedAt
            });
          else if (input.target.kind === 'source')
            Sources.archiveSessionInTransaction(tx, {
              sessionId: input.sessionId,
              sourceId: input.target.id,
              archivedAt
            });
        }),
      sessionSelection: selections.sessionSelection,
      updateSessionSelection: (input: typeof updateSessionSelectionSchema.Type) =>
        transaction((tx) => {
          resolveTargets(tx, input.targets);

          return tx.store(SessionSelectionStore).updateSelection(input);
        }),
      requestTransformSuggestion: (input: typeof transformSuggestionInputSchema.Type) =>
        transaction((tx) => {
          const capture = {
            sessionId: input.sessionId,
            additionalSessionIds: input.additionalSessionIds?.length
              ? input.additionalSessionIds
              : undefined,
            intentKey: `suggest/${input.field}/${input.intentKey}`,
            instruction: '',
            preferences: { language: input.language }
          };
          const existing = tx.store(SessionContextIntentStore).findSessionContextIntent(capture);
          const context = captureContext(tx, capture, randomUUID());
          const event = {
            type: 'TransformSuggestionRequested' as const,
            eventId: `suggest/${context.requestId}`,
            causationId: null,
            correlationId: context.requestId,
            inputVersion: 1,
            depth: 0,
            sessionId: input.sessionId,
            contextRequestId: context.requestId,
            field: input.field,
            language: input.language
          };

          if (Option.isNone(existing)) tx.emit(event);

          return event;
        }),
      captureSessionContext: (input: typeof captureSessionContextSchema.Type) =>
        transaction((tx) => captureContext(tx, input, randomUUID())),
      inspectSessionContext: retainedContexts.retainedSessionContext,
      sessionContext: (input: { requestId: string }) =>
        transaction((tx) => {
          const snapshot = tx.store(SessionContextStore).sessionContext(input);

          for (const target of snapshot.inputs) assertCapturedTarget(tx, target);

          return snapshot;
        }),
      titleSnapshot: titles.titleSnapshot,
      createUntitledSession: (input: typeof createUntitledSessionInputSchema.Type) =>
        Effect.gen(function* () {
          const settings = yield* Settings;
          const language = yield* settings.language();
          const preferences = yield* readWorkspacePreferences();

          return yield* transaction((tx) => {
            const session = tx.store(SessionStore).createSession({
              project: input.project,
              title: text(language, 'NewSession'),
              titleSource: 'provisional'
            });

            if (input.initialMessage) {
              const message = postMessage(tx, {
                ...input.initialMessage,
                sessionId: session.id,
                requestReply: false
              });

              if (preferences.textConversionMode === 'automatic')
                scheduleAutomaticConversion(tx, message, preferences.textConversionStrategy);

              if (preferences.autoTitleSessions) scheduleAutomaticTitle(tx, session.id);
            }

            return session;
          });
        }),
      requestTitle: (input: { sessionId: SessionId }) =>
        transaction((tx) => {
          const requestId = randomUUID();

          const snapshot = tx.store(TitleStore).captureTitle({ ...input, requestId });

          tx.emit({
            type: 'ConversationTitleRequested',
            eventId: randomUUID(),
            causationId: null,
            correlationId: requestId,
            inputVersion: 1,
            depth: 0,
            ...snapshot
          });

          return { requestId, sessionId: input.sessionId };
        }),
      publishTitle: (input: typeof publishTitleInputSchema.Type) =>
        publicationTransaction((tx) => {
          return tx.store(TitleStore).publishTitle(input);
        }),
      replySnapshot: (input: { requestId: string }) =>
        transaction((tx) => {
          tx.store(QuestionStore).assertQuestionAnswer(input);
          const snapshot = tx.store(ReplyStore).replySnapshot(input);

          if (snapshot.context) {
            tx.store(SessionContextStore).sessionContext(input);

            for (const target of snapshot.context.inputs) assertCapturedTarget(tx, target);
          }

          return snapshot;
        }),
      inspectReplySnapshot: (input: { requestId: string }) =>
        transaction((tx) => tx.store(RetainedReplySnapshotStore).retainedReplySnapshot(input)),
      replyReadiness: readReplyReadinessStore.replyReadiness,
      replyWakes: readReplyWakeStore.replyWakes,
      sealReplyAttachments: (input: { requestId: string }) =>
        publicationTransaction((tx) => {
          return tx.store(ReplyStore).sealReplyAttachments(input);
        }),
      failConversion: (input: typeof replyRequestSchema.Type) =>
        publicationTransaction((tx) => tx.store(ReplyStore).failConversion(input)),
      abandonReply: (input: typeof replyRequestSchema.Type) =>
        publicationTransaction((tx) => {
          return tx.store(ReplyStore).abandonReply(input);
        }),
      publishReply: (input: typeof publishReplyInputSchema.Type) =>
        Effect.gen(function* () {
          const preferences = yield* readWorkspacePreferences();
          const language = yield* Effect.flatMap(Settings, (settings) => settings.language()).pipe(
            Effect.provide(Settings.layer)
          );

          return yield* publicationTransaction((tx) => {
            const context = tx
              .store(SessionContextStore)
              .findSessionContext({ requestId: input.requestId });

            if (Option.isSome(context))
              for (const target of context.value.inputs) assertCapturedTarget(tx, target);

            tx.store(QuestionStore).assertQuestionAnswer(input);
            const versionId = tx.store(ReplyStore).publishReply({ ...input, language });

            if (preferences.autoTitleSessions) {
              const reply = tx
                .store(ReplyRequestStore)
                .findReplyRequest({ requestId: input.requestId });

              if (Option.isSome(reply)) scheduleAutomaticTitle(tx, reply.value.sessionId);
            }

            return versionId;
          });
        }),
      messageVersionCitations: (input: typeof replyVersionInputSchema.Type) =>
        transaction((tx) => {
          if (Option.isSome(tx.store(SessionDeletionStore).findSessionDeletion(input.sessionId)))
            throw new StudyError('not_found', 'Session is unavailable');

          const value = tx.store(MessageVersionCitationsStore).messageVersionCitations(input);

          return { ...value, citations: resolveVersionCitations(tx, value.citations) };
        }),
      sessionGenerations: (input: typeof sessionGenerationPageInputSchema.Type) =>
        transaction((tx) => {
          requireAvailableSession(tx, input.sessionId);

          const items = Documents.transformsInTransaction(tx, input)
            .map((request) => ({
              requestId: request.id,
              contextRequestId: request.contextRequestId,
              state: 'available' as 'available' | 'unavailable' | 'retired',
              cancelled: request.cancelled,
              resultVersionId:
                request.editTargetVersionId === undefined ? request.resultVersionId : null,
              proposedVersionId:
                request.editTargetVersionId === undefined ? null : request.resultVersionId,
              baseVersionId: request.editTargetVersionId ?? null
            }))
            .map((item) => {
              if (item.state !== 'available' || item.contextRequestId === null) return item;

              try {
                readCapturedContext(tx, item.contextRequestId);

                return item;
              } catch (error) {
                if (
                  error instanceof StudyError &&
                  (error.kind === 'not_found' || error.kind === 'invalid_input')
                )
                  return { ...item, state: 'unavailable' as const };

                throw error;
              }
            });
          const last = items.at(-1);
          const more =
            last && items.length === input.limit
              ? Documents.transformsInTransaction(tx, {
                  ...input,
                  limit: 1,
                  before: last.requestId
                })
              : [];

          return { items, next: more.length && last ? last.requestId : null };
        }),
      replyVersion: (input: typeof replyVersionInputSchema.Type) =>
        transaction((tx) => {
          const provenance = tx.store(ReplyVersionStore).replyVersion(input);

          if (provenance.state !== 'available') return provenance;

          try {
            readCapturedContext(tx, provenance.requestId);

            return provenance;
          } catch (error) {
            if (
              error instanceof StudyError &&
              (error.kind === 'not_found' || error.kind === 'invalid_input')
            )
              return { state: 'unavailable' as const, requestId: provenance.requestId };

            throw error;
          }
        }),
      ask,
      ensureSession,
      notebookSession,
      assistantAsk: (input: typeof assistantAskInputSchema.Type) =>
        Effect.gen(function* () {
          const session = yield* assistantSession({ id: input.sessionId });

          const result = yield* ask({
            ...input,
            sessionId: session.id,
            expectedSelectionRevision: 0n
          });

          if (session.title === text('english', 'Assistant'))
            yield* transaction((tx) =>
              tx.store(SessionStore).renameSession({
                id: session.id,
                title: [...input.text.trim()].slice(0, 80).join('')
              })
            );

          return result;
        }),
      requestReply: (input: typeof replyRequestInputSchema.Type) =>
        transaction((tx) => {
          const intent = {
            sessionId: input.sessionId,
            threadRoot: input.threadRoot,
            intentKey: input.intentKey ?? randomUUID(),
            instruction: input.instruction ?? '',
            preferences: input.preferences ?? {}
          };

          const existing = tx.store(SessionContextIntentStore).findSessionContextIntent(intent);

          if (Option.isSome(existing)) {
            const previous = tx
              .store(ReplyRequestStore)
              .findReplyRequest({ requestId: existing.value.requestId });

            if (Option.isSome(previous)) {
              for (const target of existing.value.inputs) assertCapturedTarget(tx, target);

              return previous.value;
            }

            throw new StudyError('not_found', 'Captured reply request is unavailable');
          }

          tx.store(ReplyStore).prepareReply(input);

          const context = captureContext(tx, intent, randomUUID(), true);

          const requestId = context.requestId;

          const previous = tx.store(ReplyRequestStore).findReplyRequest({ requestId });

          if (Option.isSome(previous)) return previous.value;

          const result = tx.store(ReplyStore).requestReply({ ...input, requestId, context });

          const target = context.messages.at(-1);

          if (target?.role === 'user')
            retainExplicitQuestionAnswer(
              tx,
              tx.store(MessageStore).message(target.messageId),
              result
            );

          emitReplyRequest(tx, result, 'reply');

          return result;
        }),
      reanswer: (input: typeof reanswerInputSchema.Type) =>
        transaction((tx) => requestTarget(tx, { ...input, origin: 'answer' })),
      convertMessage: (input: typeof convertMessageInputSchema.Type) =>
        transaction((tx) => requestConversion(tx, input)),
      rewriteMessage: (input: typeof rewriteMessageInputSchema.Type) =>
        transaction((tx) => requestTarget(tx, input)),
      message: (id: MessageId) =>
        transaction((tx) => resolveMessageCitations(tx, tx.store(MessageStore).message(id))),
      thread: (input: typeof threadInputSchema.Type) =>
        transaction((tx) => {
          const messages = tx.store(MessageStore);

          const items = messages.messages(input);

          const first = items[0];

          const more =
            first && items.length === input.limit
              ? messages.messages({
                  sessionId: input.sessionId,
                  threadRoot: input.threadRoot,
                  limit: 1,
                  before: first.id
                })
              : [];

          return {
            items: items.map((message) => resolveMessageCitations(tx, message)),
            next: more.length && first ? first.id : null
          };
        }),
      postRecordingMessage: (input: {
        requestId: string;
        sessionId: SessionId;
        sourceId: SourceId;
        projectId: ProjectId | null;
        durationMs: number;
      }) =>
        publicationTransaction((tx) => {
          const recording = tx.store(RecordingPostStore);

          const existing = recording.prepareRecordingPost(input);

          if (existing !== null) return existing;

          const message = postMessage(tx, {
            sessionId: input.sessionId,
            text: '',
            sourceIds: [input.sourceId]
          });

          return recording.finishRecordingPost({ ...input, messageId: message.id });
        }),
      postMessage: (input: typeof postMessageInputSchema.Type) =>
        Effect.gen(function* () {
          const preferences = yield* readWorkspacePreferences();

          return yield* transaction((tx) => {
            const message = postMessage(tx, input);

            const mentioned = mentionsAssistant(input.text);

            if (input.requestReply ?? mentioned) {
              const requestId = randomUUID();

              tx.store(ReplyStore).prepareReply({
                sessionId: input.sessionId,
                threadRoot: input.threadRoot
              });

              const context = captureContext(
                tx,
                {
                  sessionId: input.sessionId,
                  threadRoot: input.threadRoot,
                  intentKey: requestId,
                  instruction: '',
                  preferences: {}
                },
                requestId
              );

              const result = tx.store(ReplyStore).requestReply({
                sessionId: input.sessionId,
                threadRoot: input.threadRoot,
                requestId,
                context
              });

              retainExplicitQuestionAnswer(tx, message, result);
              tx.emit({
                type: 'ConversationGenerationRequested',
                eventId: randomUUID(),
                causationId: null,
                correlationId: requestId,
                inputVersion: 1,
                depth: 0,
                ...result,
                operation: 'reply'
              });
            }

            if (preferences.textConversionMode === 'automatic')
              scheduleAutomaticConversion(tx, message, preferences.textConversionStrategy);

            if (preferences.autoTitleSessions) scheduleAutomaticTitle(tx, input.sessionId);

            return tx.store(MessageStore).message(message.id);
          });
        }),
      updateMessageDescription: (input: typeof updateMessageDescriptionInputSchema.Type) =>
        transaction((tx) =>
          resolveMessageCitations(tx, tx.store(MessageStore).updateMessageDescription(input))
        ),
      editMessage: (input: typeof editMessageInputSchema.Type) =>
        transaction((tx) => {
          const message = tx.store(MessageStore).editMessage(input);

          scheduleQuestion(tx, message);

          return resolveMessageCitations(tx, message);
        }),
      /** Preserves classification on no-op selections and requeues changed content versions. */
      setActiveVersion: (input: typeof setActiveVersionInputSchema.Type) =>
        transaction((tx) => {
          const previous = tx.store(MessageStore).message(input.messageId).activeVersionId;
          const message = tx.store(MessageStore).setActiveVersion(input);

          if (previous !== message.activeVersionId) scheduleQuestion(tx, message, true);

          return resolveMessageCitations(tx, message);
        }),
      /** Reclassifies only when version deletion selects different active content. */
      deleteMessageVersion: (input: typeof setActiveVersionInputSchema.Type) =>
        transaction((tx) => {
          const previous = tx.store(MessageStore).message(input.messageId).activeVersionId;
          const message = tx.store(MessageStore).deleteMessageVersion(input);

          if (previous !== message.activeVersionId) scheduleQuestion(tx, message, true);

          return resolveMessageCitations(tx, message);
        }),
      deleteMessage: (id: MessageId) =>
        transaction((tx) => tx.store(MessageStore).deleteMessage(id)),
      renameSession: (input: typeof renameSessionInputSchema.Type) =>
        transaction((tx) => tx.store(SessionStore).renameSession(input)),
      sessionWork: (input: typeof sessionWorkInputSchema.Type) =>
        transaction((tx) => {
          requireAvailableSession(tx, input.sessionId);

          const rows = tx.store(SessionWorkStore).sessionWorkItems(input);
          const items = rows.map(({ executionId, createdAtMs: _, ...item }) => ({
            ...item,
            execution: Workflows.executionInTransaction(tx, executionId)
          }));
          const last = items.at(-1)?.execution;
          const cursor = last ? { id: last.id, createdAtMs: last.createdAtMs } : null;
          const more =
            cursor && rows.length === input.limit
              ? tx.store(SessionWorkStore).sessionWorkItems({ ...input, before: cursor, limit: 1 })
              : [];

          return { items, next: more.length ? cursor : null };
        }),
      sessionSummaries: summaries.sessionSummary,
      setSessionSettled: (input: typeof setSessionSettledInputSchema.Type) =>
        transaction((tx) => tx.store(SessionSummaryStore).setSessionSettled(input)),
      session: store.session,
      findSession: store.findSession,
      sessions: (input: typeof sessionPageInputSchema.Type) =>
        Effect.gen(function* () {
          const items = yield* store.sessions(input);

          const last = items.at(-1);

          const more =
            last && items.length === input.limit
              ? yield* store.sessions({
                  project: input.project,
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
        transaction((tx) =>
          tx.store(SessionStore).createSession({ ...input, titleSource: 'user' })
        ),
      sessionDeletionExecutions: (id: SessionId) =>
        transaction((tx) =>
          Workflows.retireCorrelations(tx, deletionCorrelations(tx, id), deletionEventTypes)
        ),
      sessionDeletion: (id: SessionId) =>
        transaction((tx) => tx.store(SessionDeletionStore).sessionDeletion(id)),
      retrySessionDeletion: (id: SessionId) =>
        transaction((tx) => {
          const previous = tx.store(SessionDeletionStore).sessionDeletion(id);

          const runs = Workflows.correlatedExecutions(
            tx,
            previous.operationId,
            `${previous.operationId}/${previous.attempt}`
          );

          const pendingTerminal =
            runs.length > 0 &&
            runs.every((run) => run.status === 'completed' || run.status === 'cancelled');

          const result = tx.store(SessionDeletionStore).retry({ sessionId: id, pendingTerminal });

          if (result.attempt !== previous.attempt) emitDeletion(tx, result);

          return result;
        }),
      finishSessionDeletion: (value: { sessionId: SessionId; attempt: number }) =>
        publicationTransaction((tx) => {
          const status = tx.store(SessionDeletionStore).sessionDeletion(value.sessionId);

          if (status.status === 'completed' || status.attempt !== value.attempt) return status;

          Workflows.scrubRetiredCorrelations(tx, deletionCorrelations(tx, value.sessionId));

          return tx.store(SessionDeletionStore).settle({ ...value, errorKind: null });
        }),
      failSessionDeletion: (value: {
        sessionId: SessionId;
        errorKind: ErrorKind;
        attempt: number;
      }) => transaction((tx) => tx.store(SessionDeletionStore).settle(value)),
      deleteSession: (id: SessionId) =>
        transaction((tx) => {
          const existing = tx.store(SessionDeletionStore).findSessionDeletion(id);

          if (Option.isSome(existing)) return existing.value;

          const owned = tx.store(SessionDeletionOwnershipStore).deletionOwnership(id);

          const status = tx
            .store(SessionDeletionStore)
            .accept({ sessionId: id, operationId: randomUUID() });

          const generations = Documents.prepareSessionRetirement(tx, {
            sessionId: id,
            contextIds: owned.contextIds
          });

          tx.store(SessionDeletionStore).retainCorrelations({
            sessionId: id,
            correlations: [...owned.correlations, ...generations]
          });

          Workflows.retireCorrelations(
            tx,
            [...owned.correlations, ...generations],
            deletionEventTypes
          );
          tx.store(SessionDeletionStore).retireCaptures(owned.contextIds);
          tx.store(SessionDeletionStore).removeConversation(id);
          emitDeletion(tx, status);

          return status;
        })
    };
  }),
  {
    searchProjectionsInTransaction: (tx: Transaction, input: SearchProjectionPageInput) =>
      tx.store(ConversationSearchStore).searchProjectionPages(input),
    prepareBackup: (tx: Transaction) => tx.store(ConversationBackupStore).prepare(undefined),
    validateBackup: (tx: Transaction, requireRetired = false) =>
      tx.store(ConversationBackupStore).backupConversation(requireRetired)
  }
);

/** Source membership is independent of the raw message that introduced it. */
function postMessage(tx: Transaction, input: typeof postMessageInputSchema.Type) {
  const message = tx.store(MessageStore).postMessage(input);

  scheduleQuestion(tx, message);

  for (const sourceId of input.sourceIds ?? [])
    Sources.attachInTransaction(tx, { sessionId: input.sessionId, sourceId });

  return message;
}

function resolveTargets(
  tx: Transaction,
  targets: typeof updateSessionSelectionSchema.Type.targets
) {
  if (new Set(targets.map((target) => selectionReferenceKey(target.input))).size !== targets.length)
    throw new StudyError('invalid_input', 'Duplicate selected version');

  const resolved = targets.map((target) => resolveSelection(tx, target));

  if (resolved.reduce((sum, item) => sum + item.excerpts.length, 0) > 200)
    throw new StudyError('not_enough', 'Active session context has too many passages');

  if (
    resolved.reduce(
      (sum, item) => sum + item.excerpts.reduce((n, excerpt) => n + excerpt.text.length, 0),
      0
    ) > 100000
  )
    throw new StudyError('not_enough', 'Active session context exceeds limit');

  return resolved;
}

function requestTarget(
  tx: Transaction,
  input:
    | typeof rewriteMessageInputSchema.Type
    | (typeof reanswerInputSchema.Type & { origin: 'answer' })
) {
  const requestId = randomUUID();

  tx.store(ReplyStore).retireTargetPending(input);

  const message = tx.store(MessageStore).message(input.messageId);

  const context = captureContext(
    tx,
    {
      sessionId: message.sessionId,
      threadRoot: message.threadRoot ?? undefined,
      throughMessageId: input.origin === 'answer' ? (message.replyTo ?? undefined) : message.id,
      intentKey: requestId,
      instruction: input.origin === 'answer' ? '' : (input.instruction ?? ''),
      preferences: {}
    },
    requestId,
    true
  );

  const result = tx.store(ReplyStore).requestTarget({ ...input, requestId, context });

  emitReplyRequest(tx, result, input.origin === 'answer' ? 'reply' : 'rewrite');

  return result;
}

function emitReplyRequest(
  tx: Transaction,
  result: typeof replyRequestSchema.Type,
  operation: 'reply' | 'rewrite'
) {
  tx.emit({
    type: 'ConversationGenerationRequested',
    eventId: randomUUID(),
    causationId: null,
    correlationId: result.requestId,
    inputVersion: 1,
    depth: 0,
    ...result,
    operation
  });
}

function captureContext(
  tx: Transaction,
  input: typeof sessionContextIntentSchema.Type,
  requestId: string,
  deferPendingAttachments = false
) {
  const store = tx.store(SessionContextStore);

  const existing = tx.store(SessionContextIntentStore).findSessionContextIntent(input);

  if (Option.isSome(existing)) {
    for (const target of existing.value.inputs) assertCapturedTarget(tx, target);

    return existing.value;
  }

  const ids = [input.sessionId, ...(input.additionalSessionIds ?? [])];

  if (
    new Set(ids).size !== ids.length ||
    (ids.length > 1 && (input.threadRoot !== undefined || input.throughMessageId !== undefined))
  )
    throw new StudyError('invalid_input', 'Combined capture requires distinct whole sessions');

  const targets = ids.flatMap((sessionId) =>
    activeSessionTargets(tx, sessionId, { ...input, deferPendingAttachments })
  );
  const inputs = input.additionalSessionIds
    ? resolveCombinedTargets(tx, targets)
    : resolveTargets(tx, targets);

  return store.capture({ ...input, requestId, inputs });
}

/** Union exact selected passages without duplicating shared source versions. */
function resolveCombinedTargets(
  tx: Transaction,
  targets: typeof updateSessionSelectionSchema.Type.targets
) {
  const grouped = new Map<string, Array<typeof resolvedSelectionSchema.Type>>();

  for (const target of targets) {
    const resolved = resolveSelection(tx, target);
    const key = selectionReferenceKey(target.input);

    grouped.set(key, [...(grouped.get(key) ?? []), resolved]);
  }

  return resolveTargets(
    tx,
    [...grouped.values()].map((items) => {
      const whole = items.find((item) => item.scope.kind === 'document');

      if (whole) return whole;

      if (items.length === 1) return items[0]!;

      const first = items[0]!;

      if (items.every((item) => item.scope.kind === 'blocks')) {
        const blockIds = [
          ...new Set(
            items.flatMap((item) => (item.scope.kind === 'blocks' ? item.scope.blockIds : []))
          )
        ];

        return {
          input: first.input,
          scope: { kind: 'blocks' as const, blockIds }
        };
      }

      const ranges = [
        ...new Map(
          items
            .flatMap((item) =>
              item.excerpts.map((excerpt) => ({
                blockId: excerpt.blockId,
                start: excerpt.start,
                end: excerpt.end
              }))
            )
            .map((range) => [`${range.blockId}:${range.start}:${range.end}`, range])
        ).values()
      ];

      return {
        input: first.input,
        scope: { kind: 'ranges' as const, ranges }
      };
    })
  );
}

const resolvedCodec = Schema.fromJsonString(Schema.toCodecJson(resolvedSelectionSchema));

function assertCapturedTarget(tx: Transaction, target: typeof resolvedSelectionSchema.Type) {
  const resolved = resolveSelection(tx, target);

  if (
    Schema.encodeSync(resolvedCodec)({ ...resolved, name: target.name }) !==
    Schema.encodeSync(resolvedCodec)(target)
  )
    throw new StudyError('not_found', 'Captured exact content is unavailable');
}

/** Availability checked immutable context, composed inside another feature transaction. */

function inputIsCurrent(tx: Transaction, input: ContentInput) {
  if (input.kind === 'document') {
    const version = Documents.versionInTransaction(tx, input.versionId);

    return (
      Documents.documentInTransaction(tx, { id: version.documentId }).headVersionId === version.id
    );
  }

  const current = Sources.currentExtractionInTransaction(tx, input.sourceId);

  return (
    current !== null &&
    current.revision === input.revision &&
    current.snapshotId === input.snapshotId
  );
}

function readCapturedContext(tx: Transaction, requestId: string) {
  const snapshot = tx.store(SessionContextStore).sessionContext({ requestId });

  tx.store(SessionStore).session(snapshot.sessionId);

  for (const target of snapshot.inputs) assertCapturedTarget(tx, target);

  return snapshot;
}

function deletionCorrelations(tx: Transaction, id: SessionId) {
  return tx.store(SessionDeletionCorrelationStore).deletionCorrelation(id).correlations;
}

function emitDeletion(tx: Transaction, value: typeof sessionDeletionSchema.Type) {
  tx.emit({
    type: 'SessionDeletionRequested',
    eventId: `${value.operationId}/${value.attempt}`,
    causationId: null,
    correlationId: value.operationId,
    inputVersion: 1,
    depth: 0,
    sessionId: value.sessionId,
    attempt: value.attempt
  });
}

/** Source extraction and MaterialPublished notifications have independent library ownership. */

const deletionEventTypes = [
  'DocumentGenerationRequested',
  'DocumentGenerationFailed',
  'DocumentPublished',
  'ConversationGenerationRequested',
  'ConversationTitleRequested',
  'TransformSuggestionRequested',
  'ConversationQuestionRequested',
  'RecordingPostRequested',
  'MaterialGenerationRequested',
  'MaterialGenerationFailed'
] as const;

/** Schedules replay-safe detection only when the saved note is eligible. */
function scheduleQuestion(tx: Transaction, message: ChatMessage, reclassify = false) {
  if (tx.store(SessionModeStore).sessionMode(message.sessionId) === ConversationMode.Assistant)
    return;

  const versionId = message.activeVersionId;

  if (!versionId || !questionEligible(message)) return;

  if (
    !reclassify &&
    tx
      .store(QuestionStore)
      .questionSnapshot({ messageId: message.id, expectedActiveVersionId: versionId }).scheduled
  )
    return;

  emitQuestionRequest(
    tx,
    message,
    versionId,
    reclassify ? randomUUID() : `question/${message.id}/${versionId}`
  );
}

/** Persists question follow-up work atomically with the classification or capture it belongs to. */
function emitQuestionRequest(
  tx: Transaction,
  message: ChatMessage,
  versionId: NonNullable<ChatMessage['activeVersionId']>,
  eventId: string
) {
  tx.emit({
    type: 'ConversationQuestionRequested',
    eventId,
    causationId: null,
    correlationId: `question/${message.id}/${versionId}`,
    inputVersion: 1,
    depth: 0,
    sessionId: message.sessionId,
    messageId: message.id,
    versionId
  });
}

/** Reuses an existing answer or captures the exact question version for generation. */
function answerQuestion(tx: Transaction, input: typeof questionVersionInputSchema.Type) {
  const existing = tx.store(QuestionAnswerStore).findQuestionAnswer(input);

  if (Option.isSome(existing)) {
    if (!questionAnswerRetryable(tx, existing.value)) return existing.value;

    tx.store(QuestionStore).retireQuestionAnswer(input);
  }

  const message = tx.store(MessageStore).message(input.messageId);
  const intentKey = `question/${message.id}/${input.expectedActiveVersionId}/${randomUUID()}`;
  const context = captureContext(
    tx,
    {
      sessionId: message.sessionId,
      threadRoot: message.threadRoot ?? undefined,
      throughMessageId: message.id,
      intentKey,
      instruction: '',
      preferences: {}
    },
    randomUUID(),
    true
  );

  if (
    context.messages.at(-1)?.messageId !== message.id ||
    context.messages.at(-1)?.versionId !== input.expectedActiveVersionId
  )
    throw new StudyError('invalid_input', 'Question context changed');

  const result = tx.store(ReplyStore).requestQuestionReply({
    sessionId: message.sessionId,
    threadRoot: message.threadRoot ?? undefined,
    requestId: context.requestId,
    context
  });

  tx.store(QuestionStore).retainQuestionAnswer({ ...input, answer: result });
  emitReplyRequest(tx, result, 'reply');

  return result;
}

/** Keeps explicit reply requests reusable without imposing automatic-question publication rules. */
function retainExplicitQuestionAnswer(
  tx: Transaction,
  message: ChatMessage,
  answer: typeof replyRequestSchema.Type
) {
  if (message.role === 'user' && message.format !== 'document' && message.activeVersionId)
    tx.store(QuestionStore).retainQuestionAnswer({
      messageId: message.id,
      expectedActiveVersionId: message.activeVersionId,
      answer,
      guard: false
    });
}

/** Allows a new request only after unfinished answer work has settled unsuccessfully. */
function questionAnswerRetryable(tx: Transaction, receipt: typeof replyRequestSchema.Type) {
  const answer = tx.store(MessageStore).message(receipt.messageId);
  const version = answer.versions.find((v) => v.id === receipt.versionId);

  if (version?.status === 'complete') return false;

  const runs = Workflows.correlatedExecutions(tx, receipt.requestId);

  return (
    runs.length > 0 &&
    runs.every(
      (run) =>
        (run.status === 'completed' && run.outcome === 'failure') || run.status === 'cancelled'
    )
  );
}

/** Attachment-only and manually classified notes never consume background detection work. */
function questionEligible(message: ChatMessage) {
  const text =
    message.versions.find((version) => version.id === message.activeVersionId)?.text ?? '';

  return (
    message.role === 'user' &&
    message.format !== 'document' &&
    message.question?.origin !== 'manual' &&
    !!text.trim()
  );
}

/** A terminal unsuccessful run no longer blocks the next Assistant turn. */
function retireAssistantReplies(tx: Transaction, sessionId: SessionId) {
  for (const message of tx.store(MessageStore).messages({ sessionId, limit: 100 })) {
    if (message.role !== 'assistant' || !message.activeVersionId) continue;

    const provenance = tx
      .store(ReplyVersionStore)
      .replyVersion({ sessionId, messageId: message.id, versionId: message.activeVersionId });

    if (provenance.state !== 'available') continue;

    const receipt = {
      sessionId,
      messageId: message.id,
      versionId: message.activeVersionId,
      requestId: provenance.requestId
    };

    if (questionAnswerRetryable(tx, receipt)) tx.store(ReplyStore).abandonReply(receipt);
  }
}

/** Reuses a conversion receipt or commits one new durable request for the captured version. */
function requestConversion(tx: Transaction, input: typeof convertMessageInputSchema.Type) {
  const strategy = Sources.conversionStrategy(input.strategyId);
  const message = tx.store(MessageStore).message(input.messageId);

  if (!canConvertMessage(message, input.expectedActiveVersionId, strategy.supportedInputs))
    throw new StudyError('invalid_input', 'No convertible content');

  requireAvailableSession(tx, message.sessionId);
  const { created, ...result } = tx.store(ReplyStore).requestConversion(input);

  if (created) emitReplyRequest(tx, result, 'rewrite');

  return result;
}

/** Schedules eligible saved inputs while retaining their original selected version. */
function scheduleAutomaticConversion(tx: Transaction, message: ChatMessage, strategyId: string) {
  if (tx.store(SessionModeStore).sessionMode(message.sessionId) === ConversationMode.Assistant)
    return;

  const version = message.versions.find((version) => version.id === message.activeVersionId);

  if (
    !version ||
    version.origin !== 'typed' ||
    !(version.text.includes('\n') || message.parts.some((part) => part.sourceKind === 'pdf'))
  )
    return;

  try {
    const strategy = Sources.conversionStrategy(strategyId);

    if (!canConvertMessage(message, version.id, strategy.supportedInputs)) return;
  } catch (error) {
    if (error instanceof StudyError && error.kind === 'unsupported') return;

    throw error;
  }

  requestConversion(tx, {
    messageId: message.id,
    expectedActiveVersionId: version.id,
    strategyId
  });
}

function askUserTarget(
  context: Pick<typeof runSelectionContextSchema.Type, 'messages' | 'throughMessageId'>
) {
  return context.messages.find((message) => message.messageId === context.throughMessageId);
}
