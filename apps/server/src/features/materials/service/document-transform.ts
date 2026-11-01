/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Composes Materials request and publication participants inside caller              │
 * │ transactions.                                                                            │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Keeps derivative identity, receipts and membership publication atomic.                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Conversations supplies availability checked captures; Materials retains all deliverable  │
 * │ persistence.                                                                             │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import type { runSelectionContextSchema } from '@study/contracts/conversations/context';
import { StudyError } from '@study/contracts/errors';
import type { requestDocumentTransformInputSchema } from '@study/contracts/materials/rpc';
import type {
  materialGenerationInputSchema,
  materialGenerationPublicationSchema
} from '@study/contracts/materials/schemas';

import { validateDocumentTransform } from '#server/features/materials/decoders/document-transform';
import { MaterialGenerationStore, MaterialsStore } from '#server/features/materials/store/index';
import { materialIntegrity } from '#server/features/materials/store/transactions';
import { Workflows } from '#server/features/workflows/index';
import type { Transaction } from '#server/platform/definitions/define-store';

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

  const requestId = `document/${context.requestId}`;
  const result = tx.store(MaterialGenerationStore).requestOnce({
    requestId,
    request: {
      kind: 'document',
      title: value.title,
      instruction: context.instruction.trim() || undefined,
      inputVersionIds: context.inputs.map((item) => item.versionId),
      documentTransform: { contextRequestId: context.requestId, operations: value.operations }
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

  if (!request.documentTransform) throw new StudyError('invalid_input', 'Not a session transform');

  if (request.resultVersionId === null) {
    assertActive(tx, request.id);

    if (!context) throw new StudyError('not_found', 'Captured context is unavailable');

    assertDocumentContext(request, context);
    validateDocumentTransform(context, value);
  }

  const result = tx.store(MaterialGenerationStore).publishGeneration(value);

  if (context && result.materialId !== undefined)
    tx.store(MaterialsStore).attach({
      sessionId: context.sessionId,
      materialId: result.materialId
    });

  if (result.event && result.materialId !== undefined)
    tx.emit({
      type: 'MaterialPublished',
      eventId: randomUUID(),
      causationId: result.event.eventId,
      correlationId: result.event.correlationId,
      inputVersion: 1,
      depth: result.event.depth + 1,
      materialId: result.materialId,
      materialVersionId: result.versionId,
      generationRequestId: value.requestId
    });

  return result.versionId;
}

export function retryDocumentTransform(
  tx: Transaction,
  context: Context | undefined,
  value: { requestId: string; retryId: string }
) {
  const { request, created } = tx.store(MaterialGenerationStore).prepareRetry(value);

  if (!request.documentTransform) throw new StudyError('invalid_input', 'Not a session transform');

  if (request.resultVersionId === null) {
    assertActive(tx, request.id);

    if (!context) throw new StudyError('not_found', 'Captured context is unavailable');

    assertDocumentContext(request, context);
  }

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

function assertActive(tx: Transaction, requestId: string) {
  if (
    Workflows.correlatedExecutions(tx, requestId).some(
      (run) =>
        run.workflow === 'material-generation/v1' &&
        (run.status === 'cancelled' || run.status === 'cancelling')
    )
  )
    throw new StudyError('cancelled', 'Cancelled generation cannot resume');
}
