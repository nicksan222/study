/** @file Owns retirement within this feature. */

import type { executionSchema, executionsInputSchema } from '@study/contracts';

import { ExecutionStore } from '#server/features/workflows/store/index';
import type { Transaction } from '#server/platform/definitions/define-store';

/** Inspect native runs in a caller transaction without transferring execution ownership. */

export function correlatedExecutions(tx: Transaction, correlationId: string, eventId?: string) {
  const rows: (typeof executionSchema.Type)[] = [];

  let before: typeof executionsInputSchema.Type.before;

  for (;;) {
    const page = tx
      .store(ExecutionStore)
      .executions({ correlationId, eventId, limit: 100, before });

    rows.push(...page);

    const last = page.at(-1);

    if (page.length < 100 || !last) return rows;

    before = { id: last.id, createdAtMs: last.createdAtMs };
  }
}
