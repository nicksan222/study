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

import type { agentProgressInputSchema } from '@study/contracts/ai/progress';
import { StudyError } from '@study/contracts/errors';
import type { WorkflowEvent } from '@study/contracts/events';
import { executionIdSchema } from '@study/contracts/workflows/schemas';
import type {
  executionSchema,
  cancelExecutionInputSchema,
  executionsInputSchema
} from '@study/contracts/workflows/schemas';
import type { Cause } from 'effect';
import { Effect, Option, Queue, Schema, Stream } from 'effect';

import { AgentProgressStore } from '#server/features/workflows/store/agent-progress';
import { ExecutionStore } from '#server/features/workflows/store/index';
import { databaseChanges } from '#server/platform/database/database';
import { defineService } from '#server/platform/definitions/define-service';
import type { Transaction } from '#server/platform/definitions/define-store';
import { useStore, transaction } from '#server/platform/definitions/define-store';
import { WorkflowControl } from '#server/platform/workflows/control';
import { WorkflowRetirementStore } from '#server/platform/workflows/retirement';

/** Compose workflow controls and persisted snapshot subscriptions over committed hints. */
function* makeWorkflows() {
  const changes = yield* databaseChanges;

  const control = yield* WorkflowControl;

  const store = yield* useStore(ExecutionStore);
  const progressStore = yield* useStore(AgentProgressStore);
  const agentProgress = (input: typeof agentProgressInputSchema.Type) =>
    progressStore.agentProgress({ scope: input, limit: 100 });

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

export const Workflows = defineService('study/Workflows', Effect.gen(makeWorkflows), {
  validateBackup: (tx: Transaction) =>
    tx.store(WorkflowRetirementStore).workflowRetirement(undefined),
  prepareBackup: (tx: Transaction) => tx.store(WorkflowRetirementStore).prepareBackup(undefined),
  correlatedExecutions,
  executionInTransaction: (tx: Transaction, id: typeof executionIdSchema.Type) =>
    tx.store(ExecutionStore).execution(id),
  retireCorrelations: (
    tx: Transaction,
    ids: readonly string[],
    eventTypes: readonly WorkflowEvent['type'][]
  ) => tx.store(WorkflowRetirementStore).fence({ ids, eventTypes }),
  scrubRetiredCorrelations: (tx: Transaction, ids: readonly string[]) =>
    tx.store(WorkflowRetirementStore).scrub(ids),
  scrubRetiredCorrectionInputs: (tx: Transaction, ids: readonly string[]) =>
    tx.store(WorkflowRetirementStore).scrubCorrectionInputs(ids),
  cancelCorrelatedExecutions: (requestId: string, workflow: string) =>
    Effect.gen(function* () {
      const runs = yield* transaction((tx) =>
        correlatedExecutions(tx, requestId).filter(
          (run) => run.workflow === workflow && run.canCancel
        )
      );

      if (!runs.length) return;

      const control = yield* Effect.serviceOption(WorkflowControl);

      if (Option.isNone(control))
        return yield* Effect.fail(
          new StudyError('unsupported', 'Native cancellation control is unavailable')
        );

      for (const run of runs) yield* control.value.cancel({ id: run.id, mode: 'safe' });
    }),
  interruptRetiredExecutions: (ids: readonly string[]) =>
    Effect.gen(function* () {
      const control = yield* Effect.serviceOption(WorkflowControl);

      if (Option.isNone(control)) return;

      for (const id of ids)
        yield* control.value
          .cancel({ id: Schema.decodeUnknownSync(executionIdSchema)(id), mode: 'unsafe' })
          .pipe(Effect.ignore);
    })
});

/** Inspect native runs in a caller transaction without transferring execution ownership. */

function correlatedExecutions(tx: Transaction, correlationId: string, eventId?: string) {
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
