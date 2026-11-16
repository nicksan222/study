/** @file Builds themes selection queries and mutations with bound store resources. */

import { and, eq, preferences } from '@study/db';
import { storeMutation, storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

export function makeThemeSelectionStore({ db }: StoreResources) {
  return {
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
        changes: ['themes'],
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
  };
}
