import type { ThemeFile } from '@study/theme';

import { defineTable, text } from '../schema-builder.ts';
import { sqliteBoolean } from './column-types.ts';

export const themes = defineTable({ role: 'internal', reason: 'Presentation theme configuration' })(
  'themes',
  {
    id: text().primaryKey(),
    definition: text({ mode: 'json' }).$type<ThemeFile>().notNull(),
    builtin: sqliteBoolean().notNull().default(false)
  }
);
