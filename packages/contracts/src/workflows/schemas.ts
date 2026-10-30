import { Schema } from 'effect';

import { errorKindSchema } from '../errors.ts';

export const executionIdSchema = Schema.String.check(Schema.isBetweenLength(1, 256)).pipe(
  Schema.brand('WorkflowExecutionId')
);

const timestampSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 0n, maximum: 9223372036854775807n })
);

export const executionSchema = Schema.Struct({
  id: executionIdSchema,
  workflow: Schema.String,
  correlationId: Schema.NullOr(Schema.String),
  status: Schema.Literals(['running', 'suspended', 'completed', 'cancelled', 'cancelling']),
  outcome: Schema.NullOr(Schema.Literals(['success', 'failure'])),
  failureKind: Schema.NullOr(errorKindSchema),
  canCancel: Schema.Boolean,
  createdAtMs: timestampSchema,
  updatedAtMs: timestampSchema
});

export const executionCursorSchema = Schema.Struct({
  id: executionIdSchema,
  createdAtMs: timestampSchema
});

export const executionsInputSchema = Schema.Struct({
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  before: Schema.optional(executionCursorSchema),
  correlationId: Schema.optional(Schema.String.check(Schema.isBetweenLength(1, 256)))
});

export const executionsPageSchema = Schema.Struct({
  items: Schema.Array(executionSchema),
  next: Schema.NullOr(executionCursorSchema)
});

export const cancelExecutionInputSchema = Schema.Struct({
  id: executionIdSchema,
  mode: Schema.Literals(['safe', 'unsafe'])
});
