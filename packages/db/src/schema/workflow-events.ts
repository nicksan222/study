import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** Transactional outbox; rows are retained so delivery survives process restarts. */
export const workflowEvents = sqliteTable(
  'workflow_events',
  {
    eventId: text('event_id').primaryKey(),
    type: text().notNull(),
    causationId: text('causation_id'),
    correlationId: text('correlation_id').notNull(),
    inputVersion: integer('input_version').notNull(),
    depth: integer().notNull(),
    payload: text().notNull(),
    createdAt: integer('created_at').notNull()
  },
  (t) => [
    index('workflow_events_order_idx').on(t.createdAt, t.eventId),
    index('workflow_events_type_order_idx').on(t.type, t.createdAt, t.eventId),
    check('workflow_events_payload_json', sql`json_valid(${t.payload})`),
    check('workflow_events_version_positive', sql`${t.inputVersion} > 0`),
    check('workflow_events_depth_nonnegative', sql`${t.depth} >= 0`)
  ]
);

/** A receipt and its durable scheduling record are committed together. */
export const workflowReceipts = sqliteTable(
  'workflow_receipts',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => workflowEvents.eventId),
    subscription: text().notNull(),
    workflowVersion: integer('workflow_version').notNull(),
    inputVersion: integer('input_version').notNull(),
    executionId: text('execution_id').notNull(),
    createdAt: integer('created_at').notNull()
  },
  (t) => [
    uniqueIndex('workflow_receipts_identity_idx').on(
      t.eventId,
      t.subscription,
      t.workflowVersion,
      t.inputVersion
    ),
    uniqueIndex('workflow_receipts_execution_idx').on(t.executionId),
    check(
      'workflow_receipts_versions_positive',
      sql`${t.workflowVersion} > 0 AND ${t.inputVersion} > 0`
    )
  ]
);
