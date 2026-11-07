/**
 * ╭──────────────────────────────────────────────────────────────────────────────────────────╮
 * │ @file Reads and updates quiz definitions and active quiz state.                          │
 * │                                                                                          │
 * │ Responsibilities:                                                                        │
 * │ - Provides quiz reads and attempt-level state mutations to learning services.            │
 * │ - Keeps persistence inputs and results typed for service-layer composition.              │
 * │                                                                                          │
 * │ Boundaries:                                                                              │
 * │ Typed store helpers own database access; the learning service applies policy and         │
 * │ composes these private operations.                                                       │
 * ╰──────────────────────────────────────────────────────────────────────────────────────────╯
 */

import { StudyError } from '@study/contracts/errors';
import type { QuizOrderingItemId } from '@study/contracts/ids';
import type { MaterialVersionId, QuizAttemptId } from '@study/contracts/ids';
import type { QuizQuestionId, QuizChoiceId } from '@study/contracts/ids';
import { orderingAnswerJsonSchema } from '@study/contracts/learning/schemas';
import type { quizAttemptInProgressSchema } from '@study/contracts/learning/schemas';
import { isTextQuestionKind } from '@study/contracts/materials/schemas';
import { and, asc, eq } from '@study/db';
import * as s from '@study/db/schema';
import { Schema } from 'effect';

import { requireRow } from '#server/platform/database/rows';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { invalid } from '#server/platform/errors/domain-error';
export { unixSeconds as now } from '#server/platform/time/index';

/** Reads attempt snapshots while keeping canonical answers private until completion. */
export function makeQuiz(resources: StoreResources) {
  const { db } = resources;

  function published(versionId: MaterialVersionId, kind: 'quiz' | 'flashcards') {
    const version = db.orm
      .select()
      .from(s.material_versions)
      .where(
        and(
          eq(s.material_versions.id, versionId),
          eq(s.material_versions.kind, kind),
          eq(s.material_versions.status, 'published')
        )
      )
      .get();

    if (!version) throw new StudyError('not_found', 'published learning version missing');

    return version;
  }

  function attemptRow(attemptId: QuizAttemptId, writable = false) {
    const row = db.orm
      .select()
      .from(s.material_quiz_attempts)
      .where(eq(s.material_quiz_attempts.id, attemptId))
      .get();

    if (!row) throw new StudyError('not_found', 'quiz attempt missing');

    if (writable && row.status !== 'in_progress') invalid('quiz attempt completed');

    return row;
  }

  function questions(versionId: MaterialVersionId) {
    return db.orm
      .select()
      .from(s.material_quiz_questions)
      .where(eq(s.material_quiz_questions.version_id, versionId))
      .orderBy(asc(s.material_quiz_questions.position))
      .all();
  }

  function attemptQuestions(attemptId: QuizAttemptId) {
    const attempt = attemptRow(attemptId);
    const selected = db.orm
      .select({
        question: s.material_quiz_questions,
        position: s.material_quiz_attempt_questions.position
      })
      .from(s.material_quiz_attempt_questions)
      .innerJoin(
        s.material_quiz_questions,
        eq(s.material_quiz_questions.id, s.material_quiz_attempt_questions.question_id)
      )
      .where(eq(s.material_quiz_attempt_questions.attempt_id, attemptId))
      .orderBy(asc(s.material_quiz_attempt_questions.position))
      .all();

    return selected.length
      ? selected.map(({ question, position }) => ({ ...question, position }))
      : questions(attempt.version_id);
  }

  function choices(questionId: QuizQuestionId) {
    return db.orm
      .select()
      .from(s.material_quiz_choices)
      .where(eq(s.material_quiz_choices.question_id, questionId))
      .orderBy(asc(s.material_quiz_choices.position))
      .all();
  }

  function choiceScore(
    question: typeof s.material_quiz_questions.$inferSelect,
    selected: readonly QuizChoiceId[]
  ) {
    if (
      !selected.length ||
      (question.kind === 'single_choice' && selected.length !== 1) ||
      new Set(selected).size !== selected.length
    )
      invalid('invalid choice cardinality');

    const options = choices(question.id);

    if (selected.some((id) => !options.some((c) => c.id === id)))
      invalid('choice does not belong to question');

    const correct = options.filter((c) => c.is_correct).map((c) => c.id);

    return correct.length === selected.length && correct.every((id) => selected.includes(id))
      ? 1
      : 0;
  }

  /** Loads the private canonical sequence for validation and completed results. */
  function orderingItems(questionId: QuizQuestionId) {
    return db.orm
      .select()
      .from(s.material_quiz_ordering_items)
      .where(eq(s.material_quiz_ordering_items.question_id, questionId))
      .orderBy(asc(s.material_quiz_ordering_items.position))
      .all();
  }

  /** Awards one point only for a complete, valid permutation in canonical order. */
  function orderingScore(questionId: QuizQuestionId, selected: readonly QuizOrderingItemId[]) {
    const correct = orderingItems(questionId);

    if (
      selected.length !== correct.length ||
      new Set(selected).size !== selected.length ||
      selected.some((id) => !correct.some((item) => item.id === id))
    )
      invalid('invalid ordering permutation');

    return correct.every((item, index) => item.id === selected[index]) ? 1 : 0;
  }

  /** Restores stable presentation and learner responses without leaking in-progress answers. */
  function attemptView(attemptId: QuizAttemptId) {
    const attempt = attemptRow(attemptId);
    const version = published(attempt.version_id, 'quiz');
    const responses = db.orm
      .select()
      .from(s.material_quiz_responses)
      .where(eq(s.material_quiz_responses.attempt_id, attemptId))
      .all();
    const selections = db.orm
      .select()
      .from(s.material_quiz_selections)
      .where(eq(s.material_quiz_selections.attempt_id, attemptId))
      .all();
    const snapshot = attemptQuestions(attempt.id);
    const questionById = new Map(snapshot.map((q) => [q.id, q]));
    const responseByQuestion = new Map(responses.map((r) => [r.question_id, r]));
    const selectedByQuestion = new Map<QuizQuestionId, QuizChoiceId[]>();

    for (const selection of selections) {
      const selected = selectedByQuestion.get(selection.question_id);

      if (selected) selected.push(selection.choice_id);
      else selectedByQuestion.set(selection.question_id, [selection.choice_id]);
    }

    const allChoices = db.orm
      .select({
        choice: s.material_quiz_choices
      })
      .from(s.material_quiz_choices)
      .innerJoin(
        s.material_quiz_questions,
        eq(s.material_quiz_questions.id, s.material_quiz_choices.question_id)
      )
      .where(eq(s.material_quiz_questions.version_id, attempt.version_id))
      .orderBy(asc(s.material_quiz_choices.position))
      .all();
    const choicesByQuestion = new Map<bigint, (typeof s.material_quiz_choices.$inferSelect)[]>();

    for (const { choice } of allChoices) {
      const options = choicesByQuestion.get(choice.question_id);

      if (options) options.push(choice);
      else choicesByQuestion.set(choice.question_id, [choice]);
    }

    const orderedChoices = db.orm
      .select()
      .from(s.material_quiz_attempt_choices)
      .where(eq(s.material_quiz_attempt_choices.attempt_id, attemptId))
      .all();
    const positionByChoice = new Map(
      orderedChoices.map((choice) => [choice.choice_id, choice.position])
    );

    for (const [questionId, options] of choicesByQuestion) {
      choicesByQuestion.set(
        questionId,
        options
          .map((choice) => ({
            ...choice,
            position: positionByChoice.get(choice.id) ?? choice.position
          }))
          .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
      );
    }

    const items: (typeof quizAttemptInProgressSchema.Type)['questions'] = snapshot.map((q) => {
      const response = responseByQuestion.get(q.id);
      const base = {
        id: q.id,
        position: q.position,
        prompt: q.prompt
      };

      if (q.kind === 'ordering') {
        const items = orderingItems(q.id);
        const presentation = db.orm
          .select()
          .from(s.material_quiz_attempt_ordering_items)
          .where(
            and(
              eq(s.material_quiz_attempt_ordering_items.attempt_id, attemptId),
              eq(s.material_quiz_attempt_ordering_items.question_id, q.id)
            )
          )
          .orderBy(asc(s.material_quiz_attempt_ordering_items.position))
          .all();

        return {
          ...base,
          kind: q.kind,
          items: presentation.map((entry) => {
            const item = requireRow(items.find((item) => item.id === entry.item_id));

            return { id: item.id, text: item.text };
          }),
          answer: response
            ? Schema.decodeUnknownSync(orderingAnswerJsonSchema)(response.answer)
            : null
        };
      }

      if (isTextQuestionKind(q.kind))
        return {
          ...base,
          kind: q.kind,
          answer: response
            ? {
                type: 'open' as const,
                answer: response.answer!
              }
            : null
        };

      return {
        ...base,
        kind: q.kind,
        answer: response
          ? {
              type: 'choice' as const,
              choiceIds: selectedByQuestion.get(q.id) ?? []
            }
          : null,
        choices: (choicesByQuestion.get(q.id) ?? []).map((c) => ({
          id: c.id,
          position: c.position,
          text: c.text
        }))
      };
    });
    const practice = db.orm
      .select({ id: s.learning_practice_slots.id })
      .from(s.learning_practice_slots)
      .where(eq(s.learning_practice_slots.attempt_id, attempt.id))
      .get();
    const base = {
      ...(practice ? { practiceSlotId: practice.id } : {}),
      id: attempt.id,
      versionId: attempt.version_id,
      materialId: version.material_id,
      startedAt: attempt.started_at
    };

    if (attempt.status === 'in_progress')
      return {
        ...base,
        status: 'in_progress' as const,
        questions: items
      };

    const openAnswers = db.orm
      .select({
        questionId: s.material_quiz_open_answers.question_id,
        referenceAnswer: s.material_quiz_open_answers.reference_answer
      })
      .from(s.material_quiz_open_answers)
      .innerJoin(
        s.material_quiz_questions,
        eq(s.material_quiz_questions.id, s.material_quiz_open_answers.question_id)
      )
      .where(eq(s.material_quiz_questions.version_id, attempt.version_id))
      .all();
    const referenceByQuestion = new Map(openAnswers.map((a) => [a.questionId, a.referenceAnswer]));
    const results = items.map((item) => {
      const response = responseByQuestion.get(item.id);
      const question = requireRow(questionById.get(item.id));
      const result = {
        explanation: question.explanation,
        score: response?.score ?? null,
        feedback: response?.feedback ?? null,
        grading: responseGrading(response)
      };

      if (item.kind === 'ordering')
        return {
          ...item,
          ...result,
          correctItemIds: orderingItems(item.id).map((item) => item.id)
        };

      if (!('choices' in item))
        return {
          ...item,
          ...result,
          referenceAnswer: referenceByQuestion.get(item.id) ?? null
        };

      return {
        ...item,
        ...result,
        choices: (choicesByQuestion.get(item.id) ?? []).map((c) => ({
          id: c.id,
          position: c.position,
          text: c.text,
          isCorrect: c.is_correct
        }))
      };
    });
    const graded = results.filter((q) => q.score !== null);

    return {
      ...base,
      status: 'completed' as const,
      finishedAt: attempt.finished_at!,
      questions: results,
      scoring: {
        complete: graded.length === results.length,
        gradedCount: graded.length,
        questionCount: results.length,
        earned: graded.reduce((sum, q) => sum + q.score!, 0),
        score:
          graded.length === results.length && results.length > 0
            ? graded.reduce((sum, q) => sum + q.score!, 0) / results.length
            : null
      }
    };
  }

  return {
    published,
    attemptRow,
    questions,
    attemptQuestions,
    choices,
    choiceScore,
    orderingScore,
    attemptView
  };
}

/** Distinguishes unanswered responses from pending and settled grades. */
function responseGrading(response: typeof s.material_quiz_responses.$inferSelect | undefined) {
  if (!response) return 'unanswered' as const;

  return response.score === null ? ('ungraded' as const) : ('graded' as const);
}
