/** @file Owns processing events within this feature. */

import type { SourceId } from '@study/contracts';
import type { Transaction } from '@study/server';

export const requested = (
  tx: Transaction,
  sourceId: SourceId,
  revision: number,
  requestId: string,
  causationId: string | null = null
) => {
  tx.emit({
    type: 'SourceProcessingRequested',
    eventId: crypto.randomUUID(),
    causationId,
    correlationId: requestId,
    inputVersion: revision,
    depth: causationId === null ? 0 : 1,
    sourceId,
    requestId
  });
};
