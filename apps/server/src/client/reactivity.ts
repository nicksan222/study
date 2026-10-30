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
