import { WorkflowsRpc } from '@study/contracts/workflows/rpc';
import { Effect, Stream } from 'effect';

import { Workflows } from '#server/features/workflows/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const WorkflowsRpcLive = defineRpc(
  WorkflowsRpc,
  Effect.gen(function* () {
    const workflows = yield* Workflows;

    return {
      'workflows.execution': ({ id }) => workflows.execution(id),
      'workflows.findExecution': ({ id }) => workflows.findExecution(id),
      'workflows.executions': (input) => workflows.executions(input),
      'workflows.subscribeExecutions': (input) =>
        Stream.unwrap(workflows.subscribeExecutions(input)),
      'workflows.cancelExecution': (input) => workflows.cancelExecution(input)
    };
  })
);
