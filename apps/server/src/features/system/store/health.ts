/** @file Builds system health queries and mutations with bound store resources. */

import * as schema from '@study/db';
import { storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';
import { Schema } from 'effect';

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
