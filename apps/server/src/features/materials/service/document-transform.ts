/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Composes Materials request and publication participants inside caller              │
 * │ transactions.                                                                            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps derivative identity, receipts and membership publication atomic.                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Conversations supplies availability checked captures; Materials retains all              │
 * │ deliverable persistence.                                                                 │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { runSelectionContextSchema } from '@study/contracts/conversations/context';
import { StudyError } from '@study/contracts/errors';
import type { requestDocumentTransformInputSchema } from '@study/contracts/materials/rpc';
import type {
  materialGenerationInputSchema,
  materialGenerationPublicationSchema,
  materialGenerationSnapshotSchema
} from '@study/contracts/materials/schemas';

import { validateDocumentTransform } from '#server/features/materials/decoders/document-transform';
import { DocumentProposalStore } from '#server/features/materials/store/document-proposals';
import { MaterialGenerationStore, MaterialsStore } from '#server/features/materials/store/index';
import { materialIntegrity } from '#server/features/materials/store/transactions';
import type { Transaction } from '#server/platform/definitions/define-store';

import { assertGenerationActive, emitGenerationPublication } from './generation.ts';

type Context = typeof runSelectionContextSchema.Type;

export function assertDocumentContext(
  request: typeof materialGenerationInputSchema.Type,
  context: Context
) {
  if (
    request.documentTransform?.contextRequestId !== context.requestId ||
    request.inputVersionIds.length !== context.inputs.length ||
    request.inputVersionIds.some((id, index) => id !== context.inputs[index]?.versionId) ||
    request.instruction !== (context.instruction.trim() || undefined)
  )
    throw new StudyError('invalid_input', 'Generation differs from captured context');
}

export function requestDocumentTransform(
  tx: Transaction,
  context: Context,
  value: typeof requestDocumentTransformInputSchema.Type
) {
  if (context.requestId !== value.contextRequestId)
    throw new StudyError('invalid_input', 'Captured context mismatch');

  if (value.editTargetVersionId !== undefined) {
    const target = context.inputs.find((item) => item.versionId === value.editTargetVersionId);

    if (!target || target.scope.kind !== 'document')
      throw new StudyError(
        'invalid_input',
        'Target proposals require an exact whole Document capture'
      );

    tx.store(DocumentProposalStore).assertEditableTarget({ versionId: value.editTargetVersionId });
  }

  const requestId = `document/${context.requestId}`;

  const result = tx.store(MaterialGenerationStore).requestOnce({
    requestId,
    request: {
      kind: 'document',
      title: value.title,
      instruction: context.instruction.trim() || undefined,
      inputVersionIds: context.inputs.map((item) => item.versionId),
      documentTransform: {
        contextRequestId: context.requestId,
        operations: value.operations,
        editTargetVersionId: value.editTargetVersionId
      }
    }
  });

  if (result.created)
    tx.emit({
      type: 'MaterialGenerationRequested',
      eventId: requestId,
      causationId: null,
      correlationId: requestId,
      inputVersion: 1,
      depth: 0,
      requestId,
      kind: 'document'
    });

  return result.request;
}

export function publishDocumentTransform(
  tx: Transaction,
  context: Context | undefined,
  value: typeof materialGenerationPublicationSchema.Type
) {
  return materialIntegrity(() => publishCapturedDocument(tx, context, value));
}

function publishCapturedDocument(
  tx: Transaction,
  context: Context | undefined,
  value: typeof materialGenerationPublicationSchema.Type
) {
  const request = tx
    .store(MaterialGenerationStore)
    .materialGeneration({ requestId: value.requestId, verifyOnly: true });

  const captured = requirePendingDocumentContext(tx, request, context);

  assertCapturedTarget(tx, request, captured);

  if (captured)
    validateDocumentTransform(captured, value, request.documentTransform?.editTargetVersionId);

  const result = tx.store(MaterialGenerationStore).publishGeneration({
    ...value,
    proposalSessionId: captured?.sessionId
  });

  if (context && result.materialId !== undefined)
    tx.store(MaterialsStore).attach({
      sessionId: context.sessionId,
      materialId: result.materialId
    });

  emitGenerationPublication(tx, value.requestId, result);

  return result.versionId;
}

function assertCapturedTarget(
  tx: Transaction,
  request: typeof materialGenerationSnapshotSchema.Type,
  captured: Context | undefined
) {
  if (captured && request.documentTransform?.editTargetVersionId !== undefined) {
    const targetId = request.documentTransform.editTargetVersionId;

    if (
      !captured.inputs.some((item) => item.versionId === targetId && item.scope.kind === 'document')
    )
      throw new StudyError(
        'invalid_input',
        'Proposal target is outside captured whole Document scope'
      );

    tx.store(DocumentProposalStore).assertEditableTarget({ versionId: targetId });
  }
}

export function retryDocumentTransform(
  tx: Transaction,
  context: Context | undefined,
  value: { requestId: string; retryId: string }
) {
  const { request, created } = tx.store(MaterialGenerationStore).prepareRetry(value);

  requirePendingDocumentContext(tx, request, context);

  if (created)
    tx.emit({
      type: 'MaterialGenerationRequested',
      eventId: value.retryId,
      causationId: null,
      correlationId: request.id,
      inputVersion: 1,
      depth: 0,
      requestId: request.id,
      kind: 'document'
    });

  return request;
}

function requirePendingDocumentContext(
  tx: Transaction,
  request: typeof materialGenerationSnapshotSchema.Type,
  context: Context | undefined
) {
  if (!request.documentTransform) throw new StudyError('invalid_input', 'Not a session transform');

  if (request.resultVersionId !== null) return undefined;

  assertGenerationActive(tx, request.id);

  if (!context) throw new StudyError('not_found', 'Captured context is unavailable');

  assertDocumentContext(request, context);

  return context;
}
