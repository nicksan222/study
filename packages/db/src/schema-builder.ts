/** The schema-only Drizzle facade excludes raw table constructors. */
export { sql, desc } from 'drizzle-orm';
export type { SQL, SQLWrapper } from 'drizzle-orm';
export {
  integer,
  text,
  blob,
  real,
  index,
  uniqueIndex,
  primaryKey,
  foreignKey,
  check,
  customType,
  getTableConfig
} from 'drizzle-orm/sqlite-core';
export type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
export { defineTable } from './table.ts';
