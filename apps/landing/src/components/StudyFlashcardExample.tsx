import { landingCopy } from '@study/localization/landing';
import { FlashcardReviewView } from '@study/ui/flashcard-review-view';
import { useRef, useState } from 'react';

import { PracticeExamplePresentation } from './PracticeExamplePresentation';

/** A local review queue exercises the production review presentation without saving a schedule. */
export function StudyFlashcardExample({
  lang,
  ready,
  phase
}: {
  lang: 'en' | 'it';
  ready: boolean;
  phase?: 'start' | 'result';
}) {
  const c = landingCopy[lang].examples;
  const cards = [
    { key: 'membrane', front: c.flashPrompt, back: c.flashAnswer },
    { key: 'passive', front: c.passive, back: c.passiveBody },
    { key: 'active', front: c.active, back: c.activeBody }
  ];
  const [completed, setCompleted] = useState(0);
  const [revealed, setRevealed] = useState(phase === 'result');
  const focus = useRef<HTMLDivElement>(null);

  return (
    <PracticeExamplePresentation lang={lang}>
      <FlashcardReviewView
        card={cards[completed]}
        total={cards.length}
        completed={completed}
        revealed={revealed}
        pending={!ready}
        focus={focus}
        reveal={() => setRevealed(true)}
        rate={() => {
          setCompleted((value) => value + 1);
          setRevealed(false);
          focus.current?.focus();
        }}
        restart={() => {
          setCompleted(0);
          setRevealed(false);
        }}
      />
    </PracticeExamplePresentation>
  );
}
