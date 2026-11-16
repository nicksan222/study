/** @file Owns executions within this feature. */

import type {
  agentProgressInputSchema,
  cancelExecutionInputSchema,
  executionsInputSchema
} from '@study/contracts';
import { agentProgressLimit } from '@study/contracts';
import type { Cause } from 'effect';
import { Effect, Queue, Stream } from 'effect';

import { AgentProgressStore } from '#server/features/workflows/store/agent-progress';
import { ExecutionStore } from '#server/features/workflows/store/index';
import { databaseChanges } from '#server/platform/database/database';
import { useStore } from '#server/platform/definitions/define-store';
import { WorkflowControl } from '#server/platform/workflows/control';

/** Compose workflow controls and persisted snapshot subscriptions over committed hints. */
export function* makeWorkflows() {
  const changes = yield* databaseChanges;

  const control = yield* WorkflowControl;

  const store = yield* useStore(ExecutionStore);
  const progressStore = yield* useStore(AgentProgressStore);
  const agentProgress = (input: typeof agentProgressInputSchema.Type) =>
    progressStore.agentProgress({ scope: input, limit: agentProgressLimit });

  const executions = Effect.fnUntraced(function* (input: typeof executionsInputSchema.Type) {
    const items = yield* store.executions(input);

    const last = items.at(-1);

    const cursor = last ? { id: last.id, createdAtMs: last.createdAtMs } : null;

    const more =
      cursor && items.length === input.limit
        ? yield* store.executions({ ...input, before: cursor, limit: 1 })
        : [];

    return { items, next: more.length ? cursor : null };
  });

  /** Seed each viewer, coalesce commit hints and periodically recover from missed hints. */
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

  const updates = Stream.callback<void>((queue) => Effect.gen(() => watchExecutions(queue)), {
    bufferSize: 1,
    strategy: 'sliding'
  });

  return {
    agentProgress,
    /** Bound snapshot reads before querying and suppress unchanged revisions on the wire. */
    subscribeAgentProgress: (input: typeof agentProgressInputSchema.Type) =>
      Effect.succeed(
        updates.pipe(
          // Keep only the latest pending hint and bound reads before loading full snapshots.
          Stream.throttle({ units: 1, duration: '100 millis', cost: () => 1 }),
          Stream.mapEffect(() => agentProgress(input)),
          Stream.changesWith(
            (a, b) =>
              a.length === b.length &&
              a.every(
                (run, index) =>
                  run.runId === b[index]?.runId &&
                  run.revision === b[index]?.revision &&
                  run.executionStatus === b[index]?.executionStatus
              )
          )
        )
      ),
    execution: store.execution,
    findExecution: store.findExecution,
    executions,
    subscribeExecutions: (input: typeof executionsInputSchema.Type) =>
      Effect.succeed(updates.pipe(Stream.mapEffect(() => executions(input)))),
    cancelExecution: (input: typeof cancelExecutionInputSchema.Type) =>
      control.cancel(input).pipe(Effect.andThen(store.execution(input.id)))
  };
}
