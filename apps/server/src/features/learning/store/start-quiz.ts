import type { startQuizInputSchema } from '@study/contracts/learning/rpc';
import * as s from '@study/db/schema';

import { requireRow } from '#server/platform/database/rows';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { invalid } from '#server/platform/errors/domain-error';

import { now, makeQuiz } from './quiz.ts';

type Input = typeof startQuizInputSchema.Type;

export function makeStartQuiz(resources: StoreResources) {
  const { db, clock } = resources;
  const { attemptView, published, questions } = makeQuiz(resources);
  const startQuiz = (input: Input) => {
    published(input.versionId, 'quiz');

    if (!questions(input.versionId).length) invalid('empty quiz');

    const row = requireRow(
      db.orm
        .insert(s.material_quiz_attempts)
        .values({
          version_id: input.versionId,
          status: 'in_progress',
          started_at: now(clock)
        })
        .returning()
        .get()
    );
    const result = attemptView(row.id);

    if (result.status !== 'in_progress') invalid('quiz attempt initialization failed');

    return result;
  };

  return {
    startQuiz
  };
}
