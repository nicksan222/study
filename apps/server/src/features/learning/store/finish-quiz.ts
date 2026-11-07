/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Finalizes a quiz attempt and persists its completion state.                        │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Commits quiz completion and derived attempt state through typed mutations.             │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the learning service applies policy and         │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import type { attemptInputSchema } from '@study/contracts/learning/rpc';
import { isTextQuestionKind } from '@study/contracts/materials/schemas';
import { and, eq } from '@study/db';
import * as s from '@study/db/schema';

import type { StoreResources } from '#server/platform/definitions/define-store';
import { invalid } from '#server/platform/errors/domain-error';

import { decodeAssociations, matchingScore } from './matching.ts';
import { now, makeQuiz } from './quiz.ts';

type Input = typeof attemptInputSchema.Type;

/** Finalize attempt snapshots after revalidating deterministic answer scores. */
export function makeFinishQuiz(resources: StoreResources) {
  const { db, clock } = resources;
  const { attemptRow, attemptView, choiceScore, attemptQuestions } = makeQuiz(resources);
  /** Recompute structured scores before committing the immutable completed attempt. */
  const finishQuiz = (input: Input) => {
    const a = attemptRow(input.attemptId, true);

    for (const q of attemptQuestions(a.id)) {
      const where = and(
        eq(s.material_quiz_responses.attempt_id, a.id),
        eq(s.material_quiz_responses.question_id, q.id)
      );
      const response = db.orm.select().from(s.material_quiz_responses).where(where).get();

      if (!response) continue;

      const selected = db.orm
        .select()
        .from(s.material_quiz_selections)
        .where(
          and(
            eq(s.material_quiz_selections.attempt_id, a.id),
            eq(s.material_quiz_selections.question_id, q.id)
          )
        )
        .all();

      if (q.kind === 'matching') {
        const score = matchingScore(q.matching_pairs!, decodeAssociations(response.answer));

        db.orm.update(s.material_quiz_responses).set({ score, feedback: null }).where(where).run();
      } else if (isTextQuestionKind(q.kind)) {
        if (!response.answer?.trim() || selected.length) invalid('malformed open response');
      } else {
        const score = choiceScore(
          q,
          selected.map((c) => c.choice_id)
        );

        db.orm
          .update(s.material_quiz_responses)
          .set({
            score,
            feedback: null
          })
          .where(where)
          .run();
      }
    }

    db.orm
      .update(s.material_quiz_attempts)
      .set({
        status: 'completed',
        finished_at: now(clock)
      })
      .where(eq(s.material_quiz_attempts.id, a.id))
      .run();
    const result = attemptView(a.id);

    if (result.status !== 'completed') invalid('quiz completion failed');

    return result;
  };

  return {
    finishQuiz
  };
}
