import type {
  agentProgressInputSchema,
  agentProgressPageSchema
} from '@study/contracts/ai/progress';
import { useEffect, useState } from 'react';

import { subscribe } from '#web/lib/study-client/subscriptions.ts';

type Progress = typeof agentProgressPageSchema.Type;

/** Snapshots replace previews, so reconnects and activity retries cannot duplicate text. */
export function useAgentProgress(input: typeof agentProgressInputSchema.Type) {
  const [attempt, setAttempt] = useState(0);
  const executionId = 'executionId' in input ? input.executionId : undefined;
  const correlationId = 'correlationId' in input ? input.correlationId : undefined;
  const key = executionId ? `execution:${executionId}` : `request:${correlationId}`;
  const [state, setState] = useState<{
    key: string;
    runs: Progress;
    connection: 'connected' | 'reconnecting' | 'unavailable';
  }>({
    key,
    runs: [],
    connection: 'connected'
  });

  useEffect(() => {
    const controller = new AbortController();
    const target = executionId ? { executionId } : { correlationId: correlationId! };
    const failed = (connection: 'reconnecting' | 'unavailable') => {
      if (!controller.signal.aborted) setState({ key, runs: [], connection });
    };

    void subscribe(
      (client) => client['workflows.subscribeAgentProgress'](target),
      (runs) => {
        if (!controller.signal.aborted) setState({ key, runs, connection: 'connected' });
      },
      controller.signal,
      () => failed('reconnecting')
    ).catch(() => failed('unavailable'));

    return () => controller.abort();
  }, [executionId, correlationId, key, attempt]);

  return {
    ...(state.key === key ? state : { key, runs: [], connection: 'connected' as const }),
    reconnect: () => setAttempt((value) => value + 1)
  };
}
