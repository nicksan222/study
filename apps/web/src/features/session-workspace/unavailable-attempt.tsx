import type { SessionId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useI18n } from '../../lib/i18n';
import {
  selectionOptions,
  sessionGenerationsOptions,
  threadOptions
} from './session-workspace.queries';

/** Retiring an attempt never changes or replays its captured payload. */
export function UnavailableAttempt({
  id,
  busy,
  onAbandon
}: {
  id: SessionId;
  busy: boolean;
  onAbandon: () => void;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const [review, setReview] = useState<'idle' | 'pending' | 'ready' | 'failed'>('idle');
  return (
    <section className="session-attempt-recovery" aria-label={t('SessionAttemptUnavailable')}>
      <p role="status">{t('SessionAttemptUnavailable')}</p>
      <p className="session-muted">{t('SessionAbandonAttemptHelp')}</p>
      <Button
        variant="outline"
        disabled={busy || review === 'pending'}
        onClick={async () => {
          setReview('pending');
          try {
            await Promise.all([
              client.fetchQuery({ ...selectionOptions(id), staleTime: 0 }),
              client.fetchInfiniteQuery({ ...threadOptions(id), staleTime: 0 }),
              client.fetchInfiniteQuery({ ...sessionGenerationsOptions(id), staleTime: 0 })
            ]);
            setReview('ready');
          } catch {
            setReview('failed');
          }
        }}
      >
        {t('SessionReviewUnavailableAttempt')}
      </Button>
      {review === 'failed' && (
        <ErrorState title={t('ErrorStateTitle')} description={<> {t('SessionReadError')} </>} />
      )}
      {review === 'ready' && (
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            if (!busy) onAbandon();
          }}
        >
          {t('SessionAbandonAttempt')}
        </Button>
      )}
    </section>
  );
}
