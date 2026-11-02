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
import type { MaterialId } from '@study/contracts/ids';
import type {
  requestMaterialDeletionSchema,
  materialDeletionSchema
} from '@study/contracts/materials/deletion';
import { Option } from 'effect';

import * as Conversations from '#server/features/conversations/index';
import * as Learning from '#server/features/learning/index';
import * as Recordings from '#server/features/recordings/index';
import * as Sources from '#server/features/sources/index';
import { Workflows } from '#server/features/workflows/index';
import { transaction, publicationTransaction } from '#server/platform/definitions/define-store';
import type { Transaction } from '#server/platform/definitions/define-store';

import { MaterialDeletionGenerationStore } from '../store/deletion-generation.ts';
import { MaterialDeletionOwnershipStore } from '../store/deletion-ownership.ts';
import { MaterialDeletionStore, MaterialDeletionPreviewStore } from '../store/deletion.ts';

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
function preview(tx: Transaction, materialId: MaterialId) {
  const base = tx.store(MaterialDeletionPreviewStore).materialDeletionPreview(materialId);
  const materialIds = [materialId, ...base.descendants];
  const conversation = Conversations.inspectMaterialDeletion(tx, {
    materialIds,
    sourceIds: base.sourceIds
  });
  const source = Sources.inspectMaterialDeletion(tx, base.sourceIds);
  const recordings = Recordings.inspectMaterialDeletion(tx, base.sourceIds);
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
      transaction((tx) => preview(tx, materialId)),
    deletion: ({ materialId }: { materialId: MaterialId }) =>
      transaction((tx) => tx.store(MaterialDeletionStore).materialDeletion(materialId)),
    requestDeletion: (input: typeof requestMaterialDeletionSchema.Type) =>
      transaction((tx) => {
        const previous = tx.store(MaterialDeletionStore).findMaterialDeletion(input.materialId);
        if (Option.isNone(previous) && preview(tx, input.materialId).token !== input.token)
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
        const contextIds = Conversations.prepareMaterialDeletion(tx, {
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
        tx.store(MaterialDeletionGenerationStore).prepare({
          deletionId: status.materialId,
          contextIds
        });
        const sourceIds = Sources.prepareMaterialDeletion(tx, status.materialId);
        const learningIds = Learning.prepareMaterialDeletion(tx, status.materialIds);
        const recordingIds = Recordings.inspectMaterialDeletion(tx, sourceIdsForScope).requestIds;
        ownership.retain({ deletionId: status.materialId, requestIds: sourceIds, kind: 'source' });
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
      }),
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
      publicationTransaction((tx) => {
        const status = tx.store(MaterialDeletionStore).materialDeletion(input.materialId);
        if (status.status === 'completed' || status.attempt !== input.attempt) return status;
        tx.store(MaterialDeletionGenerationStore).scrub(status.materialId);
        Conversations.scrubMaterialDeletion(tx, status.materialId);
        Learning.scrubMaterialDeletion(tx, status.materialIds);
        tx.store(MaterialDeletionStore).scrub(status.materialId);
        Sources.scrubMaterialDeletion(tx, status.materialId);
        Recordings.scrubMaterialDeletion(tx, status.materialId);
        Workflows.scrubRetiredCorrelations(tx, correlations(tx, status.materialId));
        return tx.store(MaterialDeletionStore).settle({ ...input, errorKind: null });
      }),
    failMaterialDeletion: (input: {
      materialId: MaterialId;
      attempt: number;
      errorKind: ErrorKind;
    }) => transaction((tx) => tx.store(MaterialDeletionStore).settle(input))
  };
}
