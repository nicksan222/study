import { router } from '#backend/runtime/trpc';

import { run as addToFlashcards } from './add-to-flashcards/index.ts';
import { run as answerQuestion } from './answer-question/index.ts';
import { run as deletePractice } from './delete-practice/index.ts';
import { run as dueBy } from './due-by/index.ts';
import { run as dueCards } from './due-cards/index.ts';
import { run as dueCount } from './due-count/index.ts';
import { run as practice } from './practice/index.ts';
import { run as practices } from './practices/index.ts';
import { run as projectPractice } from './project-practice/index.ts';
import { run as reviewTimes } from './review-times/index.ts';
import { run as review } from './review/index.ts';

export const practiceRouter = router({
  reviewTimes,
  dueBy,
  dueCards,
  dueCount,
  review,
  projectPractice,
  practices,
  practice,
  answerQuestion,
  addToFlashcards,
  deletePractice
});
