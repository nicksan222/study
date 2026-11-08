/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks exact capture retirement barriers before snapshot decoding.                 │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves history and whole-deletion failures for context and reply readers.           │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Notes reads proof rows; owning services retain publication authority.                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { and, eq } from '@study/db';
import { note_retired_intents, workflow_retired_correlations } from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';

export function makeAssertContextAvailable({ db }: StoreResources) {
  return (requestId: string, actionable = true) => {
    if (
      db.orm
        .select()
        .from(note_retired_intents)
        .where(eq(note_retired_intents.request_id, requestId))
        .get()
    )
      throw new StudyError('not_found', 'Captured input history is unavailable');

    if (
      actionable &&
      db.orm
        .select({ id: workflow_retired_correlations.correlation_id })
        .from(workflow_retired_correlations)
        .where(
          and(
            eq(workflow_retired_correlations.correlation_id, requestId),
            eq(workflow_retired_correlations.event_type, 'NoteGenerationRequested')
          )
        )
        .get()
    )
      throw new StudyError('not_found', 'Captured reply has been retired');
  };
}
