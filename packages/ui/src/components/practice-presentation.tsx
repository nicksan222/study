import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

export type PracticeMessageKey =
  | 'CardBack'
  | 'LibraryRefresh'
  | 'LoadingStudy'
  | 'PracticeActionError'
  | 'PracticeAllAnswered'
  | 'PracticeAnswerPlaceholder'
  | 'PracticeAnswerSaved'
  | 'PracticeArchiveExplanation'
  | 'PracticeAttemptCompleted'
  | 'PracticeFalse'
  | 'PracticeFeedback'
  | 'PracticeFillBlank'
  | 'PracticeFillBlankHint'
  | 'PracticeFillBlankPlaceholder'
  | 'PracticeFinishHint'
  | 'PracticeFinishQuiz'
  | 'PracticeGradingPending'
  | 'PracticeLastQuestion'
  | 'PracticeMatching'
  | 'PracticeMatchingChoose'
  | 'PracticeMatchingHint'
  | 'PracticeMoveDown'
  | 'PracticeMoveUp'
  | 'PracticeMultipleHint'
  | 'PracticeNextQuestion'
  | 'PracticeNothingDue'
  | 'PracticeNothingDueHint'
  | 'PracticeOpenHint'
  | 'PracticeOrdering'
  | 'PracticeOrderingHint'
  | 'PracticeOverallResults'
  | 'PracticeProgress'
  | 'PracticeQuestionOutline'
  | 'PracticeQuizIntro'
  | 'PracticeQuizOverview'
  | 'PracticeQuizSaveHint'
  | 'PracticeRateHint'
  | 'PracticeRecallHint'
  | 'PracticeReplayFlashcards'
  | 'PracticeResults'
  | 'PracticeResultsReady'
  | 'PracticeReviewAgain'
  | 'PracticeReviewComplete'
  | 'PracticeReviewProgress'
  | 'PracticeReviewSaved'
  | 'PracticeSaving'
  | 'PracticeScore'
  | 'PracticeScorePending'
  | 'PracticeSingleHint'
  | 'PracticeSpaceKey'
  | 'PracticeStartQuiz'
  | 'PracticeStarting'
  | 'PracticeTrue'
  | 'PracticeTrueFalse'
  | 'PracticeTrueFalseHint'
  | 'PracticeTryAgain'
  | 'PracticeUnanswered'
  | 'PracticeUngraded'
  | 'QuestionChoice'
  | 'QuestionOpen'
  | 'QuizBackToReview'
  | 'QuizEditAnswer'
  | 'QuizNoMatchingQuestions'
  | 'QuizPrevious'
  | 'QuizReviewAnswers'
  | 'RateAgain'
  | 'RateEasy'
  | 'RateGood'
  | 'RateHard'
  | 'ReaderCorrectAnswer'
  | 'RightAnswer'
  | 'ShowAnswer'
  | 'StudyLoadError'
  | 'SubmitAnswer'
  | 'VerdictCorrect'
  | 'VerdictIncorrect'
  | 'VerdictPartly'
  | 'YourAnswer';

export interface PracticePresentation {
  t: (key: PracticeMessageKey) => string;
  questionNumber: (index: number) => string;
  reviewProgress: (completed: number, total: number) => string;
  questionCount: (count: number) => string;
  percentage: (score: number) => string;
}

const Context = createContext<PracticePresentation | null>(null);

/** Supplies localized display copy without binding presentation to an application runtime. */
export function PracticePresentationProvider({
  value,
  children
}: {
  value: PracticePresentation;
  children: ReactNode;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePracticePresentation() {
  const value = useContext(Context);

  if (!value) throw new Error('PracticePresentationProvider is required');

  return value;
}
