/** @file Owns context retention within this feature. */

import { replySnapshotInputSchema, runSelectionContextSchema } from '@study/contracts';
import { defineStore, storeQuery } from '@study/server';

import { makeContextReads } from './context-reads.ts';

export const RetainedNoteContextStore = defineStore({
  name: 'study/RetainedNoteContextStore',
  entity: { singular: 'retainedNoteContext', plural: 'retainedNoteContexts' },
  make: (resources) => {
    const { requiredContext } = makeContextReads(resources);

    return {
      queries: {
        retainedNoteContext: storeQuery({
          role: 'required',
          input: replySnapshotInputSchema,
          output: runSelectionContextSchema,
          run: ({ requestId }) => requiredContext(requestId, false)
        })
      },
      mutations: {}
    };
  }
});
