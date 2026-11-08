/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates local semantic retrieval through typed feature capabilities and native │
 * │ workflows.                                                                               │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Preserves current publication identities and validates searchable entity projections.  │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Runtime registration remains explicit and feature services own all content visibility    │
 * │ rules.                                                                                   │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { failureSchema } from '@study/contracts/errors';
import { Effect, Schema } from 'effect';

import { Search } from '#server/features/search/index';
import { Database } from '#server/platform/database/database';
import { defineActivity } from '#server/platform/definitions/define-activity';
import { defineWorkflow } from '#server/platform/definitions/define-workflow';
import { defineWorkflowHandler } from '#server/platform/definitions/define-workflow-handler';
import { PublicationGuard, withPublicationGuard } from '#server/platform/workflows/publication';

const reconcileResultSchema = Schema.Struct({ embedded: Schema.Int, removed: Schema.Int });

const searchReconciliationWorkflow = defineWorkflow({
  name: 'search-reconciliation',
  version: 1,
  payload: Schema.Struct({ runId: Schema.String.check(Schema.isMinLength(1)) }),
  success: reconcileResultSchema,
  error: failureSchema,
  idempotencyKey: ({ runId }) => runId
});

/** Creates opt-in workflow resources; constructing them never starts indexing. */
export const searchReconciliation = defineWorkflowHandler(searchReconciliationWorkflow, {
  triggers: [],
  execute: () =>
    Effect.gen(function* () {
      const database = yield* Database;
      const service = yield* Search;

      return yield* defineActivity({
        name: 'reconcile-local-search',
        success: reconcileResultSchema,

        execute: withPublicationGuard(
          database.store,
          Effect.gen(function* () {
            const guard = yield* PublicationGuard;

            return yield* service.reconcile(() => guard.assert(database.store));
          })
        )
      });
    })
});
