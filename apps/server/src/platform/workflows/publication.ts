/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Checks scoped domain authorization within publication transactions.                │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Captures generation and rejects cancelled or obsolete publication.                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Domain transactions validate authorization independently of upstream execution           │
 * │ ownership.                                                                               │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import { Context, Effect } from 'effect';

import type { ServerContext, ServerTransactionContext } from '#server/platform/database/context';
import { recordPublicationRejection } from '#server/platform/observability/index';
import { currentWorkflowActivityOwner } from '#server/platform/workflows/ownership';
import { workflowStore } from '#server/platform/workflows/store';

declare const publicationGuardBrand: unique symbol;

/** Scoped domain authorization, checked in the publication transaction. */
export class PublicationGuard extends Context.Service<
  PublicationGuard,
  {
    readonly [publicationGuardBrand]: true;
    readonly assert: (transactionContext: ServerContext | ServerTransactionContext) => void;
  }
>()('study/PublicationGuard') {}

/** Capture the admitted generation; cancellation and retirement fence publication atomically. */
export function withPublicationGuard<A, E, R>(
  context: ServerContext,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | StudyError, Exclude<R, PublicationGuard>> {
  return currentWorkflowActivityOwner.pipe(
    Effect.flatMap((owner) =>
      Effect.gen(function* () {
        const executionId = owner.executionId;
        const generation = yield* Effect.try({
          try: () => workflowStore(context).capturePublication(executionId),
          catch: (cause) =>
            cause instanceof StudyError
              ? cause
              : new StudyError('internal', 'Workflow publication state is unavailable', { cause })
        });
        let active = true;
        let rejected = 0;
        const guard = {
          assert(transactionContext: ServerContext | ServerTransactionContext) {
            try {
              if (
                !('assertTransactionActive' in transactionContext) ||
                transactionContext.transactionOwner !== context.transactionOwner
              )
                throw new StudyError('cancelled', 'Workflow publication owner was fenced', {
                  cause: new Error('Publication transaction belongs to a different database')
                });

              transactionContext.assertTransactionActive();

              if (!active)
                throw new StudyError('cancelled', 'Workflow publication scope has closed');

              workflowStore(transactionContext).assertPublication(executionId, generation);
            } catch (cause) {
              rejected++;

              throw cause;
            }
          }
        } as PublicationGuard['Service'];

        return yield* Effect.provideService(effect, PublicationGuard, guard).pipe(
          Effect.onExit(() => {
            active = false;

            return rejected > 0 ? recordPublicationRejection(rejected) : Effect.void;
          })
        );
      })
    )
  );
}
