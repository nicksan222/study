import { router } from '#server/runtime/trpc';

import { run as answerQuestion } from './answer-question/index.ts';
import { run as dueCards } from './due-cards/index.ts';
import { run as finishQuiz } from './finish-quiz/index.ts';
import { run as getAttempt } from './get-attempt/index.ts';
import { run as getCard } from './get-card/index.ts';
import { run as gradeResponse } from './grade-response/index.ts';
import { run as listAttempts } from './list-attempts/index.ts';
import { run as reviewCard } from './review-card/index.ts';
import { run as reviewHistory } from './review-history/index.ts';
import { run as startQuiz } from './start-quiz/index.ts';

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
