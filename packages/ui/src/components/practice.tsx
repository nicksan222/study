import { ArrowUp, ArrowDown, Check, X, CircleMinus, Clock3, Minus } from 'lucide-react';
import { useId } from 'react';
import type { ReactNode, ComponentProps } from 'react';

import { Button } from './button';
import { semanticPart } from './semantic-part';

export const Practice = {
  Ordering,
  OutlineItems,
  ChoiceOption,
  AnswerComparison,
  ResultVerdict,
  ResultNote: semanticPart('div', 'study-practice-result-note'),
  OpenAnswers: semanticPart('div', 'study-practice-open-answers'),
  Preview: semanticPart('section', 'study-practice-preview'),
  PreviewItems: semanticPart('ol', 'study-practice-preview-items'),
  PreviewItem: semanticPart('li', 'study-practice-preview-item'),
  Explanation: semanticPart('div', 'study-practice-explanation'),
  Customize: semanticPart('details', 'study-generation-customize'),
  CustomizeSummary: semanticPart('summary', 'study-generation-customize-summary'),
  CustomizeBody: semanticPart('div', 'study-generation-customize-body'),
  DocumentChoices: semanticPart('div', 'study-generation-document-choices'),
  GenerationLayout: semanticPart('div', 'study-generation-layout'),
  GenerationBrief: semanticPart('div', 'study-generation-brief'),
  GenerationDocuments: semanticPart('div', 'study-generation-documents'),
  GenerationStatus: semanticPart('div', 'study-generation-status'),
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
  ShortAnswer: semanticPart('div', 'study-practice-short-answer'),
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

function ChoiceOption({
  text,
  number,
  selected,
  status,
  tone,
  ...input
}: Omit<ComponentProps<'input'>, 'children' | 'checked'> & {
  text: string;
  number: number;
  selected: boolean;
  status?: ReactNode;
  tone?: 'correct' | 'incorrect';
}) {
  return (
    <Practice.Choice data-selected={selected} data-tone={tone}>
      <input {...input} checked={selected} />
      <Practice.ChoiceLetterText aria-hidden="true">{number}</Practice.ChoiceLetterText>
      <span>{text}</span>
      {status && <Practice.MutedText>{status}</Practice.MutedText>}
      {selected && (tone === 'incorrect' ? <X aria-hidden="true" /> : <Check aria-hidden="true" />)}
    </Practice.Choice>
  );
}

/** Displays a stable keyed sequence with optional keyboard-accessible movement controls. */
function Ordering({
  items,
  move,
  moveUpLabel,
  moveDownLabel,
  disabled,
  label
}: {
  items: readonly { key: string; text: string }[];
  move?: (index: number, direction: -1 | 1) => void;
  moveUpLabel?: string;
  moveDownLabel?: string;
  disabled?: boolean;
  label: string;
}) {
  const id = useId();

  return (
    <ol
      className="study-practice-ordering"
      aria-label={label}
      aria-live={move ? 'polite' : undefined}
    >
      {items.map((item, index) => (
        <li key={item.key}>
          <span className="study-practice-ordering-number" aria-hidden="true">
            {index + 1}
          </span>
          <span id={`${id}-${item.key}`}>{item.text}</span>
          {move && (
            <div className="study-practice-ordering-actions">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={moveUpLabel}
                aria-describedby={`${id}-${item.key}`}
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={moveDownLabel}
                aria-describedby={`${id}-${item.key}`}
                disabled={disabled || index === items.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown aria-hidden="true" />
              </Button>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Presents content-sized read-only answer text with an explicit accessible label. */
function AnswerComparison({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId();

  return (
    <div className="study-practice-answer-comparison" role="group" aria-labelledby={labelId}>
      <h3 id={labelId}>{label}</h3>
      <p>{children}</p>
    </div>
  );
}

/** Pairs a semantic verdict tone with an icon and caller-supplied localized text. */
function ResultVerdict({
  tone,
  children
}: {
  tone: 'correct' | 'incorrect' | 'partial' | 'pending' | 'unanswered';
  children: ReactNode;
}) {
  const Icon = {
    correct: Check,
    incorrect: X,
    partial: CircleMinus,
    pending: Clock3,
    unanswered: Minus
  }[tone];

  return (
    <span className="study-practice-result-verdict" data-tone={tone}>
      <Icon aria-hidden="true" />
      {children}
    </span>
  );
}
