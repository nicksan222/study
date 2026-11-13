import type { quizAttemptCompletedSchema } from '@study/contracts/learning/schemas';
import { questionNumber, reviewProgress, questionCount } from '@study/localization';
import { Button } from '@study/ui/button';
import { NextButton, PreviousButton } from '@study/ui/navigation-button';
import { Practice } from '@study/ui/practice';
import { SelectionSurface as Surface } from '@study/ui/selection';
import { Link, useSearch } from '@tanstack/react-router';
import { RotateCcw } from 'lucide-react';
import { useState, useId } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { MatchingReview } from './matching-review';
import { OrderingResult } from './ordering-result';

type Completed = typeof quizAttemptCompletedSchema.Type;

type Question = Completed['questions'][number];

/** Reviews persisted completed answers on the page or in history, preserving question navigation and pending scores. */
export function QuizResults({
  attempt,
  presentation = 'page'
}: {
  attempt: Completed;
  presentation?: 'page' | 'preview';
}) {
  const { t, locale } = useI18n();
  const search = useSearch({ from: '__root__' });
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
        <Button
          render={
            <Link
              to="/practice/$materialId"
              params={{ materialId: String(attempt.materialId) }}
              search={{ project: search.project }}
            />
          }
        >
          <RotateCcw aria-hidden="true" />
          {t('PracticeTryAgain')}
        </Button>
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
              {questionCount(locale, attempt.questions.length)} ·{' '}
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
  const { t, locale } = useI18n();
  const selected = question.answer?.type === 'choice' ? question.answer.choiceIds : [];

  return (
    <Practice.Preview data-results="true">
      {showHeading && (
        <>
          <Practice.ProgressHeading role="status" aria-live="polite">
            <span>
              {questionNumber(locale, index + 1)} · {reviewProgress(locale, index + 1, total)}
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
  const { t, locale } = useI18n();

  if (attempt.scoring.score === null)
    return (
      <Practice.ResultVerdict tone="pending">{t('PracticeScorePending')}</Practice.ResultVerdict>
    );

  return (
    <Practice.Score>
      {new Intl.NumberFormat(locale === 'italian' ? 'it' : 'en', {
        style: 'percent',
        maximumFractionDigits: 0
      }).format(attempt.scoring.score)}
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
  const { t } = useI18n();

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
              name={'result-' + String(question.id)}
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
