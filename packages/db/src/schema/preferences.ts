import { defineTable, sql, text, primaryKey, check } from '../schema-builder.ts';

export const preferences = defineTable({
  role: 'internal',
  reason: 'Private preferences and authentication configuration'
})(
  'preferences',
  {
    scope: text().notNull(),
    key: text().notNull(),
    value: text().notNull()
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.key] }),
    check('preferences_check_1', sql`json_valid(value)`)
  ]
);
