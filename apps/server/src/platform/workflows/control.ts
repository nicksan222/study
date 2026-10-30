import { StudyError } from '@study/contracts/errors';
import { cancelExecutionInputSchema } from '@study/contracts/workflows/schemas';
import { Cause, Context, Effect, Schema } from 'effect';
import { WorkflowEngine } from 'effect/workflow';
import type { Workflow } from 'effect/workflow';

import type { ServerContext } from '#server/platform/database/context';

import { workflowStore } from './store.ts';

/** Application-owned access to the actual scoped native workflow engine. */
export class WorkflowControl extends Context.Service<
  WorkflowControl,
  {
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

    if (row.status === 'completed' || row.status === 'cancelled') return;

    const workflow = definitions.find((definition) => definition._tag === row.workflow_tag);

    if (!workflow)
      return yield* Effect.fail(new StudyError('unsupported', 'Workflow version is unavailable'));

    const engine = yield* WorkflowEngine.WorkflowEngine;

    yield* value.mode === 'safe'
      ? engine.interrupt(workflow, value.id)
      : engine.interruptUnsafe(workflow, value.id);
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
