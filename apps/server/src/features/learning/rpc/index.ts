import { LearningRpc } from '@study/contracts/learning/rpc';
import { Effect } from 'effect';

import { Learning } from '#server/features/learning/service/index';
import { defineRpc } from '#server/platform/definitions/define-rpc';

export const LearningRpcLive = defineRpc(
  LearningRpc,
  Effect.gen(function* () {
    const learning = yield* Learning;

    return {
      'learning.practice': (input) => learning.practice(input),
      'learning.startPractice': (input) => learning.startPractice(input),
      'learning.stopPractice': (input) => learning.stopPractice(input),
      'learning.answerPracticeQuestion': (input) => learning.answerPracticeQuestion(input),
      'learning.retryPracticeQuestion': (input) => learning.retryPracticeQuestion(input),
      'learning.attempt': ({ attemptId }) => learning.attempt(attemptId),
      'learning.findAttempt': ({ attemptId }) => learning.findAttempt(attemptId),
      'learning.card': (input) => learning.card(input),
      'learning.findCard': (input) => learning.findCard(input),
      'learning.answerQuestion': (input) => learning.answerQuestion(input),
      'learning.finishQuiz': (input) => learning.finishQuiz(input),
      'learning.gradeResponse': (input) => learning.gradeResponse(input),
      'learning.startQuiz': (input) => learning.startQuiz(input),
      'learning.reviewCard': (input) => learning.reviewCard(input),
      'learning.dueCards': (input) => learning.dueCards(input),
      'learning.attempts': (input) => learning.attempts(input),
      'learning.reviewHistory': (input) => learning.reviewHistory(input)
    };
  })
);
