import type { executionSchema } from '@study/contracts/workflows/schemas';
import { Schema } from 'effect';
import { expect, it } from 'vite-plus/test';
import { executionIdSchema } from '@study/contracts/workflows/schemas';
import { activityState } from './activity';

const execution: typeof executionSchema.Type = {
  id: Schema.decodeUnknownSync(executionIdSchema)('test-execution'), workflow: 'import',
  correlationId: null, status: 'completed', outcome: 'failure', failureKind: null,
  canCancel: false, createdAtMs: 0n, updatedAtMs: 0n
};
it('shows failed completed workflows as failures', () => {
  expect(activityState(execution)).toBe('failure');
});
it('preserves cancellation pending rather than reporting completed', () => {
  expect(activityState({ ...execution, outcome: null, status: 'cancelling' })).toBe('cancelling');
});
