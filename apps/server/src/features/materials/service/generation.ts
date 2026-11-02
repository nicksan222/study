/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Shares generation cancellation and publication participants within Materials.      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Fences cancelled execution and emits committed generation publication events.          │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Participants use the caller's synchronous transaction; stores retain persistence.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomUUID } from 'node:crypto';

import { StudyError } from '@study/contracts/errors';
import type { materialGenerationRequestedSchema } from '@study/contracts/events';
import type { MaterialId, MaterialVersionId } from '@study/contracts/ids';

import { Workflows } from '#server/features/workflows/index';
import type { Transaction } from '#server/platform/definitions/define-store';

export function assertGenerationActive(tx: Transaction, requestId: string) {
  if (
    Workflows.correlatedExecutions(tx, requestId).some(
      (run) =>
        run.workflow === 'material-generation/v1' &&
        (run.status === 'cancelled' || run.status === 'cancelling')
    )
  )
    throw new StudyError('cancelled', 'Cancelled generation cannot resume');
}

export function emitGenerationPublication(
  tx: Transaction,
  requestId: string,
  result: {
    event: typeof materialGenerationRequestedSchema.Type | null;
    materialId?: MaterialId | undefined;
    versionId: MaterialVersionId;
  }
) {
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
      generationRequestId: requestId
    });
}
