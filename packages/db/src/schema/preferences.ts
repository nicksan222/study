import { sql } from 'drizzle-orm';
import { sqliteTable, text, primaryKey, check } from 'drizzle-orm/sqlite-core';

export const preferences = sqliteTable(
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
