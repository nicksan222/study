/** @file Builds learning grading queries and mutations with bound store resources. */

import { gradingSnapshotSchema, quizAnswerSubmittedSchema } from '@study/contracts';
import { storeQuery } from '@study/server';
import type { StoreResources } from '@study/server';

import { makeGradingSnapshot } from '#server/features/learning/store/grading-snapshot';

export function makeGradingSnapshotStore(resources: StoreResources) {
  const { gradingSnapshot } = makeGradingSnapshot(resources);

  return {
    queries: {
      gradingSnapshot: storeQuery({
        role: 'required',
        input: quizAnswerSubmittedSchema,
        output: gradingSnapshotSchema,
        run: (input) => gradingSnapshot(input)
      })
    },
    mutations: {}
  };
}
