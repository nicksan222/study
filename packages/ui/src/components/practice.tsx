import type { ReactNode } from 'react';

import { semanticPart } from './semantic-part';

export const Practice = {
  OutlineItems,
  SourceInputs: semanticPart('div', 'study-practice-source-inputs'),
  Stage: semanticPart('div', 'study-practice-stage'),
  StageBody: semanticPart('div', 'study-practice-stage-body'),
  StageFooter: semanticPart('div', 'study-practice-stage-footer'),
  FooterContext: semanticPart('div', 'study-practice-footer-context'),
  ReviewList: semanticPart('ol', 'study-practice-review-list'),
  ReviewItem: semanticPart('li', 'study-practice-review-item'),
  Outline: semanticPart('section', 'study-practice-outline'),
  OutlineList: semanticPart('ol', 'study-practice-outline-list'),
  OutlineKind: semanticPart('span', 'study-practice-outline-kind'),
  RevealAction: semanticPart('div', 'study-practice-reveal-action'),
  Prompt: semanticPart('h2', 'study-practice-prompt'),
  Active: semanticPart('div', 'study-practice-active'),
  ProgressHeading: semanticPart('div', 'study-practice-progress-heading'),
  Progress: semanticPart('progress', 'study-practice-progress'),
  Flashcard: semanticPart('div', 'study-practice-flashcard'),
  CardAnswer: semanticPart('div', 'study-practice-card-answer'),
  MutedText: semanticPart('span', 'study-practice-muted'),
  RatingArea: semanticPart('div', 'study-practice-rating-area'),
  Muted: semanticPart('p', 'study-practice-muted'),
  Ratings: semanticPart('div', 'study-practice-ratings'),
  Complete: semanticPart('div', 'study-practice-complete'),
  Library: semanticPart('div', 'study-practice-library'),
  LibraryHeading: semanticPart('div', 'study-practice-library-heading'),
  Empty: semanticPart('div', 'study-practice-empty'),
  LibraryList: semanticPart('div', 'study-practice-library-list'),
  LibraryIconText: semanticPart('span', 'study-practice-library-icon'),
  LibraryLabelText: semanticPart('span', 'study-practice-library-label'),
  LibraryAgeText: semanticPart('span', 'study-practice-library-age'),
  Content: semanticPart('div', 'study-practice-content'),
  Question: semanticPart('form', 'study-practice-question'),
  Answers: semanticPart('fieldset', 'study-practice-answers'),
  Choice: semanticPart('label', 'study-practice-choice'),
  ChoiceLetterText: semanticPart('span', 'study-practice-choice-letter'),
  Results: semanticPart('section', 'study-practice-results'),
  ResultsHeading: semanticPart('div', 'study-practice-results-heading'),
  Score: semanticPart('p', 'study-practice-score'),
  ResultList: semanticPart('div', 'study-practice-result-list'),
  Result: semanticPart('details', 'study-practice-result'),
  VerdictText: semanticPart('span', 'study-practice-verdict'),
  ResultLabelText: semanticPart('span', 'study-practice-result-label'),
  ResultBody: semanticPart('div', 'study-practice-result-body'),
  Intro: semanticPart('div', 'study-practice-intro'),
  SetupActions: semanticPart('div', 'study-practice-setup-actions')
};

function OutlineItems({
  items
}: {
  items: readonly { key: string; prompt: string; detail: ReactNode }[];
}) {
  return (
    <Practice.OutlineList>
      {items.map((item, index) => (
        <li key={item.key}>
          <span aria-hidden="true">{index + 1}</span>
          <p>{item.prompt}</p>
          <Practice.OutlineKind>{item.detail}</Practice.OutlineKind>
        </li>
      ))}
    </Practice.OutlineList>
  );
}
