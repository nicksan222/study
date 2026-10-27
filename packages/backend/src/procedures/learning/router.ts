import { router } from '#backend/runtime/trpc';

import { run as answerQuestion } from './answer-question.ts';
import { run as dueCards } from './due-cards.ts';
import { run as finishQuiz } from './finish-quiz.ts';
import { run as getAttempt } from './get-attempt.ts';
import { run as getCard } from './get-card.ts';
import { run as gradeResponse } from './grade-response.ts';
import { run as listAttempts } from './list-attempts.ts';
import { run as reviewCard } from './review-card.ts';
import { run as reviewHistory } from './review-history.ts';
import { run as startQuiz } from './start-quiz.ts';

export const learningRouter = router({
  startQuiz,
  getAttempt,
  listAttempts,
  answerQuestion,
  gradeResponse,
  finishQuiz,
  dueCards,
  getCard,
  reviewCard,
  reviewHistory
});
