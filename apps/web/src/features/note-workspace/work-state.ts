import type { executionSchema } from '@study/contracts/workflows/schemas';

/** Waiting and cancellation remain visible without pretending that execution is active. */
export function workActivityState(
  execution: typeof executionSchema.Type | undefined,
  stopping: boolean
) {
  if (stopping) return 'stopping';

  if (execution?.outcome === 'failure') return 'attention';

  if (execution?.status === 'suspended') return 'waiting';

  return 'running';
}
