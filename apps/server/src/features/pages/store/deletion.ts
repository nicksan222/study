/** @file Builds pages deletion queries and mutations with bound store resources. */

import * as r from '@study/contracts';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { storeQuery } from '#server/platform/definitions/define-store';

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
