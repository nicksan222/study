import type {
  agentProgressInputSchema,
  agentProgressPageSchema
} from '@study/contracts/ai/progress';
import { useEffect, useState } from 'react';

import { subscribe } from '#client/lib/study-client/subscriptions.ts';

type Progress = typeof agentProgressPageSchema.Type;

/** Snapshots replace previews, so reconnects and activity retries cannot duplicate text. */
export function useAgentProgress(input: typeof agentProgressInputSchema.Type) {
  const executionId = 'executionId' in input ? input.executionId : undefined;
  const correlationId = 'correlationId' in input ? input.correlationId : undefined;
  const key = executionId ? `execution:${executionId}` : `request:${correlationId}`;
  const [state, setState] = useState<{
    key: string;
    runs: Progress;
  }>({
    key,
    runs: []
  });

  useEffect(() => {
    const controller = new AbortController();
    const target = executionId ? { executionId } : { correlationId: correlationId! };

    void subscribe(
      (client) => client['workflows.subscribeAgentProgress'](target),
      (runs) => {
        if (!controller.signal.aborted) setState({ key, runs });
      },
      controller.signal
    ).catch(() => undefined);

    return () => controller.abort();
  }, [executionId, correlationId, key]);

  return state.key === key ? state : { key, runs: [] };
}
