/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Creates a quiz attempt and initializes its question state.                         │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Creates attempt snapshots that remain stable during subsequent grading.                │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the learning service applies policy and         │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { randomInt } from 'node:crypto';

import type { startQuizInputSchema } from '@study/contracts/learning/rpc';
import { eq } from '@study/db';
import * as s from '@study/db/schema';

import { requireRow } from '#server/platform/database/rows';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { invalid } from '#server/platform/errors/domain-error';

import { now, makeQuiz } from './quiz.ts';

type Input = typeof startQuizInputSchema.Type;

function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];

  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);

    [result[i], result[j]] = [result[j]!, result[i]!];
  }

  return result;
}

/** Creates durable attempt selections and independently shuffled ordering presentations. */
export function makeStartQuiz(resources: StoreResources) {
  const { db, clock } = resources;
  const { attemptView, published, questions, choices } = makeQuiz(resources);

  /** Stores one presentation shuffle regardless of the choice-shuffle preference. */
  function snapshotOrdering(
    question: ReturnType<typeof questions>[number],
    attemptId: (typeof s.material_quiz_attempts.$inferSelect)['id']
  ) {
    if (question.kind !== 'ordering') return;

    const items = db.orm
      .select()
      .from(s.material_quiz_ordering_items)
      .where(eq(s.material_quiz_ordering_items.question_id, question.id))
      .all();

    db.orm
      .insert(s.material_quiz_attempt_ordering_items)
      .values(
        shuffled(items).map((item, position) => ({
          attempt_id: attemptId,
          question_id: question.id,
          item_id: item.id,
          position: BigInt(position)
        }))
      )
      .run();
  }

  /** Captures the configured question selection and presentation atomically. */
  const startQuiz = (input: Input) => {
    published(input.versionId, 'quiz');

    const configuration = input.configuration;
    let selected = questions(input.versionId).filter(
      (question) =>
        !configuration ||
        configuration.questionKind === 'all' ||
        (configuration.questionKind === 'choice'
          ? question.kind === 'single_choice' || question.kind === 'multiple_choice'
          : question.kind === configuration.questionKind)
    );

    if (configuration?.questionOrder === 'shuffle') selected = shuffled(selected);

    if (configuration) selected = selected.slice(0, configuration.questionCount);

    if (!selected.length) invalid('empty quiz selection');

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

    db.orm
      .insert(s.material_quiz_attempt_questions)
      .values(
        selected.map((question, position) => ({
          attempt_id: row.id,
          version_id: input.versionId,
          question_id: question.id,
          position: BigInt(position)
        }))
      )
      .run();

    for (const question of selected) {
      snapshotOrdering(question, row.id);

      const options = choices(question.id);
      const ordered = configuration?.shuffleChoices ? shuffled(options) : options;

      if (ordered.length)
        db.orm
          .insert(s.material_quiz_attempt_choices)
          .values(
            ordered.map((choice, position) => ({
              attempt_id: row.id,
              question_id: question.id,
              choice_id: choice.id,
              position: BigInt(position)
            }))
          )
          .run();
    }

    const result = attemptView(row.id);

    if (result.status !== 'in_progress') invalid('quiz attempt initialization failed');

    return result;
  };

  return {
    startQuiz
  };
}
