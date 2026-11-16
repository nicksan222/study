import { SelectedIcon, RetryIcon } from '@study/icons';
import { Button } from '#ui/components/button.tsx';
import { Practice } from '#ui/components/practice.tsx';
import { useEffect } from 'react';
import type { ReactNode, RefObject } from 'react';

import { usePracticePresentation } from './practice-presentation';

export type FlashcardRating = 'again' | 'hard' | 'good' | 'easy';

const ratings = [
  ['again', 'RateAgain'],
  ['hard', 'RateHard'],
  ['good', 'RateGood'],
  ['easy', 'RateEasy']
] as const;

/** Present a review queue without scheduling or recording reviews. */
export function FlashcardReviewView({
  card,
  revealed,
  completed,
  total,
  pending,
  reveal,
  rate,
  restart,
  error,
  focus,
  keyboardScope = 'local'
}: {
  card?: { key: string | bigint; front: string; back: string };
  revealed: boolean;
  completed: number;
  total: number;
  pending: boolean;
  reveal: () => void;
  rate: (value: FlashcardRating) => void;
  restart: () => void;
  error?: ReactNode;
  focus?: RefObject<HTMLDivElement | null>;
  keyboardScope?: 'local' | 'window';
}) {
  const { t, reviewProgress } = usePracticePresentation();

  function onKey(event: KeyboardEvent) {
    if (ignoreShortcut(event) || !card || pending) return;

    if (event.code === 'Space') {
      event.preventDefault();
      reveal();
    }

    const value = ratings[Number(event.key) - 1]?.[0];

    if (revealed && value) {
      event.preventDefault();
      rate(value);
    }
  }

  useEffect(() => {
    if (keyboardScope !== 'window') return;

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Practice.Active
      ref={focus}
      onKeyDown={keyboardScope === 'local' ? (event) => onKey(event.nativeEvent) : undefined}
      tabIndex={-1}
    >
      <Practice.ProgressHeading>
        <span>{t('PracticeReviewProgress')}</span>
        <span>{reviewProgress(completed, total)}</span>
      </Practice.ProgressHeading>
      <Practice.Progress max={total} value={completed} aria-label={t('PracticeProgress')} />
      {card ? (
        <>
          <Practice.Flashcard key={String(card.key)}>
            <h2>{card.front}</h2>
            {revealed ? (
              <Practice.CardAnswer>
                <Practice.MutedText>{t('CardBack')}</Practice.MutedText>
                <p>{card.back}</p>
              </Practice.CardAnswer>
            ) : null}
          </Practice.Flashcard>
          <ReviewControls revealed={revealed} pending={pending} reveal={reveal} rate={rate} />
          {error}
        </>
      ) : (
        <Practice.Complete role="status">
          <SelectedIcon aria-hidden="true" />
          <h2>{t('PracticeReviewComplete')}</h2>
          <p>{t('PracticeReviewSaved')}</p>
          <Button variant="outline" onClick={restart}>
            <RetryIcon aria-hidden="true" />
            {t('PracticeReviewAgain')}
          </Button>
        </Practice.Complete>
      )}
    </Practice.Active>
  );
}

function ignoreShortcut(event: KeyboardEvent) {
  if (event.altKey || event.metaKey || event.ctrlKey || event.repeat) return true;

  return (
    event.target instanceof HTMLElement &&
    Boolean(
      event.target.closest(
        'button, a, input, textarea, select, [contenteditable="true"], [role="dialog"]'
      )
    )
  );
}

function ReviewControls({
  revealed,
  pending,
  reveal,
  rate
}: {
  revealed: boolean;
  pending: boolean;
  reveal: () => void;
  rate: (value: FlashcardRating) => void;
}) {
  const { t } = usePracticePresentation();

  return (
    <Practice.RatingArea>
      <Practice.Muted>{t(revealed ? 'PracticeRateHint' : 'PracticeRecallHint')}</Practice.Muted>
      {revealed ? (
        <Practice.Ratings>
          {ratings.map(([value, label], index) => (
            <Button
              key={value}
              variant={value === 'good' ? 'default' : 'outline'}
              disabled={pending}
              onClick={() => rate(value)}
            >
              <span>{t(label)}</span>
              <kbd aria-hidden="true">{index + 1}</kbd>
            </Button>
          ))}
        </Practice.Ratings>
      ) : (
        <Practice.RevealAction>
          <Button onClick={reveal}>
            {t('ShowAnswer')}
            <kbd aria-hidden="true">{t('PracticeSpaceKey')}</kbd>
          </Button>
        </Practice.RevealAction>
      )}
    </Practice.RatingArea>
  );
}
