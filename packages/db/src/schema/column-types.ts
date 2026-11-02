import { customType, integer, text } from 'drizzle-orm/sqlite-core';

/** node:sqlite returns integers as bigint on Study connections, including booleans. */
export const sqliteBoolean = customType<{ data: boolean; driverData: number | bigint }>({
  dataType: () => 'integer',
  toDriver: (value) => (value ? 1 : 0),
  fromDriver: (value) => value === 1n || value === 1
});

/** Fresh builders for durable cleanup attempts; operation-specific state guards stay on each table. */
export function cleanupAttemptColumns() {
  return {
    attempt: integer().notNull().default(1),
    error_kind: text(),
    created_at: integer().$type<bigint>().notNull(),
    completed_at: integer().$type<bigint>()
  };
}
