/** @file Builds learning grading queries and mutations with bound store resources. */

import { gradingSnapshotSchema, quizAnswerSubmittedSchema } from '@study/contracts';

import { makeGradingSnapshot } from '#server/features/learning/store/grading-snapshot';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { storeQuery } from '#server/platform/definitions/define-store';

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
