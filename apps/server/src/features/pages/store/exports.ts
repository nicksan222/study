/** @file Builds pages exports queries and mutations with bound store resources. */

import * as r from '@study/contracts';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { storeQuery } from '#server/platform/definitions/define-store';

import { makePageDomain } from './domain.ts';

export function makePageExportsStore(resources: StoreResources) {
  return {
    queries: {
      exportVersion: storeQuery({
        role: 'required',
        input: r.versionKeySchema,
        output: r.exportSchema,
        run: makePageDomain(resources).exportVersion
      })
    },
    mutations: {}
  };
}
