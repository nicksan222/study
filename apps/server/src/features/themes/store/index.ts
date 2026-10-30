import { StudyError } from '@study/contracts/errors';
import { themePageInputSchema } from '@study/contracts/themes/rpc';
import { themeFileSchema } from '@study/contracts/themes/schemas';
import { and, eq, gt, sql } from '@study/db';
import { preferences, themes } from '@study/db/schema';
import { Option, Schema } from 'effect';

import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import type { StoreResources } from '#server/platform/definitions/define-store';

function makeHelpers({ db }: StoreResources) {
  const find = (id: string) => db.orm.select().from(themes).where(eq(themes.id, id)).get();

  return { find };
}

export const ThemeStore = defineStore({
  name: 'study/ThemeStore',
  entity: { singular: 'theme', plural: 'themes' },
  make: ({ db, clock }) => {
    const { find } = makeHelpers({ db, clock });

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
          output: Schema.Array(themeFileSchema),
          run: ({ limit, before }) =>
            db.orm
              .select()
              .from(themes)
              .where(before === undefined ? undefined : gt(themes.id, before))
              .orderBy(themes.id)
              .limit(limit)
              .all()
              .map((row) => row.definition)
        })
      },
      mutations: {
        saveTheme: storeMutation({
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
});

export const ThemeSelectionStore = defineStore({
  name: 'study/ThemeSelectionStore',
  entity: { singular: 'selection', plural: 'selections' },
  make: ({ db }) => ({
    queries: {
      selection: storeQuery({
        role: 'required',
        input: Schema.Void,
        output: Schema.Struct({ selected: Schema.NullOr(Schema.String) }),
        run: () => {
          const row = db.orm
            .select()
            .from(preferences)
            .where(and(eq(preferences.scope, 'theme'), eq(preferences.key, 'selected')))
            .get();

          if (!row) return { selected: null };

          const value: unknown = JSON.parse(row.value);

          return { selected: typeof value === 'string' ? value : null };
        }
      })
    },
    mutations: {
      setSelection: storeMutation({
        input: Schema.NullOr(Schema.String),
        output: Schema.Void,
        run: (value) => {
          db.orm
            .insert(preferences)
            .values({ scope: 'theme', key: 'selected', value: JSON.stringify(value) })
            .onConflictDoUpdate({
              target: [preferences.scope, preferences.key],
              set: { value: JSON.stringify(value) }
            })
            .run();
        }
      })
    }
  })
});
