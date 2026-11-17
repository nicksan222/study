import { useState, useId } from 'react';
import type { ReactNode } from 'react';

import { NextButton, PreviousButton } from '#ui/components/navigation-button.tsx';
import { Practice } from '#ui/components/practice.tsx';
import { SelectionSurface as Surface } from '#ui/components/selection.tsx';

import { MatchingReviewView as MatchingReview } from './matching-review-view';
import { OrderingResultView as OrderingResult } from './ordering-result-view';
import { usePracticePresentation } from './practice-presentation';
import type { PracticeResultsModel } from './practice-question-model';
import { QuizSessionView } from './quiz-session-view';

type Completed = PracticeResultsModel;

type Question = Completed['questions'][number];

/** Reviews persisted completed answers on the page or in history, preserving question navigation and pending scores. */
export function QuizResultsView({
  attempt,
  presentation = 'page',
  retry
}: {
  attempt: Completed;
  presentation?: 'page' | 'preview';
  retry?: ReactNode;
}) {
  const { t, questionCount } = usePracticePresentation();
  const [index, setIndex] = useState(0);
  const question = attempt.questions[index];
  const headingId = useId();

  const body = (
    <Practice.StageBody tabIndex={0}>
      <Practice.ResultContent>
        {presentation === 'page' && (
          <Practice.ResultsHeading>
            <div>
              <h2 id={headingId}>{t('PracticeResults')}</h2>
              <Practice.Muted role="status">
                {t(attempt.scoring.complete ? 'PracticeResultsReady' : 'PracticeGradingPending')}
              </Practice.Muted>
            </div>
            <OverallScore attempt={attempt} />
          </Practice.ResultsHeading>
        )}
        {question && (
          <QuizQuestionReviewView
            key={String(question.id)}
            question={question}
            index={index}
            total={attempt.questions.length}
          />
        )}
      </Practice.ResultContent>
    </Practice.StageBody>
  );
  const controls = (
    <>
      <Practice.FooterContext>
        <PreviousButton
          variant="ghost"
          size={presentation === 'page' ? 'icon' : 'default'}
          disabled={index === 0}
          onClick={() => setIndex((value) => value - 1)}
          label={
            presentation === 'page' ? (
              <span className="sr-only">{t('QuizPrevious')}</span>
            ) : (
              t('QuizPrevious')
            )
          }
        ></PreviousButton>
        {presentation === 'page' && (
          <NextButton
            variant="ghost"
            size="icon"
            disabled={index >= attempt.questions.length - 1}
            onClick={() => setIndex((value) => value + 1)}
            label={<span className="sr-only">{t('PracticeNextQuestion')}</span>}
          ></NextButton>
        )}
      </Practice.FooterContext>
      {presentation === 'preview' ? (
        <NextButton
          variant="outline"
          disabled={index >= attempt.questions.length - 1}
          onClick={() => setIndex((value) => value + 1)}
          label={t('PracticeNextQuestion')}
        ></NextButton>
      ) : (
        retry
      )}
    </>
  );

  if (presentation === 'preview')
    return (
      <>
        <Surface.Header>
          <Surface.DetailHeading>
            <h2 id={headingId}>{t('PracticeOverallResults')}</h2>
            <Practice.MutedText>
              {questionCount(attempt.questions.length)} ·{' '}
              {t(attempt.scoring.complete ? 'PracticeAttemptCompleted' : 'PracticeGradingPending')}
            </Practice.MutedText>
          </Surface.DetailHeading>
          <OverallScore attempt={attempt} />
        </Surface.Header>
        <Surface.ArchiveFrame>
          <Surface.Scroll>
            <Surface.Body>
              <Practice.Results aria-labelledby={headingId} data-presentation={presentation}>
                {body}
              </Practice.Results>
            </Surface.Body>
          </Surface.Scroll>
          <Surface.ArchiveFooter>
            <Surface.ArchiveActions>{controls}</Surface.ArchiveActions>
          </Surface.ArchiveFooter>
        </Surface.ArchiveFrame>
      </>
    );

  return (
    <QuizSessionView
      label={t('PracticeAllAnswered')}
      answered={attempt.questions.length}
      total={attempt.questions.length}
    >
      <Practice.Results aria-labelledby={headingId} data-presentation={presentation}>
        {body}
        <Practice.StageFooter>{controls}</Practice.StageFooter>
      </Practice.Results>
    </QuizSessionView>
  );
}

/** Separates the learner response, reference, feedback and explanation without offering editable answer fields. */
export function QuizQuestionReviewView({
  question,
  index,
  total
}: {
  question: Question;
  index?: number;
  total?: number;
}) {
  const { t, questionNumber, reviewProgress } = usePracticePresentation();
  const selected = question.answer?.type === 'choice' ? question.answer.choiceIds : [];

  return (
    <Practice.Preview data-results="true">
      {index !== undefined && total !== undefined && (
        <Practice.MutedText>
          {questionNumber(index + 1)} · {reviewProgress(index + 1, total)}
        </Practice.MutedText>
      )}
      <Practice.ReviewHeading>
        <Practice.Prompt>{question.prompt}</Practice.Prompt>
        <span
          className={question.score === null ? undefined : 'sr-only'}
          role="status"
          aria-live="polite"
        >
          {t(verdict(question))}
        </span>
      </Practice.ReviewHeading>
      <ResultAnswers question={question} selected={selected} />
      <QuestionNotes question={question} />
    </Practice.Preview>
  );
}

/** Adds reference material below the mounted editor without replacing its controls. */
export function QuizQuestionFeedbackView({ question }: { question: Question }) {
  const { t } = usePracticePresentation();

  return (
    <>
      <span
        className={question.score === null ? undefined : 'sr-only'}
        role="status"
        aria-live="polite"
      >
        {t(verdict(question))}
      </span>
      {question.score !== 1 && question.kind === 'ordering' && (
        <Practice.Ordering
          label={t('RightAnswer')}
          items={question.correctItemIds.map((id) => ({
            key: String(id),
            text: question.items.find((item) => item.id === id)!.text,
            tone: 'correct'
          }))}
        />
      )}
      {question.kind === 'matching' &&
        question.pairs
          .filter((pair) => pair.score !== 1)
          .map((pair) => (
            <Practice.AnswerComparison
              key={pair.termId}
              label={question.terms.find((term) => term.id === pair.termId)!.text}
              tone="correct"
            >
              {question.definitions.find((definition) => definition.id === pair.definitionId)?.text}
            </Practice.AnswerComparison>
          ))}
      {(question.kind === 'open' || question.kind === 'fill_blank') &&
        question.score !== null &&
        question.score !== 1 &&
        question.referenceAnswer && (
          <Practice.AnswerComparison label={t('RightAnswer')} tone="correct">
            {question.referenceAnswer}
          </Practice.AnswerComparison>
        )}
      <QuestionNotes question={question} />
    </>
  );
}

function QuestionNotes({ question }: { question: Question }) {
  const { t } = usePracticePresentation();

  return (
    <>
      {question.feedback && (
        <Practice.ResultNote>
          <h3>{t('PracticeFeedback')}</h3>
          <p>{question.feedback}</p>
        </Practice.ResultNote>
      )}
      <Practice.Explanation>
        <h3>{t('PracticeArchiveExplanation')}</h3>
        <p>{question.explanation}</p>
      </Practice.Explanation>
    </>
  );
}

/** Chooses localized verdict copy from the stored score and answer presence. */
function verdict(question: Question) {
  if (question.score === null) return question.answer ? 'PracticeUngraded' : 'PracticeUnanswered';

  if (question.score === 1) return 'VerdictCorrect';

  return question.score === 0 ? 'VerdictIncorrect' : 'VerdictPartly';
}

/** Displays a percentage only when the attempt exposes a score; otherwise identifies pending scoring. */
function OverallScore({ attempt }: { attempt: Completed }) {
  const { t, percentage } = usePracticePresentation();

  if (attempt.scoring.score === null)
    return (
      <Practice.ResultVerdict tone="pending">{t('PracticeScorePending')}</Practice.ResultVerdict>
    );

  return (
    <Practice.Score>
      {percentage(attempt.scoring.score)}
      <span>{t('PracticeScore')}</span>
    </Practice.Score>
  );
}

/** Renders each completed answer variant within the shared compact comparison presentation. */
function ResultAnswers({
  question,
  selected
}: {
  question: Question;
  selected: Extract<Question['answer'], { type: 'choice' }>['choiceIds'];
}) {
  const { t } = usePracticePresentation();
  const groupName = useId();

  return (
    <>
      {question.kind === 'ordering' ? (
        <OrderingResult question={question} />
      ) : question.kind === 'matching' ? (
        <MatchingReview question={question} />
      ) : !('choices' in question) ? (
        <TextResultAnswers question={question} />
      ) : (
        <Practice.Answers aria-label={t('YourAnswer')}>
          {question.choices.map((choice, position) => (
            <Practice.ChoiceOption
              key={String(choice.id)}
              type={question.kind === 'multiple_choice' ? 'checkbox' : 'radio'}
              name={groupName}
              text={
                question.kind === 'true_false'
                  ? t(choice.text === 'true' ? 'PracticeTrue' : 'PracticeFalse')
                  : choice.text
              }
              number={position + 1}
              selected={selected.includes(choice.id)}
              disabled
              readOnly
              tone={
                choice.isCorrect
                  ? 'correct'
                  : selected.includes(choice.id)
                    ? 'incorrect'
                    : undefined
              }
              status={
                choice.isCorrect
                  ? t('ReaderCorrectAnswer')
                  : selected.includes(choice.id)
                    ? t('YourAnswer')
                    : undefined
              }
            />
          ))}
        </Practice.Answers>
      )}
    </>
  );
}

function TextResultAnswers({
  question
}: {
  question: Extract<Question, { kind: 'open' | 'fill_blank' }>;
}) {
  const { t } = usePracticePresentation();

  return (
    <Practice.OpenAnswers>
      <Practice.AnswerComparison
        label={t('YourAnswer')}
        tone={question.score === null ? undefined : question.score === 1 ? 'correct' : 'incorrect'}
      >
        {question.answer?.type === 'open' && question.answer.answer?.trim()
          ? question.answer.answer
          : t('PracticeUnanswered')}
      </Practice.AnswerComparison>
      {question.score !== 1 && (
        <Practice.AnswerComparison
          label={t('RightAnswer')}
          tone={question.referenceAnswer === null ? undefined : 'correct'}
        >
          {question.referenceAnswer ?? t('PracticeUngraded')}
        </Practice.AnswerComparison>
      )}
    </Practice.OpenAnswers>
  );
}
