/** @file Builds pages versions queries and mutations with bound store resources. */

import * as c from '@study/contracts';
import * as r from '@study/contracts';
import { storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';

import { makePageDomain } from './domain.ts';

export function makePageVersionsStore(resources: StoreResources) {
  const d = makePageDomain(resources);

  return {
    queries: {
      version: storeQuery({
        role: 'required',
        input: r.versionKeySchema,
        output: c.versionSchema,
        run: ({ id }) => d.version(id)
      }),
      versions: storeQuery({
        role: 'collection',
        input: r.versionsSchema,
        output: c.pageVersionPageSchema,
        run: d.versions
      })
    },
    mutations: {}
  };
}
