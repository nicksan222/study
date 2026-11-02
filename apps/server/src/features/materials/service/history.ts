/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates explicit history preview, acceptance, retry and guarded completion.    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Revalidates exact scope before committing barriers and native retirement intent.       │
 * │ - Composes synchronous feature participants within one canonical transaction.            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Feature services own cleanup policy; native Workflow owns cancellation and execution.    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { ErrorKind } from '@study/contracts/errors';
import type * as h from '@study/contracts/materials/history';
import { Effect, Option } from 'effect';

import { MaterialGenerationCleanupStore } from '#server/features/materials/store/generation-cleanup';
import {
  MaterialHistoryStore,
  MaterialHistoryPreviewStore,
  MaterialHistoryOwnershipStore,
  MaterialHistoryPublicationStore,
  historyHash
} from '#server/features/materials/store/history';
import { Workflows } from '#server/features/workflows/index';
import { transaction, publicationTransaction } from '#server/platform/definitions/define-store';
import type { Transaction } from '#server/platform/definitions/define-store';

import { DeletionParticipants } from './deletion.ts';
import type { ParticipantSet } from './deletion.ts';

type Participants = ParticipantSet;

const eventTypes = [
  'PracticeSlotRequested',
  'QuizAnswerSubmitted',
  'MaterialPublished',
  'MaterialAnnotationChanged',
  'MaterialGenerationRequested',
  'MaterialGenerationFailed',
  'ConversationGenerationRequested',
  'SourceIndexed',
  'SourceCorrectionRequested',
  'SourceProcessingRequested',
  'SourceProcessingFailed'
] as const;

function preview(
  tx: Transaction,
  input: typeof h.historyScopeSchema.Type,
  participants: Participants
) {
  const base = tx.store(MaterialHistoryPreviewStore).materialHistoryPreview(input);

  const conversation = participants.Conversations.inspectMaterialHistory(tx, base.candidateIds);

  const learning = participants.Learning.inspectMaterialHistory(tx, base.candidateIds);

  const source = participants.Sources.inspectMaterialHistory(tx, base.candidateIds);

  return {
    ...base,
    sourceRevisions: source.sourceRevisions,
    retainedMessageCitationCount: conversation.messageCitationCount,
    privateRequestIds: [
      ...new Set([
        ...base.privateRequestIds,
        ...conversation.requestIds,
        ...learning.requestIds,
        ...source.requestIds
      ])
    ],
    token: historyHash([base.token, conversation.token, source.token, learning.token])
  };
}

function emit(tx: Transaction, state: typeof h.historyPruneSchema.Type) {
  tx.emit({
    type: 'MaterialHistoryPruneRequested',
    eventId: `${state.operationId}/${state.attempt}`,
    causationId: null,
    correlationId: state.operationId,
    inputVersion: 1,
    depth: 0,
    operationId: state.operationId,
    attempt: state.attempt
  });
}

function requests(tx: Transaction, operationId: string) {
  return tx.store(MaterialHistoryOwnershipStore).materialHistoryOwnership({ operationId });
}

export function materialHistoryOperations() {
  return {
    previewHistoryPrune: (input: typeof h.historyScopeSchema.Type) =>
      Effect.flatMap(DeletionParticipants, (participants) =>
        transaction((tx) => preview(tx, input, participants))
      ),
    historyPrune: (input: typeof h.historyOperationKeySchema.Type) =>
      transaction((tx) => tx.store(MaterialHistoryStore).materialHistory(input)),
    requestHistoryPrune: (input: typeof h.requestHistoryPruneSchema.Type) =>
      Effect.flatMap(DeletionParticipants, (participants) =>
        transaction((tx) => {
          const store = tx.store(MaterialHistoryStore);

          const previous = store.findMaterialHistory(input);

          if (Option.isSome(previous)) return store.accept(input);

          const current = preview(tx, input, participants);

          if (
            current.token !== input.token ||
            historyHash(current.candidateIds) !== historyHash(input.candidateIds)
          )
            throw new StudyError('invalid_input', 'History preview changed');

          const state = store.accept(input);

          const sourceIds = participants.Sources.inspectMaterialHistory(
            tx,
            state.candidateIds
          ).requestIds;

          participants.Sources.prepareMaterialHistory(tx, {
            operationId: state.operationId,
            versionIds: state.candidateIds
          });

          store.retain({ operationId: state.operationId, requestIds: sourceIds, kind: 'source' });

          const contextIds = participants.Conversations.inspectMaterialHistory(
            tx,
            state.candidateIds
          ).requestIds;

          store.retain({ operationId: state.operationId, requestIds: contextIds, kind: 'context' });

          participants.Conversations.prepareMaterialHistory(tx, {
            operationId: state.operationId,
            versionIds: state.candidateIds
          });

          tx.store(MaterialGenerationCleanupStore).prepare({
            kind: 'history',
            id: state.operationId,
            versionIds: state.candidateIds,
            contextIds
          });

          store.retain({
            operationId: state.operationId,
            requestIds: tx
              .store(MaterialHistoryPublicationStore)
              .materialHistoryPublication(state.candidateIds),
            kind: 'publication'
          });

          const learningIds = participants.Learning.inspectMaterialHistory(
            tx,
            state.candidateIds
          ).requestIds;

          store.retain({
            operationId: state.operationId,
            requestIds: learningIds,
            kind: 'learning'
          });

          participants.Learning.prepareMaterialHistory(tx, state.candidateIds);

          Workflows.retireCorrelations(tx, requests(tx, state.operationId), eventTypes);

          emit(tx, state);

          return state;
        })
      ),
    retryHistoryPrune: (input: typeof h.historyOperationKeySchema.Type) =>
      transaction((tx) => {
        const old = tx.store(MaterialHistoryStore).materialHistory(input);

        const runs = Workflows.correlatedExecutions(
          tx,
          old.operationId,
          `${old.operationId}/${old.attempt}`
        );

        const state = tx.store(MaterialHistoryStore).retry({
          ...input,
          pendingTerminal:
            runs.length > 0 &&
            runs.every((r) => r.status === 'completed' || r.status === 'cancelled')
        });

        if (state.attempt !== old.attempt) emit(tx, state);

        return state;
      }),
    materialHistoryExecutions: (operationId: string) =>
      transaction((tx) => Workflows.retireCorrelations(tx, requests(tx, operationId), eventTypes)),
    finishMaterialHistory: (input: { operationId: string; attempt: number }) =>
      Effect.flatMap(DeletionParticipants, (participants) =>
        publicationTransaction((tx) => {
          const state = tx.store(MaterialHistoryStore).materialHistory(input);

          if (state.status === 'completed' || state.attempt !== input.attempt) return state;

          tx.store(MaterialGenerationCleanupStore).scrub({
            kind: 'history',
            id: input.operationId
          });

          participants.Conversations.scrubMaterialHistory(tx, input.operationId);

          participants.Learning.scrubMaterialHistory(tx, state.candidateIds);

          tx.store(MaterialHistoryStore).scrub(input);

          participants.Sources.scrubMaterialHistory(tx, input.operationId);

          Workflows.scrubRetiredCorrelations(tx, requests(tx, input.operationId));

          return tx.store(MaterialHistoryStore).settle({ ...input, errorKind: null });
        })
      ),
    failMaterialHistory: (input: { operationId: string; attempt: number; errorKind: ErrorKind }) =>
      transaction((tx) => tx.store(MaterialHistoryStore).settle(input))
  };
}
