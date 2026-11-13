import type { NoteId } from '@study/contracts/ids';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Notebook } from '@study/ui/note-workspace';
import { StatusMessage } from '@study/ui/status-message';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

import { selectionOptions, noteGenerationsOptions, threadOptions } from './note-workspace.queries';

/** Retiring an attempt never changes or replays its captured payload. */
export function UnavailableAttempt({
  id,
  busy,
  onAbandon
}: {
  id: NoteId;
  busy: boolean;
  onAbandon: () => void;
}) {
  const { t } = useI18n();
  const client = useQueryClient();
  const [review, setReview] = useState<'idle' | 'pending' | 'ready' | 'failed'>('idle');

  return (
    <Notebook.AttemptRecovery aria-label={t('NoteAttemptUnavailable')}>
      <StatusMessage>{t('NoteAttemptUnavailable')}</StatusMessage>
      <Notebook.Muted>{t('NoteAbandonAttemptHelp')}</Notebook.Muted>
      <Button
        variant="outline"
        disabled={busy || review === 'pending'}
        onClick={async () => {
          setReview('pending');

          try {
            await Promise.all([
              client.fetchQuery({ ...selectionOptions(id), staleTime: 0 }),
              client.fetchInfiniteQuery({ ...threadOptions(id), staleTime: 0 }),
              client.fetchInfiniteQuery({ ...noteGenerationsOptions(id), staleTime: 0 })
            ]);
            setReview('ready');
          } catch {
            setReview('failed');
          }
        }}
      >
        {t('NoteReviewUnavailableAttempt')}
      </Button>
      {review === 'failed' && (
        <ErrorState title={t('ErrorStateTitle')} description={<> {t('NoteReadError')} </>} />
      )}
      {review === 'ready' && (
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            if (!busy) onAbandon();
          }}
        >
          {t('NoteAbandonAttempt')}
        </Button>
      )}
    </Notebook.AttemptRecovery>
  );
}
