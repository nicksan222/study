import type { agentProgressInputSchema } from '@study/contracts';
import { rpc } from '@study/contracts/react';

/** Persisted progress snapshots follow background workflow revisions. */
export function useAgentProgress(input: typeof agentProgressInputSchema.Type) {
  const state = rpc.workflows.agentProgress.useQuery(input);

  return { ...state, runs: state.data ?? [] };
}
