import type { ProjectId } from '@study/contracts/ids';
import type { learningRatingSchema } from '@study/contracts/learning/schemas';
import type { MaterialVersionDetailDto } from '@study/contracts/materials/schemas';
import { reviewProgress } from '@study/localization';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Loading } from '@study/ui/loading';
import { Practice } from '@study/ui/practice';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Check, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useI18n } from '#web/lib/i18n.tsx';

import { reviewCardOptions, dueCardsOptions } from './practice.queries';
import { OperationError } from './quiz';

type Deck = Extract<MaterialVersionDetailDto, { kind: 'flashcards' }>;

const ratings = [
  ['again', 'RateAgain'],
  ['hard', 'RateHard'],
  ['good', 'RateGood'],
  ['easy', 'RateEasy']
] as const;

export function FlashcardReview({ version, project }: { version: Deck; project?: ProjectId }) {
  const [replay, setReplay] = useState(false);
  const [round, setRound] = useState(0);
  const replayDeck = () => {
    setReplay(true);
    setRound((value) => value + 1);
  };

  return project && !replay ? (
    <ScheduledReview version={version} project={project} replay={replayDeck} />
  ) : (
    <ReviewCards key={round} version={version} cards={version.content.cards} restart={replayDeck} />
  );
}

function ScheduledReview({
  version,
  project,
  replay
}: {
  version: Deck;
  project: ProjectId;
  replay: () => void;
}) {
  const { t } = useI18n();
  const state = useQuery(dueCardsOptions(project));
  const [round, setRound] = useState(0);
  const refresh = () => {
    void state.refetch().then((result) => {
      if (result.isSuccess) setRound((value) => value + 1);
    });
  };

  if (state.isPending) return <Loading label={t('LoadingStudy')} />;

  if (state.isError)
    return (
      <ErrorState
        title={t('StudyLoadError')}
        action={<Button onClick={refresh}>{t('LibraryRefresh')}</Button>}
      />
    );

  const cards = state.data
    .filter((item) => item.snapshot.version_id === version.id)
    .map(({ snapshot }) => ({
      cardId: snapshot.card_id,
      front: snapshot.front,
      back: snapshot.back
    }));

  if (!cards.length)
    return (
      <Practice.Complete>
        <Check aria-hidden="true" />
        <h2>{t('PracticeNothingDue')}</h2>
        <p>{t('PracticeNothingDueHint')}</p>
        <Button variant="outline" onClick={replay}>
          <RotateCcw aria-hidden="true" />
          {t('PracticeReplayFlashcards')}
        </Button>
      </Practice.Complete>
    );

  return <ReviewCards key={round} version={version} cards={cards} restart={replay} />;
}

function ReviewCards({
  version,
  cards,
  restart
}: {
  version: Deck;
  cards: Deck['content']['cards'];
  restart?: () => void;
}) {
  const { t, locale } = useI18n();
  const client = useQueryClient();
  const [queue, setQueue] = useState(() => cards);
  const [revealed, setRevealed] = useState(false);
  const [completed, setCompleted] = useState(0);
  const focus = useRef<HTMLDivElement>(null);
  const card = queue[0];
  const rating = useMutation({
    ...reviewCardOptions(version.id, card?.cardId),
    onSuccess: () => {
      setQueue((previous) => previous.slice(1));
      setCompleted((previous) => previous + 1);

      setRevealed(false);
      void client.invalidateQueries({ queryKey: ['learning', 'due'], refetchType: 'none' });
      focus.current?.focus();
    }
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (ignoreShortcut(event)) return;

      if (!card || rating.isPending) return;

      if (event.code === 'Space') {
        event.preventDefault();
        setRevealed(true);
      }

      const value = ratings[Number(event.key) - 1]?.[0];

      if (revealed && value) {
        event.preventDefault();
        rating.mutate(value);
      }
    }

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [card, revealed, rating]);

  return (
    <Practice.Active ref={focus} tabIndex={-1}>
      <Practice.ProgressHeading>
        <span>{t('PracticeReviewNote')}</span>
        <span>{reviewProgress(locale, completed, cards.length)}</span>
      </Practice.ProgressHeading>
      <Practice.Progress max={cards.length} value={completed} aria-label={t('PracticeProgress')} />
      {card ? (
        <>
          <Practice.Flashcard key={String(card.cardId)}>
            <h2>{card.front}</h2>
            {revealed ? (
              <Practice.CardAnswer>
                <Practice.MutedText>{t('CardBack')}</Practice.MutedText>
                <p>{card.back}</p>
              </Practice.CardAnswer>
            ) : null}
          </Practice.Flashcard>
          <ReviewControls
            revealed={revealed}
            pending={rating.isPending}
            reveal={() => setRevealed(true)}
            rate={rating.mutate}
          />
          {rating.isError && <OperationError />}
        </>
      ) : (
        <Practice.Complete role="status">
          <Check aria-hidden="true" />
          <h2>{t('PracticeReviewComplete')}</h2>
          <p>{t('PracticeReviewSaved')}</p>
          <Button
            variant="outline"
            onClick={() => {
              if (restart) {
                restart();

                return;
              }

              setQueue(cards);
              setCompleted(0);
            }}
          >
            <RotateCcw aria-hidden="true" />
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
  rate: (value: typeof learningRatingSchema.Type) => void;
}) {
  const { t } = useI18n();

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
