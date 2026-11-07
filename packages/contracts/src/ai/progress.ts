import { Schema } from 'effect';

import { errorKindSchema } from '../errors.ts';
import { executionIdSchema, executionSchema } from '../workflows/schemas.ts';

export const agentRunIdSchema = Schema.String.check(Schema.isBetweenLength(1, 256)).pipe(
  Schema.brand('AgentRunId')
);

const agentToolDetailSchema = Schema.Struct({
  text: Schema.String.check(Schema.isMaxLength(12000)),
  truncated: Schema.Boolean
});

const toolIdentity = { toolCallId: Schema.String, toolName: Schema.String };

export const agentUpdateSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('text-delta'), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('tool-start'),
    ...toolIdentity,
    input: Schema.optional(agentToolDetailSchema)
  }),
  Schema.Struct({
    type: Schema.Literal('tool-finish'),
    ...toolIdentity,
    outcome: Schema.Literals(['success', 'failure', 'cancelled']),
    output: Schema.optional(agentToolDetailSchema),
    errorKind: Schema.optional(errorKindSchema)
  })
]);

export const agentObservationSchema = Schema.Struct({
  runId: agentRunIdSchema,
  agentId: Schema.String,
  mode: Schema.Literals(['text', 'object']),
  event: Schema.Union([
    agentUpdateSchema,
    Schema.Struct({ type: Schema.Literal('start') }),
    Schema.Struct({ type: Schema.Literal('complete') }),
    Schema.Struct({ type: Schema.Literal('failed'), kind: errorKindSchema })
  ])
});

export const agentToolProgressSchema = Schema.Struct({
  ...toolIdentity,
  status: Schema.Literals(['running', 'completed', 'failed', 'cancelled']),
  input: Schema.optional(agentToolDetailSchema),
  output: Schema.optional(agentToolDetailSchema),
  errorKind: Schema.optional(errorKindSchema),
  startedAtMs: Schema.optional(Schema.BigInt),
  finishedAtMs: Schema.optional(Schema.BigInt)
});

export const agentProgressSchema = Schema.Struct({
  runId: agentRunIdSchema,
  executionId: executionIdSchema,
  executionStatus: executionSchema.fields.status,
  agentId: Schema.String,
  mode: Schema.Literals(['text', 'object']),
  status: Schema.Literals(['running', 'completed', 'failed', 'cancelled']),
  failureKind: Schema.NullOr(errorKindSchema),
  text: Schema.String,
  tools: Schema.Array(agentToolProgressSchema),
  revision: Schema.BigInt,
  updatedAtMs: Schema.BigInt
});

export const agentProgressInputSchema = Schema.Union([
  Schema.Struct({ executionId: executionIdSchema }),
  Schema.Struct({ correlationId: Schema.String.check(Schema.isBetweenLength(1, 256)) })
]);

export const agentProgressPageSchema = Schema.Array(agentProgressSchema);
