/** @file Builds pages history queries and mutations with bound store resources. */

import * as r from '@study/contracts';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { storeQuery } from '#server/platform/definitions/define-store';

import { makePageDomain } from './domain.ts';

export function makePageHistoryStore(resources: StoreResources) {
  return {
    queries: {
      previewHistory: storeQuery({
        role: 'required',
        input: r.historySchema,
        output: r.retirementPreviewSchema,
        run: (v) => makePageDomain(resources).preview(v.pageId, v.keepLatest, false, v.versionId)
      })
    },
    mutations: {}
  };
}
