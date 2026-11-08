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
import { Stream } from 'effect';

import { Workflows } from '#server/features/workflows/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const WorkflowsRpcLive = defineRpc(
  WorkflowsRpc,
  { workflows: Workflows },
  ({ workflows }) => ({
    'workflows.agentProgress': workflows.agentProgress,
    'workflows.subscribeAgentProgress': (input) =>
      Stream.unwrap(workflows.subscribeAgentProgress(input)),
    'workflows.execution': ({ id }) => workflows.execution(id),
    'workflows.findExecution': ({ id }) => workflows.findExecution(id),
    'workflows.executions': workflows.executions,
    'workflows.subscribeExecutions': (input) => Stream.unwrap(workflows.subscribeExecutions(input)),
    'workflows.cancelExecution': workflows.cancelExecution
  })
);
