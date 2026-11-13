import { RetryButton } from '@study/ui/action-button';
import { ErrorState } from '@study/ui/error-state';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, useEffect, useRef, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '#client/lib/i18n.tsx';
import { serverConnection } from '#client/lib/study-client/connection.ts';

import { serverConnectionQueryOptions } from './server-connection.queries';

/** One endpoint outage screen preserves the mounted application and never replays writes. */
export function ServerConnection({
  children,
  onReconnect
}: {
  children: ReactNode;
  onReconnect: () => void;
}) {
  const { t } = useI18n();
  const cache = useQueryClient();
  const state = useSyncExternalStore(serverConnection.subscribe, serverConnection.snapshot);
  const previous = useRef(state.connected);
  const health = useQuery({
    ...serverConnectionQueryOptions(),
    retry: false,
    gcTime: 0,
    refetchInterval: state.connected ? 15_000 : 2000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: 'always'
  });

  const { refetch } = health;

  useEffect(() => {
    if (!state.connected) void refetch();
  }, [state.connected, refetch]);

  useEffect(() => {
    const recovered = state.connected && !previous.current;

    previous.current = state.connected;

    if (!recovered) return;

    // Client-only draft queries must never rerun their initializers on reconnection.
    void cache.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] !== 'server-connection' && query.state.status === 'error'
    });
    onReconnect();
  }, [cache, state.connected, onReconnect]);

  return (
    <>
      <Activity mode={state.connected ? 'visible' : 'hidden'}>{children}</Activity>
      {!state.connected && (
        <ErrorState
          layout="screen"
          title={t('ServerConnectionTitle')}
          description={t('ServerConnectionDescription')}
          action={
            <RetryButton
              label={t('ServerConnectionRetry')}
              aria-busy={health.isFetching}
              onClick={() => void health.refetch()}
            />
          }
        />
      )}
    </>
  );
}
