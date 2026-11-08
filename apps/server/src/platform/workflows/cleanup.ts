/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates durable cancellation, guarded content retirement and failure           │
 * │ settlement.                                                                              │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Runs retired execution cancellation before publishing cleanup and preserves failure    │
 * │   kinds.                                                                                 │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Features supply typed operations; native Workflow and Activity retain execution          │
 * │ ownership.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { ErrorKind, Failure } from '@study/contracts/errors';
import { executionIdSchema } from '@study/contracts/workflows/schemas';
import { Effect, Schema } from 'effect';

import type { ServerContext } from '#server/platform/database/context';
import { resumableActivity } from '#server/platform/definitions/define-activity';
import { WorkflowControl } from '#server/platform/workflows/control';
import { withPublicationGuard } from '#server/platform/workflows/publication';
import { settleWorkflowFailure } from '#server/platform/workflows/retry';

/** One cleanup protocol shared by deletion and explicit history retirement. */
export function cleanupActivity<S extends Schema.Constraint, R, P, F>(
  context: ServerContext,
  definition: {
    readonly name: string;
    readonly success: S;
    readonly executions: Effect.Effect<readonly string[], Failure, R>;
    readonly publish: Effect.Effect<NoInfer<S['Type']>, Failure, P>;
    readonly settle: (kind: ErrorKind) => Effect.Effect<unknown, Failure, F>;
    readonly failureMessage: string;
  }
) {
  return resumableActivity({
    name: definition.name,
    success: definition.success,
    execute: function* () {
      const control = yield* WorkflowControl;
      const ids = yield* definition.executions;

      for (const id of ids)
        yield* control.cancel({
          id: Schema.decodeUnknownSync(executionIdSchema)(id),
          mode: 'unsafe'
        });

      return yield* withPublicationGuard(context, definition.publish);
    }
  }).pipe(
    Effect.catchCause((cause) =>
      settleWorkflowFailure(cause, definition.failureMessage, definition.settle)
    )
  );
}
