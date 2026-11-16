/** @file Builds themes backup queries and mutations with bound store resources. */

import { StudyError, themeFileSchema } from '@study/contracts';
import { themes } from '@study/db';
import { Schema } from 'effect';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { storeQuery } from '#server/platform/definitions/define-store';

export function makeThemeBackupStore({ db }: StoreResources) {
  return {
    queries: {
      backupTheme: storeQuery({
        role: 'required',
        input: Schema.Void,
        output: Schema.Boolean,
        run: () => {
          for (const row of db.orm.select().from(themes).all()) {
            const theme = Schema.decodeUnknownSync(themeFileSchema)(row.definition);

            if (theme.id !== row.id)
              throw new StudyError('invalid_input', 'Backup theme identity is invalid');
          }

          return true;
        }
      })
    },
    mutations: {}
  };
}
