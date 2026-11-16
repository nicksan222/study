/** @file Owns publication within this feature. */

import type { MaterialVersionDetailDto } from '@study/contracts';
import type { Transaction } from '@study/server';

export function published(tx: Transaction, version: MaterialVersionDetailDto) {
  if (version.status !== 'published') return;

  const eventId = crypto.randomUUID();

  tx.emit({
    type: 'MaterialPublished',
    eventId,
    causationId: null,
    correlationId: eventId,
    inputVersion: 1,
    depth: 0,
    materialId: version.material_id,
    materialVersionId: version.id
  });
}
