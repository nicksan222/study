import { StudyError } from '@study/contracts/errors';
import { Context, Effect } from 'effect';

import type { ServerContext } from '#server/platform/database/context';
import { recordPublicationRejection } from '#server/platform/observability/index';
import { currentWorkflowActivityOwner } from '#server/platform/workflows/ownership';
import { workflowStore } from '#server/platform/workflows/store';

declare const publicationGuardBrand: unique symbol;

/** A captured activity lease, checked synchronously in the publication transaction. */
export class PublicationGuard extends Context.Service<
  PublicationGuard,
  {
    readonly [publicationGuardBrand]: true;
    readonly assert: (transactionContext: ServerContext) => void;
  }
>()('study/PublicationGuard') {}

/** Supply a guard only from the ownership granted to the currently executing activity. */
export function withPublicationGuard<A, E, R>(
  context: ServerContext,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | StudyError, Exclude<R, PublicationGuard>> {
  return currentWorkflowActivityOwner.pipe(
    Effect.flatMap((owner) => {
      const executionId = owner.executionId;
      const ownerToken = owner.ownerToken;
      const store = workflowStore(context);
      let rejected = 0;
      const guard = {
        assert(transactionContext: ServerContext) {
          try {
            if (transactionContext !== context)
              throw new StudyError('cancelled', 'Workflow publication owner was fenced', {
                cause: new Error('Publication transaction belongs to a different database')
              });

            context.assertTransactionActive();
            const row = store.execution(executionId);

            if (!row || row.status !== 'running' || store.interruptMode(executionId))
              throw new StudyError('cancelled', 'Workflow publication is no longer active');

            try {
              store.assertOwner(executionId, ownerToken);
            } catch (cause) {
              throw new StudyError('cancelled', 'Workflow publication owner was fenced', { cause });
            }
          } catch (cause) {
            rejected++;

            throw cause;
          }
        }
      } as PublicationGuard['Service'];

      return Effect.provideService(effect, PublicationGuard, guard).pipe(
        Effect.onExit(() => (rejected > 0 ? recordPublicationRejection(rejected) : Effect.void))
      );
    })
  );
}
