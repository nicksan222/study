import type { ProjectId, MaterialVersionDetailDto } from '@study/contracts';
import { rpc } from '@study/contracts/react';
import { SelectedIcon, RetryIcon } from '@study/icons';
import { Button, ErrorState, FlashcardReviewView, Loading, Practice } from '@study/ui';
import { useRef, useState } from 'react';

import { useNativeAction } from '#client/lib/effect/native.ts';
import { useI18n } from '#client/lib/i18n.tsx';

import { ClientPracticePresentation } from './presentation';
import { OperationError } from './quiz';

type Deck = Extract<MaterialVersionDetailDto, { kind: 'flashcards' }>;

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
  const query = rpc.learning.dueCards.useQuery({ projectId: project, limit: 100 });
  const state = { ...query, data: query.data?.items };
  const [round, setRound] = useState(0);
  const refresh = () => {
    state.refetch();
    setRound((value) => value + 1);
  };

  if (state.isPending) return <Loading label={t('LoadingStudy')} />;

  if (state.isError || !state.data)
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
        <SelectedIcon aria-hidden="true" />
        <h2>{t('PracticeNothingDue')}</h2>
        <p>{t('PracticeNothingDueHint')}</p>
        <Button onClick={replay}>
          <RetryIcon aria-hidden="true" />
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
  const [queue, setQueue] = useState(() => cards);
  const [revealed, setRevealed] = useState(false);
  const [completed, setCompleted] = useState(0);
  const focus = useRef<HTMLDivElement>(null);
  const card = queue[0];
  const rating = useNativeAction(async (rating: 'again' | 'hard' | 'good' | 'easy') => {
    if (!card) return;

    await rpc.learning.reviewCard.call({ versionId: version.id, cardId: card.cardId, rating });
    setQueue((previous) => previous.slice(1));
    setCompleted((previous) => previous + 1);
    setRevealed(false);
    focus.current?.focus();
  });

  return (
    <ClientPracticePresentation>
      <FlashcardReviewView
        card={card ? { ...card, key: card.cardId } : undefined}
        revealed={revealed}
        completed={completed}
        total={cards.length}
        pending={rating.isPending}
        reveal={() => setRevealed(true)}
        rate={rating.mutate}
        focus={focus}
        keyboardScope="window"
        error={rating.isError ? <OperationError /> : undefined}
        restart={() => {
          if (restart) restart();
          else {
            setQueue(cards);
            setCompleted(0);
          }
        }}
      />
    </ClientPracticePresentation>
  );
}
