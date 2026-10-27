import { router } from '#backend/runtime/trpc';

import { run as addToFlashcards } from './add-to-flashcards.ts';
import { run as answerQuestion } from './answer-question.ts';
import { run as deletePractice } from './delete-practice.ts';
import { run as dueBy } from './due-by.ts';
import { run as dueCards } from './due-cards.ts';
import { run as dueCount } from './due-count.ts';
import { run as practice } from './practice.ts';
import { run as practices } from './practices.ts';
import { run as projectPractice } from './project-practice.ts';
import { run as reviewTimes } from './review-times.ts';
import { run as review } from './review.ts';

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
