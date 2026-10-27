import { customType } from 'drizzle-orm/sqlite-core';

/** node:sqlite returns integers as bigint on Study connections, including booleans. */
export const sqliteBoolean = customType<{ data: boolean; driverData: number | bigint }>({
  dataType: () => 'integer',
  toDriver: (value) => (value ? 1 : 0),
  fromDriver: (value) => value === 1n || value === 1
});
