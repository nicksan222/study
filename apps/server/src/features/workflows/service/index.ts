/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Coordinates execution queries with workflow controls and database change           │
 * │ notifications for live execution subscriptions.                                          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Feature services own application rules and coordinate typed store operations.          │
 * │ - Validates or coordinates feature-level operations.                                     │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Uses owned stores and platform transactions rather than querying SQLite directly.        │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type {
  executionSchema,
  cancelExecutionInputSchema,
  executionsInputSchema
} from '@study/contracts/workflows/schemas';
import type { Cause } from 'effect';
import { Effect, Queue, Stream } from 'effect';

import { ExecutionStore } from '#server/features/workflows/store/index';
import { databaseChanges } from '#server/platform/database/database';
import { defineService } from '#server/platform/definitions/define-service';
import type { Transaction } from '#server/platform/definitions/define-store';
import { useStore } from '#server/platform/definitions/define-store';
import { WorkflowControl } from '#server/platform/workflows/control';

function* makeWorkflows() {
  const changes = yield* databaseChanges;
  const control = yield* WorkflowControl;
  const store = yield* useStore(ExecutionStore);

  const executions = (input: typeof executionsInputSchema.Type) =>
    Effect.gen(function* () {
      const items = yield* store.executions(input);
      const last = items.at(-1);
      const cursor = last ? { id: last.id, createdAtMs: last.createdAtMs } : null;
      const more =
        cursor && items.length === input.limit
          ? yield* store.executions({ ...input, before: cursor, limit: 1 })
          : [];

      return { items, next: more.length ? cursor : null };
    });

  function* watchExecutions(queue: Queue.Queue<void, Cause.Done>) {
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        changes.subscribe(() => {
          Queue.offerUnsafe(queue, undefined);
        })
      ),
      (unsubscribe) => Effect.sync(unsubscribe)
    );
    yield* Queue.offer(queue, undefined);

    return yield* Effect.forever(
      Effect.sleep('1 second').pipe(Effect.andThen(Queue.offer(queue, undefined)))
    );
  }

  return {
    execution: store.execution,
    findExecution: store.findExecution,
    executions,
    subscribeExecutions: (input: typeof executionsInputSchema.Type) =>
      Effect.succeed(
        Stream.callback<void>((queue) => Effect.gen(() => watchExecutions(queue)), {
          bufferSize: 1,
          strategy: 'sliding'
        }).pipe(Stream.mapEffect(() => executions(input)))
      ),
    cancelExecution: (input: typeof cancelExecutionInputSchema.Type) =>
      control.cancel(input).pipe(Effect.andThen(store.execution(input.id)))
  };
}

export const Workflows = defineService('study/Workflows', Effect.gen(makeWorkflows), {
  correlatedExecutions
});

/** Inspect native runs in a caller transaction without transferring execution ownership. */
function correlatedExecutions(tx: Transaction, correlationId: string) {
  const rows: (typeof executionSchema.Type)[] = [];
  let before: typeof executionsInputSchema.Type.before;

  for (;;) {
    const page = tx.store(ExecutionStore).executions({ correlationId, limit: 100, before });

    rows.push(...page);
    const last = page.at(-1);

    if (page.length < 100 || !last) return rows;

    before = { id: last.id, createdAtMs: last.createdAtMs };
  }
}
