/** @file Builds notes reply retention queries and mutations with bound store resources. */

import { replySnapshotInputSchema, replySnapshotSchema } from '@study/contracts';
/** Owns reply retention within this feature. */

import { defineStore, storeQuery } from '#server/platform/definitions/define-store';

import { makeReplySnapshots } from './reply-snapshots.ts';

export const RetainedReplySnapshotStore = defineStore({
  name: 'study/RetainedReplySnapshotStore',
  entity: { singular: 'retainedReplySnapshot', plural: 'retainedReplySnapshots' },
  make: (resources) => {
    const { replyContext } = makeReplySnapshots(resources);

    return {
      queries: {
        retainedReplySnapshot: storeQuery({
          role: 'required',
          input: replySnapshotInputSchema,
          output: replySnapshotSchema,
          run: ({ requestId }) => replyContext(requestId, false).result
        })
      },
      mutations: {}
    };
  }
});
