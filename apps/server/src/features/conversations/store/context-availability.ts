/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks exact capture retirement barriers before snapshot decoding.                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves history and whole-deletion failures for context and reply readers.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Conversations reads proof rows; owning services retain publication authority.            │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { and, eq } from '@study/db';
import {
  material_history_requests,
  material_deletion_requests,
  workflow_retired_correlations
} from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

export function makeAssertContextAvailable({ db }: StoreResources) {
  return (requestId: string, deletionMessage: string, actionable = true) => {
    if (
      actionable &&
      db.orm
        .select({ id: workflow_retired_correlations.correlation_id })
        .from(workflow_retired_correlations)
        .where(
          and(
            eq(workflow_retired_correlations.correlation_id, requestId),
            eq(workflow_retired_correlations.event_type, 'ConversationGenerationRequested')
          )
        )
        .get()
    )
      throw new StudyError('not_found', 'Captured reply has been retired');

    if (
      db.orm
        .select({ id: material_history_requests.request_id })
        .from(material_history_requests)
        .where(eq(material_history_requests.request_id, requestId))
        .get()
    )
      throw new StudyError('not_found', 'Captured input history is unavailable');

    if (
      db.orm
        .select({ id: material_deletion_requests.request_id })
        .from(material_deletion_requests)
        .where(eq(material_deletion_requests.request_id, requestId))
        .get()
    )
      throw new StudyError('not_found', deletionMessage);
  };
}
