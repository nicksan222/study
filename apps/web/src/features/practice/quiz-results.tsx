import type { quizAttemptCompletedSchema } from '@study/contracts/learning/schemas';
import { questionNumber } from '@study/localization';
import { Button } from '@study/ui/button';
import { Practice } from '@study/ui/practice';
import { Link, useSearch } from '@tanstack/react-router';
import { Check, ChevronDown, Minus, RotateCcw, X } from 'lucide-react';

import { useI18n } from '#web/lib/i18n.tsx';

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

  return (
    <Practice.Results aria-labelledby="practice-results" data-presentation={presentation}>
      <Practice.StageBody>
        <Practice.ResultsHeading>
          <div>
            <h2 id="practice-results">{t('PracticeResults')}</h2>
            <Practice.Muted role="status">
              {t(
                attempt.questions.some((question) => question.grading === 'ungraded')
                  ? 'PracticeGradingPending'
                  : 'PracticeResultsReady'
              )}
            </Practice.Muted>
          </div>
        </Practice.ResultsHeading>
        {attempt.scoring.score !== null && (
          <Practice.Score>
            {new Intl.NumberFormat(locale === 'italian' ? 'it' : 'en', {
              style: 'percent',
              maximumFractionDigits: 0
            }).format(attempt.scoring.score)}
            <span>{t('PracticeScore')}</span>
          </Practice.Score>
        )}
        <Practice.ResultList>
          {attempt.questions.map((question, index) => (
            <ResultRow
              key={String(question.id)}
              question={question}
              index={index}
              only={attempt.questions.length === 1}
            />
          ))}
        </Practice.ResultList>
      </Practice.StageBody>
      {presentation === 'page' && (
        <Practice.StageFooter>
          <Practice.FooterContext>
            <Practice.MutedText>{t('PracticeQuizSaveHint')}</Practice.MutedText>
          </Practice.FooterContext>
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
        </Practice.StageFooter>
      )}
    </Practice.Results>
  );
}

function verdictOf(question: Question) {
  if (question.score === null)
    return {
      kind: 'pending',
      label: question.answer ? 'PracticeUngraded' : 'PracticeUnanswered',
      Icon: Minus
    } as const;

  if (question.score === 1)
    return { kind: 'correct', label: 'VerdictCorrect', Icon: Check } as const;

  if (question.score === 0)
    return { kind: 'incorrect', label: 'VerdictIncorrect', Icon: X } as const;

  return { kind: 'partly', label: 'VerdictPartly', Icon: Minus } as const;
}

function ResultRow({
  question,
  index,
  only
}: {
  question: Question;
  index: number;
  only: boolean;
}) {
  const { t, locale } = useI18n();
  const verdict = verdictOf(question);

  return (
    <Practice.Result open={only || undefined}>
      <summary>
        <Practice.VerdictText data-verdict={verdict.kind}>
          <verdict.Icon aria-hidden="true" />
        </Practice.VerdictText>
        <span>
          <small>{questionNumber(locale, index + 1)}</small>
          {question.prompt}
        </span>
        <Practice.ResultLabelText>{t(verdict.label)}</Practice.ResultLabelText>
        <ChevronDown aria-hidden="true" />
      </summary>
      <Practice.ResultBody>
        <h3>{t('YourAnswer')}</h3>
        <p>{learnerAnswer(question) ?? t('PracticeUnanswered')}</p>
        <h3>{t('RightAnswer')}</h3>
        <p>{referenceAnswer(question)}</p>
        {question.feedback && <p>{question.feedback}</p>}
        <Practice.Muted>{question.explanation}</Practice.Muted>
      </Practice.ResultBody>
    </Practice.Result>
  );
}

function learnerAnswer(question: Question) {
  if (!question.answer) return null;

  if (question.answer.type === 'open') return question.answer.answer;

  if (question.kind === 'open') return null;

  const ids = question.answer.choiceIds;

  return question.choices
    .filter((choice) => ids.includes(choice.id))
    .map((choice) => choice.text)
    .join(', ');
}

function referenceAnswer(question: Question) {
  if (question.kind === 'open') return question.referenceAnswer;

  return question.choices
    .filter((choice) => choice.isCorrect)
    .map((choice) => choice.text)
    .join(', ');
}
