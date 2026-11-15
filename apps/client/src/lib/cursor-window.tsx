import { failureSchema } from '@study/contracts';
import { LoadMoreButton, Button } from '@study/ui';
import { Schema } from 'effect';
import { useCallback, useEffect, useState } from 'react';

import { useI18n } from './i18n';

/** Interaction state only: each window is read by its owning canonical live query. */
export function useCursorWindow<Cursor>(scope: string) {
  const initial: { scope: string; cursors: readonly (Cursor | undefined)[]; limit: number } = {
    scope,
    cursors: [undefined],
    limit: 30
  };
  const [stored, setStored] = useState(initial);
  const state = stored.scope === scope ? stored : initial;

  if (stored.scope !== scope) setStored(initial);

  function more(next: Cursor | null | undefined) {
    if (next === null || next === undefined) return;

    setStored((old) =>
      old.scope !== scope
        ? old
        : old.limit < 100
          ? { ...old, limit: Math.min(100, old.limit + 30) }
          : { ...old, cursors: [...old.cursors, next], limit: 30 }
    );
  }

  function previous() {
    setStored((old) =>
      old.scope !== scope || old.cursors.length < 2
        ? old
        : { ...old, cursors: old.cursors.slice(0, -1), limit: 30 }
    );
  }

  const reset = useCallback(() => {
    setStored((old) =>
      old.scope !== scope || old.cursors.length === 1
        ? old
        : { scope, cursors: [undefined], limit: 30 }
    );
  }, [scope]);

  return {
    cursor: state.cursors.at(-1),
    limit: state.limit,
    hasPrevious: state.cursors.length > 1,
    reset,
    previous,
    more
  };
}

/** A removed cursor anchor resets navigation while preserving the requested owner and filters. */
export function useCursorRecovery(
  window: { readonly cursor: unknown; readonly reset: () => void },
  error: unknown
) {
  const { cursor, reset } = window;

  useEffect(() => {
    if (
      cursor !== undefined &&
      Schema.is(failureSchema)(error) &&
      (error.kind === 'not_found' || error.kind === 'invalid_input')
    )
      reset();
  }, [cursor, error, reset]);
}

export function CursorWindowActions({
  hasPrevious,
  previous,
  more,
  hasMore,
  pending
}: {
  hasPrevious: boolean;
  previous: () => void;
  more: () => void;
  hasMore: boolean;
  pending: boolean;
}) {
  const { t } = useI18n();

  return (
    <>
      {hasPrevious && (
        <Button variant="ghost" disabled={pending} onClick={previous}>
          {t('LibraryPrevious')}
        </Button>
      )}
      {hasMore && (
        <LoadMoreButton
          variant="ghost"
          disabled={pending}
          onClick={more}
          label={t('LibraryMore')}
        />
      )}
    </>
  );
}
