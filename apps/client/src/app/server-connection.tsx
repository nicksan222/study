import { rpc } from '@study/contracts/react';
import { RetryButton, ErrorState } from '@study/ui';
import { Activity, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { reportServerConnected } from '#client/lib/host.ts';
import { useI18n } from '#client/lib/i18n.tsx';

/** One endpoint outage screen preserves the mounted application and never replays writes. */
export function ServerConnection({
  children,
  onReconnect,
  updateAction
}: {
  children: ReactNode;
  onReconnect: () => void;
  updateAction?: ReactNode;
}) {
  const { t } = useI18n();
  const health = rpc.system.health.useQuery({});
  const connected = !health.disconnected && !health.isError;
  const previous = useRef(connected);
  const reported = useRef(false);
  const healthy = connected && !health.stale && health.data?.workersRunning === true;

  useEffect(() => {
    if (healthy && !reported.current) {
      reported.current = true;
      reportServerConnected();
    }
  }, [healthy]);

  useEffect(() => {
    if (connected && !previous.current) onReconnect();

    previous.current = connected;
  }, [connected, onReconnect]);

  return (
    <>
      <Activity mode={connected ? 'visible' : 'hidden'}>{children}</Activity>
      {!connected && (
        <ErrorState
          layout="screen"
          title={t('ServerConnectionTitle')}
          description={t('ServerConnectionDescription')}
          action={
            <>
              <RetryButton
                label={t('ServerConnectionRetry')}
                aria-busy={health.isFetching}
                onClick={() => void health.refetch()}
              />
              {updateAction}
            </>
          }
        />
      )}
    </>
  );
}
