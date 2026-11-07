import { defineTable, text, integer, index, check, sql } from '../schema-builder.ts';

/** One provider call, independent of workflow publication or output validation. */
export const aiUsage = defineTable({
  role: 'internal',
  reason: 'Durable provider token accounting'
})(
  'ai_usage',
  {
    id: text().primaryKey(),
    runId: text().notNull(),
    agent: text().notNull(),
    provider: text().notNull(),
    model: text().notNull(),
    timestamp: integer().notNull(),
    input: integer().notNull(),
    cacheRead: integer().notNull(),
    cacheWrite: integer().notNull(),
    output: integer().notNull(),
    reasoning: integer().notNull(),
    incomplete: integer({ mode: 'boolean' }).notNull()
  },
  (t) => [
    index('ai_usage_timestamp').on(t.timestamp),
    check(
      'ai_usage_counts',
      sql`${t.input} >= 0 AND ${t.cacheRead} >= 0 AND ${t.cacheWrite} >= 0 AND ${t.output} >= 0 AND ${t.reasoning} >= 0 AND ${t.cacheRead} + ${t.cacheWrite} <= ${t.input} AND ${t.reasoning} <= ${t.output}`
    )
  ]
);
