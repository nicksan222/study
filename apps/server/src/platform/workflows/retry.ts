import { failureSchema, isRetryable, needsSetup, StudyError } from '@study/contracts/errors';
import type { Failure } from '@study/contracts/errors';
import { workflow_configuration_waits } from '@study/db/schema';
import { Effect, Result, Schema } from 'effect';
import { Activity, DurableClock, DurableDeferred } from 'effect/workflow';

import { Database } from '#server/platform/database/database';
import { recordConfigurationWait } from '#server/platform/observability/index';
import { WorkflowConfiguration } from '#server/platform/workflows/configuration';
import { currentWorkflowActivityOwner } from '#server/platform/workflows/ownership';
import { workflowStore } from '#server/platform/workflows/store';

/** Classify a typed failure without relying on provider error text. */
export function retryDisposition(
  error: Pick<Failure, 'kind'>
): 'configuration' | 'delayed' | 'terminal' {
  if (needsSetup(error.kind)) return 'configuration';

  if (isRetryable(error.kind)) return 'delayed';

  return 'terminal';
}

/** Retry canonical failures using native activity attempts, deferreds and durable clocks. */
export function retryResumableActivity<
  S extends Schema.Constraint,
  E extends Schema.Constraint & { readonly Type: Failure },
  R
>(activity: Activity.Activity<S, E, R>, options: { maxRetries?: number; delayMs?: number } = {}) {
  const maxRetries = options.maxRetries ?? 3;
  const delayMs = options.delayMs ?? 1000;

  if (
    !Number.isSafeInteger(maxRetries) ||
    maxRetries < 0 ||
    !Number.isSafeInteger(delayMs) ||
    delayMs < 1
  )
    throw new RangeError('Invalid durable retry policy');

  return Effect.gen(function* () {
    const configuration = yield* WorkflowConfiguration;
    const { store: context } = yield* Database;
    let delayed = 0;

    for (let attempt = 1; ; attempt++) {
      const observed = yield* Activity.make({
        name: `${activity.name}/configuration-revision`,
        success: Schema.String,
        error: failureSchema,
        execute: configuration.revision
      }).pipe(Effect.provideService(Activity.CurrentAttempt, attempt));
      const result = yield* Effect.result(
        activity.pipe(Effect.provideService(Activity.CurrentAttempt, attempt))
      );

      if (Result.isSuccess(result)) return result.success;

      const disposition = retryDisposition(result.failure);

      if (disposition === 'terminal') return yield* Effect.fail(result.failure);

      if (disposition === 'delayed') {
        if (delayed++ >= maxRetries) return yield* Effect.fail(result.failure);

        yield* DurableClock.sleep({
          name: `${activity.name}/retry/${attempt}`,
          duration: Math.max(
            result.failure.retryAfterMs ?? 0,
            Math.min(delayMs * 2 ** (delayed - 1), 60_000)
          ),
          inMemoryThreshold: 0
        });
        continue;
      }

      const deferred = DurableDeferred.make(`${activity.name}/configuration/${attempt}`);

      yield* Activity.make({
        name: `${activity.name}/register-configuration-wait`,
        error: failureSchema,
        execute: Effect.gen(function* () {
          const owner = yield* currentWorkflowActivityOwner;

          const registered = yield* Effect.try({
            try: () =>
              context.transaction(() => {
                workflowStore(context).assertOwner(owner.executionId, owner.ownerToken);

                return (
                  Number(
                    context.db.orm
                      .insert(workflow_configuration_waits)
                      .values({
                        execution_id: owner.executionId,
                        deferred_name: deferred.name,
                        observed_revision: observed
                      })
                      .onConflictDoNothing()
                      .run().changes
                  ) === 1
                );
              }),
            catch: (cause) =>
              cause instanceof StudyError
                ? cause
                : new StudyError('internal', 'Workflow configuration wait failed', { cause })
          });

          if (registered) yield* recordConfigurationWait();
        })
      }).pipe(Effect.provideService(Activity.CurrentAttempt, attempt));
      yield* DurableDeferred.await(deferred);
    }
  });
}
