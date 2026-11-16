/** @file Owns themes within this feature. */

import {
  StudyError,
  themeCatalogEntrySchema,
  themeFileSchema,
  themePageInputSchema
} from '@study/contracts';
import { eq, gt, sql, themes } from '@study/db';
import { storeMutation, storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';
import { Option, Schema } from 'effect';

function makeHelpers({ db }: StoreResources) {
  const find = (id: string) => db.orm.select().from(themes).where(eq(themes.id, id)).get();

  return { find };
}

export function makeThemeStore({ db, clock, timestampClock }: StoreResources) {
  const { find } = makeHelpers({ db, clock, timestampClock });

  return {
    queries: {
      theme: storeQuery({
        role: 'required',
        input: Schema.String,
        output: themeFileSchema,
        run: (id) => {
          const row = find(id);

          if (!row) throw new StudyError('not_found', 'Theme not found');

          return row.definition;
        }
      }),
      findTheme: storeQuery({
        role: 'optional',
        input: Schema.String,
        output: Schema.Option(themeFileSchema),
        run: (id) => Option.fromNullishOr(find(id)?.definition)
      }),
      themes: storeQuery({
        role: 'collection',
        input: themePageInputSchema,
        output: Schema.Array(themeCatalogEntrySchema),
        run: ({ limit, before }) =>
          db.orm
            .select()
            .from(themes)
            .where(before === undefined ? undefined : gt(themes.id, before))
            .orderBy(themes.id)
            .limit(limit)
            .all()
            .map((row) => ({ ...row.definition, builtin: row.builtin }))
      })
    },
    mutations: {
      saveTheme: storeMutation({
        changes: ['themes'],
        input: Schema.Struct({ theme: themeFileSchema, replace: Schema.Boolean }),
        output: themeFileSchema,
        run: ({ theme, replace }) => {
          const insert = db.orm.insert(themes).values({ id: theme.id, definition: theme });

          const row = replace
            ? insert
                .onConflictDoUpdate({
                  target: themes.id,
                  set: { definition: theme },
                  setWhere: sql`${themes.builtin}=0`
                })
                .returning()
                .get()
            : insert.onConflictDoNothing().returning().get();

          if (!row) throw new StudyError('invalid_input', 'Theme already exists or is protected');

          return row.definition;
        }
      }),
      deleteTheme: storeMutation({
        changes: ['themes'],
        input: Schema.String,
        output: Schema.Void,
        run: (id) => {
          const row = find(id);

          if (!row) throw new StudyError('not_found', 'Theme not found');

          if (row.builtin) throw new StudyError('invalid_input', 'Built-in theme is read-only');

          db.orm.delete(themes).where(eq(themes.id, id)).run();
        }
      })
    }
  };
}
