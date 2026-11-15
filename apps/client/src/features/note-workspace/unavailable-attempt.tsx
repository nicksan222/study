import type { NoteId } from '@study/contracts/ids';
import { rpc } from '@study/contracts/react';
import { Button } from '@study/ui/button';
import { ErrorState } from '@study/ui/error-state';
import { Notebook } from '@study/ui/note-workspace';
import { StatusMessage } from '@study/ui/status-message';
import { useState } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';

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
              rpc.notes.noteSelection.read({ noteId: id }),
              rpc.notes.thread.read({ noteId: id, limit: 30 }),
              rpc.notes.noteGenerations.read({ noteId: id, limit: 30 })
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
