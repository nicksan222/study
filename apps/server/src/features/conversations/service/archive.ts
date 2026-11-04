import type { ArchivedSessionItem } from '@study/contracts/conversations/archive';
import type { SessionId } from '@study/contracts/ids';

import { SessionArchiveStore } from '#server/features/conversations/store/archive';
import type { Transaction } from '#server/platform/definitions/define-store';

/** Iterate bounded archive reads within one SQLite snapshot; no archived item is hidden by a cap. */
export function allArchivedItems(tx: Transaction, sessionId: SessionId) {
  const items: ArchivedSessionItem[] = [];
  const limit = 100;
  let offset = 0;
  for (;;) {
    const page = tx.store(SessionArchiveStore).archivedItems({ sessionId, limit, offset });
    items.push(...page);
    if (page.length < limit) return items;
    offset += limit;
  }
}
