import type { StudyError } from '@study/contracts/errors';
import { WorkflowsRpc } from '@study/contracts/workflows/rpc';
import { Effect, Stream } from 'effect';

import { Workflows } from '#server/features/workflows/service/index';

const failure = (error: StudyError) => ({
  kind: error.kind,
  message: error.message,
  retryAfterMs: error.retryAfterMs
});

export const WorkflowsRpcLive = WorkflowsRpc.toLayer(
  Effect.gen(function* () {
    const workflows = yield* Workflows;

    return {
      'workflows.execution': ({ id }) => workflows.execution(id).pipe(Effect.mapError(failure)),
      'workflows.findExecution': ({ id }) =>
        workflows.findExecution(id).pipe(Effect.mapError(failure)),
      'workflows.executions': (input) => workflows.executions(input).pipe(Effect.mapError(failure)),
      'workflows.subscribeExecutions': (input) =>
        Stream.unwrap(workflows.subscribeExecutions(input)).pipe(Stream.mapError(failure)),
      'workflows.cancelExecution': (input) =>
        workflows.cancelExecution(input).pipe(Effect.mapError(failure))
    };
  })
);
