import { defineTable, integer, text, check, sql } from '../schema-builder.ts';

/** Durable identity changes when the application replaces or restores its database. */
export const reactiveGeneration = defineTable({
  role: 'internal',
  reason: 'Distinguishes reactive revisions across database replacement'
})(
  'reactive_generation',
  { singleton: integer().primaryKey(), generation: text().notNull() },
  (t) => [check('reactive_generation_singleton', sql`${t.singleton} = 1`)]
);

/** Bounded dependency scopes share the application transaction's commit and rollback. */
export const reactiveRevisions = defineTable({
  role: 'internal',
  reason: 'Persisted read dependency revisions recover missed post-commit hints'
})(
  'reactive_revisions',
  { scope: text().primaryKey(), revision: integer().$type<bigint>().notNull() },
  (t) => [check('reactive_revision_positive', sql`${t.revision} > 0`)]
);
