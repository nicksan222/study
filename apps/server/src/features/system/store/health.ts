/** @file Builds system health queries and mutations with bound store resources. */

import * as schema from '@study/db';
import { Schema } from 'effect';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { storeQuery } from '#server/platform/definitions/define-store';

export function makeHealthStore({ db }: StoreResources) {
  return {
    queries: {
      health: storeQuery({
        role: 'required',
        input: Schema.Void,
        output: Schema.Boolean,
        run: () => {
          db.orm.select().from(schema.projects).limit(1).all();

          return true;
        }
      })
    },
    mutations: {}
  };
}
