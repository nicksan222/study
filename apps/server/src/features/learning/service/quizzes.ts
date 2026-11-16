/** @file Owns quizzes within this feature. */

import type {
  answerQuestionInputSchema,
  attemptInputSchema,
  attemptsInputSchema,
  gradeResponseInputSchema,
  publishGradeInputSchema,
  startQuizInputSchema
} from '@study/contracts';
import { CryptoHasher } from 'bun';
import { Effect } from 'effect';

import { AttemptStore, GradingSnapshotStore } from '#server/features/learning/store/index';
import {
  publicationTransaction,
  transaction,
  useStore
} from '#server/platform/definitions/define-store';

export function* learningQuizOperations() {
  const readGradingSnapshotStore = yield* useStore(GradingSnapshotStore);

  const attempts = yield* useStore(AttemptStore);

  return {
    gradingSnapshot: readGradingSnapshotStore.gradingSnapshot,
    attempt: attempts.attempt,
    findAttempt: attempts.findAttempt,
    answerQuestion: (input: typeof answerQuestionInputSchema.Type) =>
      transaction((tx) => {
        const result = tx.store(AttemptStore).answerQuestion(input);

        if (input.answer.type === 'open') {
          const eventId = crypto.randomUUID();

          tx.emit({
            type: 'QuizAnswerSubmitted',
            eventId,
            correlationId: eventId,
            causationId: null,
            inputVersion: 1,
            depth: 0,
            attemptId: input.attemptId,
            questionId: input.questionId,
            answerHash: new CryptoHasher('sha256')
              .update(JSON.stringify([input.answer.answer, eventId]))
              .digest('hex')
          });
        }

        return result;
      }),
    finishQuiz: (input: typeof attemptInputSchema.Type) =>
      transaction((tx) => tx.store(AttemptStore).finishQuiz(input)),
    gradeResponse: (input: typeof gradeResponseInputSchema.Type) =>
      transaction((tx) => tx.store(AttemptStore).gradeResponse(input)),
    publishGrade: (input: typeof publishGradeInputSchema.Type) =>
      publicationTransaction((tx) => {
        return tx.store(AttemptStore).publishGrade(input);
      }),
    startQuiz: (input: typeof startQuizInputSchema.Type) =>
      transaction((tx) => tx.store(AttemptStore).startQuiz(input)),
    attempts: Effect.fnUntraced(function* (input: typeof attemptsInputSchema.Type) {
      const items = yield* attempts.attempts(input);

      const last = items.at(-1);

      const more =
        last && items.length === input.limit
          ? yield* attempts.attempts({ ...input, cursor: last.attempt.id, limit: 1 })
          : [];

      return { items, nextCursor: more.length && last ? last.attempt.id : null };
    })
  };
}
