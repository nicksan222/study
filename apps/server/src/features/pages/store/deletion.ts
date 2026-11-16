/** @file Builds pages deletion queries and mutations with bound store resources. */

import * as r from '@study/contracts';
import { storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';

import { makePageDomain } from './domain.ts';

export function makePageDeletionStore(resources: StoreResources) {
  return {
    queries: {
      previewDeletion: storeQuery({
        role: 'required',
        input: r.pageKeySchema,
        output: r.retirementPreviewSchema,
        run: (v) => makePageDomain(resources).preview(v.id, 0, true)
      })
    },
    mutations: {}
  };
}
