import { Schema } from 'effect';

import { sourceKinds } from '#backend/shared/sources/sniff';

const idSchema = Schema.BigInt.check(
  Schema.isBetweenBigInt({ minimum: 1n, maximum: 9223372036854775807n })
);

export const jobKindSchema = Schema.Literals([
  'artifact',
  'extract',
  'fetch',
  'grade',
  'index',
  'question',
  'reply',
  'rewrite',
  'title'
]);

export const jobStatusSchema = Schema.Literals([
  'blocked',
  'cancelled',
  'failed',
  'queued',
  'running',
  'succeeded',
  'waiting'
]);

export const jobTargetSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('source'), id: idSchema }),
  Schema.Struct({ type: Schema.Literal('document'), id: idSchema }),
  Schema.Struct({ type: Schema.Literal('session'), id: idSchema }),
  Schema.Struct({ type: Schema.Literal('message'), id: idSchema }),
  Schema.Struct({ type: Schema.Literal('artifact'), id: idSchema }),
  Schema.Struct({ type: Schema.Literal('question'), id: idSchema })
]);

export const jobSchema = Schema.Struct({
  id: idSchema,
  kind: jobKindSchema,
  target: jobTargetSchema,
  status: jobStatusSchema,
  args: Schema.NullOr(Schema.MutableJson),
  attempts: Schema.BigInt,
  errorKind: Schema.NullOr(
    Schema.Literals([
      'auth',
      'cancelled',
      'config',
      'internal',
      'invalid_input',
      'model_unavailable',
      'not_enough',
      'not_found',
      'rate_limited',
      'transient',
      'unsupported'
    ])
  ),
  error: Schema.NullOr(Schema.String),
  runAfter: Schema.BigInt,
  createdAt: Schema.BigInt,
  updatedAt: Schema.BigInt,
  startedAt: Schema.NullOr(Schema.BigInt),
  finishedAt: Schema.NullOr(Schema.BigInt)
});

export type Job = typeof jobSchema.Type;

export const jobOverviewSchema = Schema.Struct({
  job: jobSchema,
  subject: Schema.String,
  sourceKind: Schema.optional(Schema.Literals(sourceKinds)),
  sourceId: Schema.NullOr(idSchema),
  sessionId: Schema.NullOr(idSchema),
  sessionTitle: Schema.optional(Schema.String),
  projectId: Schema.NullOr(idSchema),
  projectName: Schema.optional(Schema.String),
  practiceId: Schema.NullOr(idSchema)
});

export type JobOverview = typeof jobOverviewSchema.Type;
