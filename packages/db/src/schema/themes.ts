import type { ThemeFile } from '@study/theme';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { sqliteBoolean } from './column-types.ts';

export const themes = sqliteTable('themes', {
  id: text().primaryKey(),
  definition: text({ mode: 'json' }).$type<ThemeFile>().notNull(),
  builtin: sqliteBoolean().notNull().default(false)
});
