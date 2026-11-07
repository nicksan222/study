import type { quizAttemptCompletedSchema } from '@study/contracts/learning/schemas';
import { questionNumber, reviewProgress, questionCount } from '@study/localization';
import { Button } from '@study/ui/button';
import { NextButton, PreviousButton } from '@study/ui/navigation-button';
import { Practice } from '@study/ui/practice';
import { SelectionSurface as Surface } from '@study/ui/selection';
import { Textarea } from '@study/ui/textarea';
import { Link, useSearch } from '@tanstack/react-router';
import { RotateCcw } from 'lucide-react';
import { useState, useId } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { MatchingReview } from './matching-review';

type Completed = typeof quizAttemptCompletedSchema.Type;

type Question = Completed['questions'][number];

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

/** Show the question verdict, variant review and explanation in the shared Results layout. */
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
    <Practice.Preview>
      {showHeading && (
        <>
          <Practice.ProgressHeading>
            <span>
              {questionNumber(locale, index + 1)} · {reviewProgress(locale, index + 1, total)}
            </span>
            <span>{t(verdict(question))}</span>
          </Practice.ProgressHeading>
          <Practice.Prompt>{question.prompt}</Practice.Prompt>
        </>
      )}
      <ResultAnswers question={question} selected={selected} />
      {question.feedback && <Practice.Muted>{question.feedback}</Practice.Muted>}
      <Practice.Explanation>
        <Practice.MutedText>{t('PracticeArchiveExplanation')}</Practice.MutedText>
        <p>{question.explanation}</p>
      </Practice.Explanation>
    </Practice.Preview>
  );
}

function verdict(question: Question) {
  if (question.score === null) return question.answer ? 'PracticeUngraded' : 'PracticeUnanswered';

  if (question.score === 1) return 'VerdictCorrect';

  return question.score === 0 ? 'VerdictIncorrect' : 'VerdictPartly';
}

function OverallScore({ attempt }: { attempt: Completed }) {
  const { t, locale } = useI18n();

  if (attempt.scoring.score === null)
    return <Practice.MutedText>{t('PracticeGradingPending')}</Practice.MutedText>;

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

/** Route completed matching, text and choice questions to their respective review presentation. */
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
      {question.kind === 'matching' ? (
        <MatchingReview question={question} />
      ) : !('choices' in question) ? (
        <Practice.OpenAnswers>
          <div>
            <Practice.Muted>{t('YourAnswer')}</Practice.Muted>
            <Textarea
              readOnly
              aria-label={t('YourAnswer')}
              value={
                question.answer?.type === 'open'
                  ? (question.answer.answer ?? t('PracticeUnanswered'))
                  : t('PracticeUnanswered')
              }
            />
          </div>
          <div>
            <Practice.Muted>{t('RightAnswer')}</Practice.Muted>
            <Textarea
              readOnly
              aria-label={t('RightAnswer')}
              value={question.referenceAnswer ?? t('PracticeUngraded')}
            />
          </div>
        </Practice.OpenAnswers>
      ) : (
        <Practice.Answers aria-label={t('YourAnswer')}>
          {question.choices.map((choice, position) => (
            <Practice.ChoiceOption
              key={String(choice.id)}
              type={question.kind === 'multiple_choice' ? 'checkbox' : 'radio'}
              name={'result-' + String(question.id)}
              text={choice.text}
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
