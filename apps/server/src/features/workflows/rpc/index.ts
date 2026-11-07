/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Binds workflow execution lookup, listing, subscription, and cancellation RPCs to   │
 * │ the workflow service.                                                                    │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - RPC handlers adapt declared schemas to the owning feature service; transport wiring    │
 * │   stays here.                                                                            │
 * │ - Maps declared operations to the feature service.                                       │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Leaves input validation and domain behavior to contracts and service.                    │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { WorkflowsRpc } from '@study/contracts/workflows/rpc';
import { Effect, Stream } from 'effect';

import { Workflows } from '#server/features/workflows/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const WorkflowsRpcLive = defineRpc(
  WorkflowsRpc,
  Effect.gen(function* () {
    const workflows = yield* Workflows;

    return {
      'workflows.agentProgress': (input) => workflows.agentProgress(input),
      'workflows.subscribeAgentProgress': (input) =>
        Stream.unwrap(workflows.subscribeAgentProgress(input)),
      'workflows.execution': ({ id }) => workflows.execution(id),
      'workflows.findExecution': ({ id }) => workflows.findExecution(id),
      'workflows.executions': (input) => workflows.executions(input),
      'workflows.subscribeExecutions': (input) =>
        Stream.unwrap(workflows.subscribeExecutions(input)),
      'workflows.cancelExecution': (input) => workflows.cancelExecution(input)
    };
  })
);
