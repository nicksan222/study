/** @file Builds learning attempts queries and mutations with bound store resources. */

import {
  StudyError,
  answerQuestionInputSchema,
  attemptInputSchema,
  attemptSummarySchema,
  attemptsInputSchema,
  gradeResponseInputSchema,
  publishGradeInputSchema,
  quizAttemptCompletedSchema,
  quizAttemptIdSchema,
  quizAttemptInProgressSchema,
  quizAttemptSchema,
  startQuizInputSchema
} from '@study/contracts';
import * as s from '@study/db';
import { and, eq, sql } from '@study/db';
import { Option, Schema } from 'effect';

import { makeAnswerQuestion } from '#server/features/learning/store/answer-question';
import { makeFinishQuiz } from '#server/features/learning/store/finish-quiz';
import { makeGradeResponse } from '#server/features/learning/store/grade-response';
import { makeGradingSnapshot } from '#server/features/learning/store/grading-snapshot';
import { makeListAttempts } from '#server/features/learning/store/list-attempts';
import { makeQuiz } from '#server/features/learning/store/quiz';
import { makeStartQuiz } from '#server/features/learning/store/start-quiz';
import type { StoreResources } from '#server/platform/definitions/define-store';
import { storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import { decodeEvent } from '#server/platform/workflows/events';

export const optional = <T>(f: () => T) => {
  try {
    return Option.some(f());
  } catch (e) {
    if (e instanceof StudyError && e.kind === 'not_found') return Option.none<T>();

    throw e;
  }
};

export function makeAttemptStore(resources: StoreResources) {
  const { db } = resources;
  const { attemptRow, attemptView } = makeQuiz(resources);
  const { answerQuestion } = makeAnswerQuestion(resources);
  const { finishQuiz } = makeFinishQuiz(resources);
  const { gradeResponse, settleGrade } = makeGradeResponse(resources);
  const { startQuiz } = makeStartQuiz(resources);
  const { gradingSnapshot } = makeGradingSnapshot(resources);
  const { listAttempts } = makeListAttempts(resources);

  return {
    queries: {
      attempt: storeQuery({
        role: 'required',
        input: quizAttemptIdSchema,
        output: quizAttemptSchema,
        run: attemptView
      }),
      findAttempt: storeQuery({
        role: 'optional',
        input: quizAttemptIdSchema,
        output: Schema.Option(quizAttemptSchema),
        run: (id) => optional(() => attemptView(id))
      }),
      attempts: storeQuery({
        role: 'collection',
        input: attemptsInputSchema,
        output: Schema.Array(attemptSummarySchema),
        run: (input) => listAttempts(input).items
      })
    },
    mutations: {
      answerQuestion: storeMutation({
        changes: ['learning'],
        input: answerQuestionInputSchema,
        output: quizAttemptInProgressSchema,
        run: (input) => answerQuestion(input)
      }),
      finishQuiz: storeMutation({
        changes: ['learning'],
        input: attemptInputSchema,
        output: quizAttemptCompletedSchema,
        run: finishQuiz
      }),
      gradeResponse: storeMutation({
        changes: ['learning'],
        input: gradeResponseInputSchema,
        output: quizAttemptInProgressSchema,
        run: gradeResponse
      }),
      startQuiz: storeMutation({
        changes: ['learning'],
        input: startQuizInputSchema,
        output: quizAttemptInProgressSchema,
        run: startQuiz
      }),
      publishGrade: storeMutation({
        changes: ['learning'],
        input: publishGradeInputSchema,
        output: quizAttemptSchema,
        run: (input) => {
          const rows = db.orm
            .select({ payload: s.workflowEvents.payload })
            .from(s.workflowEvents)
            .where(
              and(
                eq(s.workflowEvents.type, 'QuizAnswerSubmitted'),
                sql`json_extract(${s.workflowEvents.payload}, '$.attemptId') = ${input.attemptId.toString()}`,
                sql`json_extract(${s.workflowEvents.payload}, '$.questionId') = ${input.questionId.toString()}`
              )
            )
            .orderBy(sql`rowid DESC`)
            .limit(1)
            .all();
          const event = rows[0] ? decodeEvent(rows[0].payload) : null;

          if (
            !event ||
            event.type !== 'QuizAnswerSubmitted' ||
            event.answerHash !== input.expectedAnswerHash
          )
            throw new StudyError('invalid_input', 'stale quiz grade');

          gradingSnapshot(event, true);
          attemptRow(input.attemptId);
          const response = db.orm
            .select()
            .from(s.material_quiz_responses)
            .where(
              and(
                eq(s.material_quiz_responses.attempt_id, input.attemptId),
                eq(s.material_quiz_responses.question_id, input.questionId)
              )
            )
            .get();

          if (response?.score !== null && response?.score !== undefined)
            return attemptView(input.attemptId);

          return settleGrade(input);
        }
      })
    }
  };
}
