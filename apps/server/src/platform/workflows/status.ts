import type { executionSchema } from '@study/contracts/workflows/schemas';

/** Durable completion and cancellation both fence future execution. */
export function isTerminalExecution(status: (typeof executionSchema.Type)['status']): boolean {
  return status === 'completed' || status === 'cancelled';
}
