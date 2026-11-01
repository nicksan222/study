/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Exposes workflow execution subscriptions through the typed Study RPC client.       │
 * │ Subscribers receive the server’s persisted snapshot and must scope the consuming fiber   │
 * │ to release the subscription.                                                             │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Exports workflowSnapshots. Subscribers receive the server’s persisted snapshot and     │
 * │   must scope the consuming fiber to release the subscription.                            │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Consumes Study RPC contracts and Effect RPC APIs; caller scopes own network requests,    │
 * │ subscriptions, and cancellation.                                                         │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { StudyRpc } from '@study/contracts/rpc';
import type { executionsInputSchema } from '@study/contracts/workflows/schemas';
import type { RpcClient, RpcGroup } from 'effect/rpc';
import type { RpcClientError } from 'effect/rpc/RpcClientError';

type WorkflowClient = Pick<
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof StudyRpc>, RpcClientError>,
  'workflows.subscribeExecutions'
>;

/** Every subscription starts with a fresh SQLite snapshot. Scope the consuming fiber to disconnect. */
export function workflowSnapshots(
  client: WorkflowClient,
  input: typeof executionsInputSchema.Type
) {
  return client['workflows.subscribeExecutions'](input);
}
