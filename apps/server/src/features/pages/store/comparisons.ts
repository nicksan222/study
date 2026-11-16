/** @file Builds pages comparisons queries and mutations with bound store resources. */

import * as e from '@study/contracts';
import { storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';

import { makePageDomain } from './domain.ts';

export function makePageComparisonsStore(resources: StoreResources) {
  return {
    queries: {
      comparison: storeQuery({
        role: 'required',
        input: e.compareSchema,
        output: e.comparisonSchema,
        run: makePageDomain(resources).compare
      })
    },
    mutations: {}
  };
}
