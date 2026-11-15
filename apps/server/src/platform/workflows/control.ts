/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Provides application-owned workflow cancellation against the scoped native engine. │
 * │ It validates typed cancellation input, resolves the persisted workflow definition, and   │
 * │ maps engine failures to StudyError.                                                      │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports WorkflowControl, cancelExecution. It validates typed cancellation input,       │
 * │   resolves the persisted workflow definition, and maps engine failures to StudyError.    │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Runtime exposes cancellation through WorkflowControl; this function resolves workflow    │
 * │ identity from SQLite before engine interruption.                                         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts';
import { cancelExecutionInputSchema } from '@study/contracts';
import { Cause, Context, Effect, Schema } from 'effect';
import type { WorkflowEngine } from 'effect/workflow';
import type { Workflow } from 'effect/workflow';

import type { ServerContext } from '#server/platform/database/context';
import { isTerminalExecution } from '#server/platform/workflows/status';

import { reconcileCancellation } from './cancellation.ts';
import { workflowStore } from './store.ts';

/** Application-owned access to the actual scoped native workflow engine. */
export class WorkflowControl extends Context.Service<
  WorkflowControl,
  {
    readonly run?: <A>(
      effect: Effect.Effect<A, StudyError, WorkflowEngine.WorkflowEngine>
    ) => Effect.Effect<A, StudyError>;
    readonly cancel: (
      input: typeof cancelExecutionInputSchema.Type
    ) => Effect.Effect<void, StudyError>;
  }
>()('study/WorkflowControl') {}

export function cancelExecution(
  context: ServerContext,
  definitions: readonly Workflow.Any[],
  input: typeof cancelExecutionInputSchema.Type
) {
  return Effect.gen(function* () {
    const value = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(cancelExecutionInputSchema)(input),
      catch: (cause) => new StudyError('invalid_input', 'Invalid workflow cancellation', { cause })
    });
    const row = yield* Effect.try({
      try: () => workflowStore(context).execution(value.id),
      catch: (cause) => new StudyError('internal', 'Workflow state is unavailable', { cause })
    });

    if (!row) return yield* Effect.fail(new StudyError('not_found', 'Workflow execution missing'));

    // Retired runs may still own an in-memory provider fiber after durable scrubbing.
    if (
      isTerminalExecution(row.status) &&
      !(value.mode === 'unsafe' && workflowStore(context).retired(value.id))
    )
      return;

    const workflow = definitions.find((definition) => definition._tag === row.workflow_tag);

    if (!workflow)
      return yield* Effect.fail(new StudyError('unsupported', 'Workflow version is unavailable'));

    yield* reconcileCancellation(context, workflow, value.id, value.mode, value.mode === 'unsafe');
  }).pipe(
    Effect.catchCause((cause) => {
      const error = Cause.squash(cause);

      return Effect.fail(
        error instanceof StudyError
          ? error
          : new StudyError(
              Cause.hasInterrupts(cause) ? 'cancelled' : 'internal',
              'Workflow cancellation failed',
              { cause: error }
            )
      );
    })
  );
}
