import type { artifacts, practice_questions } from '@study/db/schema';

import type { artifact, cardRow } from '#backend/procedures/material/operations/artifact';
import type { question, practiceScore } from '#backend/procedures/practice/operations/practice';
import type { listPractices } from '#backend/procedures/practice/operations/practices';
import type { practice } from '#backend/procedures/practice/operations/project-practice';
import type { cardReviews } from '#backend/procedures/practice/operations/review';

export type ArtifactKind = (typeof artifacts.$inferSelect)['kind'];

export interface Flashcard {
  front: string;
  back: string;
  cites: number[];
}

export type ArtifactBody =
  | { type: 'flashcards'; cards: Flashcard[] }
  | { type: 'diagram'; mermaid: string };

export type Artifact = NonNullable<ReturnType<typeof artifact>>;

export type Card = ReturnType<typeof cardRow>;

export type Review = ReturnType<typeof cardReviews>[number];

export type QuestionKind = (typeof practice_questions.$inferSelect)['kind'];

export type Verdict = NonNullable<(typeof practice_questions.$inferSelect)['verdict']>;

export type PracticeBody =
  | {
      type: 'choice';
      question: string;
      choices: string[];
      answer: number;
      explanation: string;
      cites: number[];
    }
  | { type: 'open'; question: string; reference: string; cites: number[] };

export type PracticeAnswer = { type: 'choice'; choice: number } | { type: 'open'; answer: string };

export type Practice = NonNullable<ReturnType<typeof practice>>;

export type PracticeScore = ReturnType<typeof practiceScore>;

export type PracticeSummary = ReturnType<typeof listPractices>[number];

export type PracticeQuestion = NonNullable<ReturnType<typeof question>>;
