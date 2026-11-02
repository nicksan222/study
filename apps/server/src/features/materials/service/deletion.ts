/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates exact Material policy through feature-owned participants and native    │
 * │ retirement.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps exact deletion behavior behind the owning feature boundary.                      │
 * │ - Preserves durable identities without retaining private captured content.               │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Native Workflow owns execution; public participants coordinate synchronous feature       │
 * │ transactions.                                                                            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID, createHash } from 'node:crypto';

import { StudyError } from '@study/contracts/errors';
import type { ErrorKind } from '@study/contracts/errors';
import type { MaterialVersionId, MaterialId, SourceId, SessionId } from '@study/contracts/ids';
import type {
  requestMaterialDeletionSchema,
  materialDeletionSchema
} from '@study/contracts/materials/deletion';
import type { historyPreviewSchema } from '@study/contracts/materials/history';
import { Context, Effect, Layer, Option } from 'effect';

import {
  MaterialDeletionStore,
  MaterialDeletionPreviewStore
} from '#server/features/materials/store/deletion';
import { MaterialDeletionOwnershipStore } from '#server/features/materials/store/deletion-ownership';
import { MaterialGenerationCleanupStore } from '#server/features/materials/store/generation-cleanup';
import { Workflows } from '#server/features/workflows/index';
import { transaction, publicationTransaction } from '#server/platform/definitions/define-store';
import type { Transaction } from '#server/platform/definitions/define-store';

type Scope = { materialIds: readonly MaterialId[]; sourceIds: readonly SourceId[] };

type Inspect = { token: string; requestIds: readonly string[] };

export type ParticipantSet = {
  Conversations: {
    inspectMaterialHistory: (
      tx: Transaction,
      ids: readonly MaterialVersionId[]
    ) => { token: string; requestIds: readonly string[]; messageCitationCount: number };
    prepareMaterialHistory: (
      tx: Transaction,
      input: { operationId: string; versionIds: readonly MaterialVersionId[] }
    ) => readonly string[];
    scrubMaterialHistory: (tx: Transaction, operationId: string) => void;

    inspectMaterialDeletion: (
      tx: Transaction,
      scope: Scope
    ) => Inspect & {
      sessionIds: readonly SessionId[];
      messageCitationCount: number;
    };
    prepareMaterialDeletion: (
      tx: Transaction,
      scope: Scope & { deletionId: MaterialId }
    ) => readonly string[];
    scrubMaterialDeletion: (tx: Transaction, id: MaterialId) => void;
  };
  Sources: {
    inspectMaterialHistory: (
      tx: Transaction,
      ids: readonly MaterialVersionId[]
    ) => {
      token: string;
      sourceRevisions: typeof historyPreviewSchema.Type.sourceRevisions;
      requestIds: readonly string[];
    };
    prepareMaterialHistory: (
      tx: Transaction,
      input: { operationId: string; versionIds: readonly MaterialVersionId[] }
    ) => void;
    scrubMaterialHistory: (tx: Transaction, operationId: string) => void;

    inspectMaterialDeletion: (tx: Transaction, ids: readonly SourceId[]) => string;
    prepareMaterialDeletion: (tx: Transaction, id: MaterialId) => readonly string[];
    scrubMaterialDeletion: (tx: Transaction, id: MaterialId) => void;
  };
  Recordings: {
    inspectMaterialDeletion: (tx: Transaction, ids: readonly SourceId[]) => Inspect;
    scrubMaterialDeletion: (tx: Transaction, id: MaterialId) => void;
  };
  Learning: {
    inspectMaterialHistory: (tx: Transaction, ids: readonly MaterialVersionId[]) => Inspect;
    prepareMaterialHistory: (
      tx: Transaction,
      ids: readonly MaterialVersionId[]
    ) => readonly string[];
    scrubMaterialHistory: (tx: Transaction, ids: readonly MaterialVersionId[]) => void;

    prepareMaterialDeletion: (tx: Transaction, ids: readonly MaterialId[]) => readonly string[];
    scrubMaterialDeletion: (tx: Transaction, ids: readonly MaterialId[]) => void;
  };
};

export const DeletionParticipants = Context.Service<ParticipantSet>(
  'study/MaterialDeletionParticipants'
);

/** Runtime supplies public synchronous participants without reversing feature dependencies. */
export function deletionParticipantsLayer(participants: ParticipantSet) {
  return Layer.succeed(DeletionParticipants, participants);
}

const eventTypes = [
  'RecordingPostRequested',
  'PracticeSlotRequested',
  'QuizAnswerSubmitted',
  'MaterialPublished',
  'MaterialAnnotationChanged',
  'MaterialGenerationRequested',
  'MaterialGenerationFailed',
  'ConversationGenerationRequested',
  'SourceProcessingRequested',
  'SourceCorrectionRequested',
  'SourceIndexed',
  'SourceProcessingFailed',
  'SourceProjectChanged'
] as const;

function emit(tx: Transaction, value: typeof materialDeletionSchema.Type) {
  tx.emit({
    type: 'MaterialDeletionRequested',
    eventId: `${value.operationId}/${value.attempt}`,
    causationId: null,
    correlationId: value.operationId,
    inputVersion: 1,
    depth: 0,
    materialId: value.materialId,
    attempt: value.attempt
  });
}

function correlations(tx: Transaction, id: MaterialId) {
  return tx.store(MaterialDeletionOwnershipStore).materialDeletionOwnership(id).requestIds;
}

function preview(tx: Transaction, materialId: MaterialId, participants: ParticipantSet) {
  const base = tx.store(MaterialDeletionPreviewStore).materialDeletionPreview(materialId);

  const materialIds = [materialId, ...base.descendants];

  const conversation = participants.Conversations.inspectMaterialDeletion(tx, {
    materialIds,
    sourceIds: base.sourceIds
  });

  const source = participants.Sources.inspectMaterialDeletion(tx, base.sourceIds);

  const recordings = participants.Recordings.inspectMaterialDeletion(tx, base.sourceIds);

  return {
    ...base,
    token: createHash('sha256')
      .update(JSON.stringify([base.token, conversation.token, source, recordings.token]))
      .digest('hex'),
    sessionIds: [...new Set([...base.sessionIds, ...conversation.sessionIds])],
    privateRequestIds: [
      ...new Set([...base.privateRequestIds, ...conversation.requestIds, ...recordings.requestIds])
    ],
    retainedMessageCitationCount: conversation.messageCitationCount
  };
}

export function materialDeletionOperations() {
  return {
    previewDeletion: ({ materialId }: { materialId: MaterialId }) =>
      Effect.flatMap(DeletionParticipants, (participants) =>
        transaction((tx) => preview(tx, materialId, participants))
      ),
    deletion: ({ materialId }: { materialId: MaterialId }) =>
      transaction((tx) => tx.store(MaterialDeletionStore).materialDeletion(materialId)),
    requestDeletion: (input: typeof requestMaterialDeletionSchema.Type) =>
      Effect.flatMap(DeletionParticipants, (participants) =>
        transaction((tx) => {
          const previous = tx.store(MaterialDeletionStore).findMaterialDeletion(input.materialId);

          if (
            Option.isNone(previous) &&
            preview(tx, input.materialId, participants).token !== input.token
          )
            throw new StudyError('invalid_input', 'Deletion preview changed');

          const base = Option.isNone(previous)
            ? tx.store(MaterialDeletionPreviewStore).materialDeletionPreview(input.materialId)
            : null;

          const status = tx
            .store(MaterialDeletionStore)
            .accept({ ...input, token: base?.token ?? input.token, operationId: randomUUID() });

          if (Option.isSome(previous)) return status;

          const sourceIdsForScope = tx
            .store(MaterialDeletionOwnershipStore)
            .materialDeletionOwnership(status.materialId).sourceIds;

          const contextIds = participants.Conversations.prepareMaterialDeletion(tx, {
            deletionId: status.materialId,
            materialIds: status.materialIds,
            sourceIds: sourceIdsForScope
          });

          const ownership = tx.store(MaterialDeletionOwnershipStore);

          ownership.retain({
            deletionId: status.materialId,
            requestIds: contextIds,
            kind: 'context'
          });

          tx.store(MaterialGenerationCleanupStore).prepare({
            kind: 'deletion',
            id: status.materialId,
            contextIds
          });

          const sourceIds = participants.Sources.prepareMaterialDeletion(tx, status.materialId);

          const learningIds = participants.Learning.prepareMaterialDeletion(tx, status.materialIds);

          const recordingIds = participants.Recordings.inspectMaterialDeletion(
            tx,
            sourceIdsForScope
          ).requestIds;

          ownership.retain({
            deletionId: status.materialId,
            requestIds: sourceIds,
            kind: 'source'
          });

          ownership.retain({
            deletionId: status.materialId,
            requestIds: recordingIds,
            kind: 'recording'
          });

          ownership.retain({
            deletionId: status.materialId,
            requestIds: learningIds,
            kind: 'learning'
          });

          ownership.retain({
            deletionId: status.materialId,
            requestIds: ownership.materialDeletionOwnership(status.materialId).publicationIds,
            kind: 'publication'
          });

          Workflows.retireCorrelations(tx, correlations(tx, status.materialId), eventTypes);
          emit(tx, status);

          return status;
        })
      ),
    retryDeletion: ({ materialId }: { materialId: MaterialId }) =>
      transaction((tx) => {
        const previous = tx.store(MaterialDeletionStore).materialDeletion(materialId);

        const runs = Workflows.correlatedExecutions(
          tx,
          previous.operationId,
          `${previous.operationId}/${previous.attempt}`
        );

        const pendingTerminal =
          runs.length > 0 &&
          runs.every((r) => r.status === 'completed' || r.status === 'cancelled');

        const status = tx.store(MaterialDeletionStore).retry({ materialId, pendingTerminal });

        if (status.attempt !== previous.attempt) emit(tx, status);

        return status;
      }),
    materialDeletionExecutions: (id: MaterialId) =>
      transaction((tx) => Workflows.retireCorrelations(tx, correlations(tx, id), eventTypes)),
    finishMaterialDeletion: (input: { materialId: MaterialId; attempt: number }) =>
      Effect.flatMap(DeletionParticipants, (participants) =>
        publicationTransaction((tx) => {
          const status = tx.store(MaterialDeletionStore).materialDeletion(input.materialId);

          if (status.status === 'completed' || status.attempt !== input.attempt) return status;

          tx.store(MaterialGenerationCleanupStore).scrub({
            kind: 'deletion',
            id: status.materialId
          });

          participants.Conversations.scrubMaterialDeletion(tx, status.materialId);

          participants.Learning.scrubMaterialDeletion(tx, status.materialIds);

          tx.store(MaterialDeletionStore).scrub(status.materialId);

          participants.Sources.scrubMaterialDeletion(tx, status.materialId);

          participants.Recordings.scrubMaterialDeletion(tx, status.materialId);

          Workflows.scrubRetiredCorrelations(tx, correlations(tx, status.materialId));

          return tx.store(MaterialDeletionStore).settle({ ...input, errorKind: null });
        })
      ),
    failMaterialDeletion: (input: {
      materialId: MaterialId;
      attempt: number;
      errorKind: ErrorKind;
    }) => transaction((tx) => tx.store(MaterialDeletionStore).settle(input))
  };
}
