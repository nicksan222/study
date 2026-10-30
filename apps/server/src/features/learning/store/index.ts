import { StudyError } from '@study/contracts/errors';
import { quizAnswerSubmittedSchema } from '@study/contracts/events';
import { quizAttemptIdSchema } from '@study/contracts/ids';
import {
  answerQuestionInputSchema,
  attemptSummarySchema,
  attemptsInputSchema,
  cardInputSchema,
  cardSchema,
  dueCardSchema,
  dueCardsInputSchema,
  gradeResponseInputSchema,
  gradingSnapshotSchema,
  publishGradeInputSchema,
  reviewCardInputSchema,
  reviewedCardSchema,
  reviewHistoryInputSchema,
  reviewHistoryItemSchema,
  startQuizInputSchema,
  attemptInputSchema
} from '@study/contracts/learning/rpc';
import {
  quizAttemptCompletedSchema,
  quizAttemptInProgressSchema,
  quizAttemptSchema
} from '@study/contracts/learning/schemas';
import { reviewSettingsSchema } from '@study/contracts/settings/schemas';
import { and, eq, sql } from '@study/db';
import * as s from '@study/db/schema';
import { Option, Schema } from 'effect';

import { makeAnswerQuestion } from '#server/features/learning/store/answer-question';
import { makeCards } from '#server/features/learning/store/cards';
import { makeDueCards } from '#server/features/learning/store/due-cards';
import { makeFinishQuiz } from '#server/features/learning/store/finish-quiz';
import { makeGradeResponse } from '#server/features/learning/store/grade-response';
import { makeGradingSnapshot } from '#server/features/learning/store/grading-snapshot';
import { makeListAttempts } from '#server/features/learning/store/list-attempts';
import { makeQuiz } from '#server/features/learning/store/quiz';
import { makeReviewHistory } from '#server/features/learning/store/review-history';
import { makeReviewMaterialCard } from '#server/features/learning/store/review-material-card';
import { makeStartQuiz } from '#server/features/learning/store/start-quiz';
import { defineStore, storeMutation, storeQuery } from '#server/platform/definitions/define-store';
import { unixSeconds } from '#server/platform/time/index';
import { decodeEvent } from '#server/platform/workflows/events';

const optional = <T>(f: () => T) => {
  try {
    return Option.some(f());
  } catch (e) {
    if (e instanceof StudyError && e.kind === 'not_found') return Option.none<T>();

    throw e;
  }
};

export const AttemptStore = defineStore({
  name: 'study/LearningAttemptStore',
  entity: { singular: 'attempt', plural: 'attempts' },
  make: (resources) => {
    const { db } = resources;
    const { attemptRow, attemptView } = makeQuiz(resources);
    const { answerQuestion } = makeAnswerQuestion(resources);
    const { finishQuiz } = makeFinishQuiz(resources);
    const { gradeResponse } = makeGradeResponse(resources);
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
          input: answerQuestionInputSchema,
          output: quizAttemptInProgressSchema,
          run: (input) => answerQuestion(input)
        }),
        finishQuiz: storeMutation({
          input: attemptInputSchema,
          output: quizAttemptCompletedSchema,
          run: finishQuiz
        }),
        gradeResponse: storeMutation({
          input: gradeResponseInputSchema,
          output: quizAttemptInProgressSchema,
          run: gradeResponse
        }),
        startQuiz: storeMutation({
          input: startQuizInputSchema,
          output: quizAttemptInProgressSchema,
          run: startQuiz
        }),
        publishGrade: storeMutation({
          input: publishGradeInputSchema,
          output: quizAttemptInProgressSchema,
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
            attemptRow(input.attemptId, true);
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
              return attemptView(input.attemptId) as typeof quizAttemptInProgressSchema.Type;

            return gradeResponse(input);
          }
        })
      }
    };
  }
});

export const GradingSnapshotStore = defineStore({
  name: 'study/LearningGradingSnapshotStore',
  entity: { singular: 'gradingSnapshot', plural: 'gradingSnapshots' },
  make: (resources) => {
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
});

export const CardStore = defineStore({
  name: 'study/LearningCardStore',
  entity: { singular: 'card', plural: 'cards' },
  make: (resources) => {
    const { db, clock } = resources;
    const { cardSnapshot } = makeCards(resources);
    const { dueCards } = makeDueCards(resources);
    const { reviewMaterialCard } = makeReviewMaterialCard(resources);
    const card = (input: typeof cardInputSchema.Type) => ({
      snapshot: cardSnapshot(input.versionId, input.cardId),
      schedule:
        db.orm
          .select()
          .from(s.material_card_schedules)
          .where(eq(s.material_card_schedules.card_id, input.cardId))
          .get() ?? null
    });

    return {
      queries: {
        card: storeQuery({
          role: 'required',
          input: cardInputSchema,
          output: cardSchema,
          run: card
        }),
        findCard: storeQuery({
          role: 'optional',
          input: cardInputSchema,
          output: Schema.Option(cardSchema),
          run: (input) => optional(() => card(input))
        }),
        cards: storeQuery({
          role: 'collection',
          input: Schema.Struct({
            ...dueCardsInputSchema.fields,
            ...reviewSettingsSchema.fields
          }),
          output: Schema.Array(dueCardSchema),
          run: (input) => dueCards(input).items
        })
      },
      mutations: {
        reviewCard: storeMutation({
          input: reviewCardInputSchema,
          output: reviewedCardSchema,
          run: (input) =>
            reviewMaterialCard(input.versionId, input.cardId, input.rating, unixSeconds(clock))
        })
      }
    };
  }
});

export const ReviewStore = defineStore({
  name: 'study/LearningReviewStore',
  entity: { singular: 'review', plural: 'reviews' },
  make: (resources) => {
    const { reviewHistory } = makeReviewHistory(resources);

    return {
      queries: {
        reviews: storeQuery({
          role: 'collection',
          input: reviewHistoryInputSchema,
          output: Schema.Array(reviewHistoryItemSchema),
          run: (input) => reviewHistory(input).items
        })
      },
      mutations: {}
    };
  }
});
