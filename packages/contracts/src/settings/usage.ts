import { Schema } from 'effect';

import { agentRunIdSchema } from '../ai/progress.ts';

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const usageCountsSchema = Schema.Struct({
  input: count,
  cacheRead: count,
  cacheWrite: count,
  output: count,
  reasoning: count,
  incomplete: Schema.Boolean
});

export const usageRecordSchema = Schema.Struct({
  id: Schema.String,
  runId: agentRunIdSchema,
  agent: Schema.String,
  provider: Schema.String,
  model: Schema.String,
  timestamp: count,
  ...usageCountsSchema.fields
});

export const usageQuerySchema = Schema.Struct({
  days: Schema.Literals([1, 7, 30, 90]),
  provider: Schema.optional(Schema.String)
});

const totals = {
  input: count,
  cacheRead: count,
  cacheWrite: count,
  output: count,
  reasoning: count,
  requests: count,
  runs: count,
  incomplete: count
};

const breakdown = Schema.Struct({ key: Schema.String, provider: Schema.String, ...totals });

export const usageReportSchema = Schema.Struct({
  generatedAt: count,
  totals: Schema.Struct(totals),
  providers: Schema.Array(Schema.String),
  models: Schema.Array(breakdown),
  agents: Schema.Array(breakdown),
  days: Schema.Array(Schema.Struct({ key: Schema.String, ...totals }))
});

export type UsageRecord = typeof usageRecordSchema.Type;

export type UsageQuery = typeof usageQuerySchema.Type;

export type UsageReport = typeof usageReportSchema.Type;
