import { Button } from '@study/ui/button';
import { NextButton } from '@study/ui/navigation-button';
import { Practice } from '@study/ui/practice';
import type { ReactNode, RefObject } from 'react';

import { usePracticePresentation } from './practice-presentation';

/** Shared attempt frame; callers choose the current question and own durable work. */
export function QuizSessionView({
  heading,
  label,
  answered,
  total,
  children
}: {
  heading?: RefObject<HTMLDivElement | null>;
  label: string;
  answered: number;
  total: number;
  children: ReactNode;
}) {
  const { t, reviewProgress } = usePracticePresentation();

  return (
    <Practice.Active ref={heading} tabIndex={-1}>
      <Practice.ProgressHeading>
        <span>{label}</span>
        <span>{reviewProgress(answered, total)}</span>
      </Practice.ProgressHeading>
      <Practice.Progress max={total} value={answered} aria-label={t('PracticeProgress')} />
      {children}
    </Practice.Active>
  );
}

/** Present saved responses without deciding how an attempt is finished. */
export function QuizFinishView({
  rows,
  select,
  finishing,
  finish,
  error
}: {
  rows: { key: string; number: string; prompt: string; answer: string; editLabel: string }[];
  select: (index: number) => void;
  finishing: boolean;
  finish: () => void;
  error?: ReactNode;
}) {
  const { t } = usePracticePresentation();

  return (
    <Practice.Stage>
      <Practice.StageBody>
        <Practice.Intro>
          <h2>{t('QuizReviewAnswers')}</h2>
          <p>{t('PracticeFinishHint')}</p>
        </Practice.Intro>
        <Practice.ReviewList>
          {rows.map((item, position) => (
            <Practice.ReviewItem key={item.key}>
              <div>
                <small>{item.number}</small>
                <h3>{item.prompt}</h3>
                <p>{item.answer}</p>
              </div>
              <Button
                variant="ghost"
                onClick={() => select(position)}
                disabled={finishing}
                aria-label={item.editLabel}
              >
                {t('QuizEditAnswer')}
              </Button>
            </Practice.ReviewItem>
          ))}
        </Practice.ReviewList>
        {error}
      </Practice.StageBody>
      <Practice.StageFooter>
        <Practice.FooterContext>
          <Practice.MutedText>{t('PracticeQuizSaveHint')}</Practice.MutedText>
        </Practice.FooterContext>
        <NextButton
          disabled={finishing}
          onClick={finish}
          label={t(finishing ? 'PracticeSaving' : 'PracticeFinishQuiz')}
        />
      </Practice.StageFooter>
    </Practice.Stage>
  );
}
