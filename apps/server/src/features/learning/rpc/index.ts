import type { StudyError } from '@study/contracts/errors';
import { LearningRpc } from '@study/contracts/learning/rpc';
import { Effect } from 'effect';

import { Learning } from '#server/features/learning/service/index';

const failure = (error: StudyError) => ({
  kind: error.kind,
  message: error.message,
  retryAfterMs: error.retryAfterMs
});

export const LearningRpcLive = LearningRpc.toLayer(
  Effect.gen(function* () {
    const learning = yield* Learning;

    return {
      'learning.practice': (input) => learning.practice(input).pipe(Effect.mapError(failure)),
      'learning.startPractice': (input) =>
        learning.startPractice(input).pipe(Effect.mapError(failure)),
      'learning.stopPractice': (input) =>
        learning.stopPractice(input).pipe(Effect.mapError(failure)),
      'learning.answerPracticeQuestion': (input) =>
        learning.answerPracticeQuestion(input).pipe(Effect.mapError(failure)),
      'learning.retryPracticeQuestion': (input) =>
        learning.retryPracticeQuestion(input).pipe(Effect.mapError(failure)),
      'learning.attempt': ({ attemptId }) =>
        learning.attempt(attemptId).pipe(Effect.mapError(failure)),
      'learning.findAttempt': ({ attemptId }) =>
        learning.findAttempt(attemptId).pipe(Effect.mapError(failure)),
      'learning.card': (input) => learning.card(input).pipe(Effect.mapError(failure)),
      'learning.findCard': (input) => learning.findCard(input).pipe(Effect.mapError(failure)),
      'learning.answerQuestion': (input) =>
        learning.answerQuestion(input).pipe(Effect.mapError(failure)),
      'learning.finishQuiz': (input) => learning.finishQuiz(input).pipe(Effect.mapError(failure)),
      'learning.gradeResponse': (input) =>
        learning.gradeResponse(input).pipe(Effect.mapError(failure)),
      'learning.startQuiz': (input) => learning.startQuiz(input).pipe(Effect.mapError(failure)),
      'learning.reviewCard': (input) => learning.reviewCard(input).pipe(Effect.mapError(failure)),
      'learning.dueCards': (input) => learning.dueCards(input).pipe(Effect.mapError(failure)),
      'learning.attempts': (input) => learning.attempts(input).pipe(Effect.mapError(failure)),
      'learning.reviewHistory': (input) =>
        learning.reviewHistory(input).pipe(Effect.mapError(failure))
    };
  })
);
