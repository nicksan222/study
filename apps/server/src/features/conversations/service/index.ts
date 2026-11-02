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

import { resolvedSelectionSchema } from '@study/contracts/conversations/context';
import type {
  sessionContextIntentSchema,
  captureSessionContextSchema,
  updateSessionSelectionSchema
} from '@study/contracts/conversations/context';
import type { sessionDeletionSchema } from '@study/contracts/conversations/deletion';
import type {
  createSessionInputSchema,
  editMessageInputSchema,
  postMessageInputSchema,
  setActiveVersionInputSchema,
  threadInputSchema,
  renameSessionInputSchema,
  sessionPageInputSchema,
  sessionGenerationPageInputSchema
} from '@study/contracts/conversations/rpc';
import type {
  askInputSchema,
  replyVersionInputSchema,
  publishReplyInputSchema,
  publishTitleInputSchema,
  replyRequestSchema,
  replyRequestInputSchema,
  reanswerInputSchema,
  rewriteMessageInputSchema
} from '@study/contracts/conversations/schemas';
import type { ErrorKind } from '@study/contracts/errors';
import { StudyError } from '@study/contracts/errors';
import type { MessageId, ProjectId, SessionId, SourceId } from '@study/contracts/ids';
import type * as editing from '@study/contracts/materials/editing';
import type { requestDocumentTransformInputSchema } from '@study/contracts/materials/rpc';
import type { materialGenerationPublicationSchema } from '@study/contracts/materials/schemas';
import { mentionLabel, text } from '@study/localization';
import { Effect, Option, Schema } from 'effect';

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
import { RecordingPostStore } from '#server/features/conversations/store/recording';
import {
  ReplyStore,
  ReplyRequestStore,
  ReplyVersionStore,
  RetainedReplySnapshotStore,
  ReplyReadinessStore,
  ReplyWakeStore
} from '#server/features/conversations/store/reply';
import { TitleStore } from '#server/features/conversations/store/title';
import { Materials } from '#server/features/materials/index';
import { Settings } from '#server/features/settings/index';
import { Workflows } from '#server/features/workflows/index';
import { defineService } from '#server/platform/definitions/define-service';
import type { Transaction } from '#server/platform/definitions/define-store';
import {
  transaction,
  useStore,
  publicationTransaction
} from '#server/platform/definitions/define-store';
import { impactToken } from '#server/platform/definitions/impact-token';

import { resolveMessageCitations, resolveVersionCitations } from './citations.ts';
import {
  prepareMaterialDeletion,
  scrubMaterialDeletion,
  inspectMaterialDeletion
} from './material-deletion.ts';
import {
  prepareMaterialHistory,
  scrubMaterialHistory,
  inspectMaterialHistory
} from './material-history.ts';

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

export const Conversations = defineService(
  'study/Conversations',
  Effect.gen(function* () {
    const readReplyReadinessStore = yield* useStore(ReplyReadinessStore);

    const readReplyWakeStore = yield* useStore(ReplyWakeStore);

    const store = yield* useStore(SessionStore);

    const titles = yield* useStore(TitleStore);

    const selections = yield* useStore(SessionSelectionStore);

    const retainedContexts = yield* useStore(RetainedSessionContextStore);

    return {
      applyDocumentProposal: (value: typeof editing.applyDocumentProposalSchema.Type) =>
        transaction((tx) => {
          const replay = Materials.findDocumentProposalReceipt(tx, value, 'apply');

          if (Option.isSome(replay)) return replay.value;

          const context = proposalContext(tx, value);

          const relevantValid = tx
            .store(SessionContextValidityStore)
            .sessionContextValidity({ requestId: context.requestId });

          return Materials.applyDocumentProposal(tx, value, relevantValid);
        }),
      keepDocumentProposal: (value: typeof editing.keepDocumentProposalSchema.Type) =>
        transaction((tx) => {
          const replay = Materials.findDocumentProposalReceipt(tx, value, 'keep');

          if (Option.isSome(replay)) return replay.value;

          proposalContext(tx, value);

          return Materials.keepDocumentProposal(tx, value);
        }),
      compareDocumentProposal: (value: typeof editing.proposalKeySchema.Type) =>
        transaction((tx) => {
          proposalContext(tx, value);

          return Materials.compareDocumentProposal(tx, value);
        }),
      requestDocumentTransform: (value: typeof requestDocumentTransformInputSchema.Type) =>
        transaction((tx) =>
          Materials.requestDocumentTransform(
            tx,
            readCapturedContext(tx, value.contextRequestId),
            value
          )
        ),
      documentTransformContext: (value: { requestId: string }) =>
        transaction((tx) => {
          const request = Materials.readGeneration(tx, value);

          if (!request.documentTransform)
            throw new StudyError('invalid_input', 'Not a session transform');

          const context = readCapturedContext(tx, request.documentTransform.contextRequestId);

          Materials.assertDocumentContext(request, context);

          return context;
        }),
      publishDocumentTransform: (value: typeof materialGenerationPublicationSchema.Type) =>
        publicationTransaction((tx) => {
          const context = pendingTransformContext(tx, value.requestId);

          return Materials.publishDocumentTransform(tx, context, value);
        }),
      retryDocumentTransform: (value: { requestId: string; retryId: string }) =>
        transaction((tx) => {
          const context = pendingTransformContext(tx, value.requestId);

          return Materials.retryDocumentTransform(tx, context, value);
        }),
      sessionSelection: selections.sessionSelection,
      updateSessionSelection: (input: typeof updateSessionSelectionSchema.Type) =>
        transaction((tx) => {
          resolveTargets(tx, input.targets);

          return tx.store(SessionSelectionStore).updateSelection(input);
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
      createUntitledSession: (input: { project?: ProjectId }) =>
        Effect.gen(function* () {
          const settings = yield* Settings;

          const language = yield* settings.language();

          return yield* transaction((tx) =>
            tx.store(SessionStore).createSession({
              ...input,
              title: text(language, 'NewSession'),
              titleSource: 'provisional'
            })
          );
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
      abandonReply: (input: typeof replyRequestSchema.Type) =>
        publicationTransaction((tx) => {
          return tx.store(ReplyStore).abandonReply(input);
        }),
      publishReply: (input: typeof publishReplyInputSchema.Type) =>
        publicationTransaction((tx) => {
          const context = tx
            .store(SessionContextStore)
            .findSessionContext({ requestId: input.requestId });

          if (Option.isSome(context))
            for (const target of context.value.inputs) assertCapturedTarget(tx, target);

          return tx.store(ReplyStore).publishReply(input);
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
          tx.store(SessionStore).session(input.sessionId);

          if (Option.isSome(tx.store(SessionDeletionStore).findSessionDeletion(input.sessionId)))
            throw new StudyError('not_found', 'Session is unavailable');

          const items = Materials.sessionGenerations(tx, input).map((item) => {
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
              ? Materials.sessionGenerations(tx, { ...input, limit: 1, before: last.requestId })
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
      ask: (input: typeof askInputSchema.Type) =>
        transaction((tx) => {
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
            const note = context.messages.find(
              (item) => item.messageId === context.throughMessageId
            );

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

          tx.store(ReplyStore).prepareReply(input);
          const note = tx.store(MessageStore).postMessage(input);
          const context = captureContext(
            tx,
            { ...intent, throughMessageId: note.id },
            randomUUID()
          );
          const result = tx
            .store(ReplyStore)
            .requestReply({ ...input, requestId: context.requestId, context });

          emitReplyRequest(tx, result, 'reply');

          return { ...result, userMessageId: note.id, userVersionId: note.activeVersionId! };
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

          const context = captureContext(tx, intent, randomUUID());

          const requestId = context.requestId;

          const previous = tx.store(ReplyRequestStore).findReplyRequest({ requestId });

          if (Option.isSome(previous)) return previous.value;

          const result = tx.store(ReplyStore).requestReply({ ...input, requestId, context });

          emitReplyRequest(tx, result, 'reply');

          return result;
        }),
      reanswer: (input: typeof reanswerInputSchema.Type) =>
        transaction((tx) => requestTarget(tx, { ...input, origin: 'answer' })),
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

          const message = tx.store(MessageStore).postMessage({
            sessionId: input.sessionId,
            text: '',
            sourceIds: [input.sourceId]
          });

          return recording.finishRecordingPost({ ...input, messageId: message.id });
        }),
      postMessage: (input: typeof postMessageInputSchema.Type) =>
        transaction((tx) => {
          const message = tx.store(MessageStore).postMessage(input);

          const mentioned = [...input.text.matchAll(/(?:^|\s)(@[a-z]+)/giu)].some(
            (match) => match[1]!.toLowerCase() === mentionLabel('assistant')
          );

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

          return message;
        }),
      editMessage: (input: typeof editMessageInputSchema.Type) =>
        transaction((tx) => resolveMessageCitations(tx, tx.store(MessageStore).editMessage(input))),
      setActiveVersion: (input: typeof setActiveVersionInputSchema.Type) =>
        transaction((tx) =>
          resolveMessageCitations(tx, tx.store(MessageStore).setActiveVersion(input))
        ),
      deleteMessage: (id: MessageId) =>
        transaction((tx) => tx.store(MessageStore).deleteMessage(id)),
      renameSession: (input: typeof renameSessionInputSchema.Type) =>
        transaction((tx) => tx.store(SessionStore).renameSession(input)),
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

          Materials.scrubSessionRetirement(tx, value.sessionId);

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

          const generations = Materials.prepareSessionRetirement(tx, {
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
          tx.store(SessionDeletionStore).removeConversation(id);
          emitDeletion(tx, status);

          return status;
        })
    };
  }),
  {
    prepareBackup: (tx: Transaction) => tx.store(ConversationBackupStore).prepare(undefined),
    validateBackup: (tx: Transaction, requireRetired = false) =>
      tx.store(ConversationBackupStore).backupConversation(requireRetired),
    prepareMaterialHistory,
    scrubMaterialHistory,
    inspectMaterialHistory,
    prepareMaterialDeletion,
    scrubMaterialDeletion,
    inspectMaterialDeletion
  }
);

function resolveTargets(
  tx: Transaction,
  targets: typeof updateSessionSelectionSchema.Type.targets
) {
  if (new Set(targets.map((target) => target.versionId)).size !== targets.length)
    throw new StudyError('invalid_input', 'Duplicate selected version');

  const resolved = targets.map((target) => Materials.resolveSessionSelection(tx, target));

  if (resolved.reduce((sum, item) => sum + item.excerpts.length, 0) > 200)
    throw new StudyError('invalid_input', 'Selected context has too many passages');

  if (
    resolved.reduce(
      (sum, item) => sum + item.excerpts.reduce((n, excerpt) => n + excerpt.text.length, 0),
      0
    ) > 100000
  )
    throw new StudyError('invalid_input', 'Selected context exceeds limit');

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
    requestId
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
  requestId: string
) {
  const store = tx.store(SessionContextStore);

  const existing = tx.store(SessionContextIntentStore).findSessionContextIntent(input);

  if (Option.isSome(existing)) {
    for (const target of existing.value.inputs) assertCapturedTarget(tx, target);

    return existing.value;
  }

  const selection = tx
    .store(SessionSelectionStore)
    .sessionSelection({ sessionId: input.sessionId });

  return store.capture({ ...input, requestId, inputs: resolveTargets(tx, selection.targets) });
}

const resolvedCodec = Schema.fromJsonString(Schema.toCodecJson(resolvedSelectionSchema));

function assertCapturedTarget(tx: Transaction, target: typeof resolvedSelectionSchema.Type) {
  const resolved = Materials.resolveSessionSelection(tx, target);

  if (
    Schema.encodeSync(resolvedCodec)({ ...resolved, name: target.name }) !==
    Schema.encodeSync(resolvedCodec)(target)
  )
    throw new StudyError('not_found', 'Captured material content is unavailable');
}

/** Availability checked immutable context, composed inside another feature transaction. */

function readCapturedContext(tx: Transaction, requestId: string) {
  const snapshot = tx.store(SessionContextStore).sessionContext({ requestId });

  tx.store(SessionStore).session(snapshot.sessionId);

  for (const target of snapshot.inputs) assertCapturedTarget(tx, target);

  return snapshot;
}

/** Completed receipts no longer require a retained session capture. */

function pendingTransformContext(tx: Transaction, requestId: string) {
  const request = Materials.readGeneration(tx, { requestId, verifyOnly: true });

  if (!request.documentTransform) throw new StudyError('invalid_input', 'Not a session transform');

  return request.resultVersionId === null
    ? readCapturedContext(tx, request.documentTransform.contextRequestId)
    : undefined;
}

/** Retained proposals are actionable only while their exact session capture is available. */

function proposalContext(tx: Transaction, value: typeof editing.proposalKeySchema.Type) {
  const proposal = Materials.documentProposal(tx, value);

  const request = Materials.readGeneration(tx, { requestId: value.requestId, verifyOnly: true });

  if (!request.documentTransform || request.cancelled)
    throw new StudyError('cancelled', 'Proposal generation is unavailable');

  const context = readCapturedContext(tx, request.documentTransform.contextRequestId);

  if (context.sessionId !== proposal.sessionId)
    throw new StudyError('invalid_input', 'Proposal session mismatch');

  Materials.assertDocumentContext(request, context);

  return context;
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
  'ConversationGenerationRequested',
  'ConversationTitleRequested',
  'RecordingPostRequested',
  'MaterialGenerationRequested',
  'MaterialGenerationFailed'
] as const;
