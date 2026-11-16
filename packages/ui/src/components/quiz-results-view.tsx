import { NextButton, PreviousButton } from '#ui/components/navigation-button.tsx';
import { Practice } from '#ui/components/practice.tsx';
import { SelectionSurface as Surface } from '#ui/components/selection.tsx';
import { useState, useId } from 'react';
import type { ReactNode } from 'react';

import { MatchingReviewView as MatchingReview } from './matching-review-view';
import { OrderingResultView as OrderingResult } from './ordering-result-view';
import { usePracticePresentation } from './practice-presentation';
import type { PracticeResultsModel } from './practice-question-model';

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
    <Practice.StageBody>
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
        <ResultQuestion
          key={String(question.id)}
          question={question}
          index={index}
          total={attempt.questions.length}
          showHeading
        />
      )}
    </Practice.StageBody>
  );
  const controls = (
    <>
      <Practice.FooterContext>
        <PreviousButton
          variant="ghost"
          disabled={index === 0}
          onClick={() => setIndex((value) => value - 1)}
          label={t('QuizPrevious')}
        ></PreviousButton>
        {presentation === 'page' && (
          <NextButton
            variant="ghost"
            disabled={index >= attempt.questions.length - 1}
            onClick={() => setIndex((value) => value + 1)}
            label={t('PracticeNextQuestion')}
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
    <Practice.Results aria-labelledby={headingId} data-presentation={presentation}>
      {body}
      <Practice.StageFooter>{controls}</Practice.StageFooter>
    </Practice.Results>
  );
}

/** Separates the learner response, reference, feedback and explanation without offering editable answer fields. */
function ResultQuestion({
  question,
  index,
  total,
  showHeading
}: {
  question: Question;
  index: number;
  total: number;
  showHeading: boolean;
}) {
  const { t, questionNumber, reviewProgress } = usePracticePresentation();
  const selected = question.answer?.type === 'choice' ? question.answer.choiceIds : [];

  return (
    <Practice.Preview data-results="true">
      {showHeading && (
        <>
          <Practice.ProgressHeading role="status" aria-live="polite">
            <span>
              {questionNumber(index + 1)} · {reviewProgress(index + 1, total)}
            </span>
            <Practice.ResultVerdict tone={verdictTone(question)}>
              {t(verdict(question))}
            </Practice.ResultVerdict>
          </Practice.ProgressHeading>
          <Practice.Prompt>{question.prompt}</Practice.Prompt>
        </>
      )}
      <ResultAnswers question={question} selected={selected} />
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
    </Practice.Preview>
  );
}

/** Maps persisted grading state to a semantic tone without inferring a score for unanswered responses. */
function verdictTone(question: Question) {
  if (question.score === null) return question.answer ? 'pending' : 'unanswered';

  if (question.score === 1) return 'correct';

  return question.score === 0 ? 'incorrect' : 'partial';
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
        <Practice.OpenAnswers>
          <Practice.AnswerComparison label={t('YourAnswer')}>
            {question.answer?.type === 'open' && question.answer.answer?.trim()
              ? question.answer.answer
              : t('PracticeUnanswered')}
          </Practice.AnswerComparison>
          <Practice.AnswerComparison label={t('RightAnswer')}>
            {question.referenceAnswer ?? t('PracticeUngraded')}
          </Practice.AnswerComparison>
        </Practice.OpenAnswers>
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
