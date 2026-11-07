import { sourceIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, vi } from 'vite-plus/test';

import { useSourceTranscription } from './transcription.queries';

vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (invoke: (rpc: Record<string, unknown>) => unknown) =>
    invoke({
      'sources.sourceProcessing': async () => ({ revision: 2 }),
      'sources.requestSourceProcessing': async () => ({ requestId: 'new-request' })
    })
}));
afterEach(cleanup);

testStable(
  'transcribing again invalidates the current extraction and processing state',
  async () => {
    const id = sourceIdSchema.make(1n);
    const cache = new QueryClient();
    const extraction = ['sources', 'current-extraction', String(id)];
    const processing = ['source-transcription', String(id)];

    cache.setQueryData(extraction, { snapshotId: 1n });
    cache.setQueryData(processing, { requestId: 'old-request' });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useSourceTranscription(id), { wrapper });

    await act(async () => {
      await hook.result.current.mutateAsync();
    });
    expect(cache.getQueryState(extraction)!.isInvalidated).toBe(true);
    expect(cache.getQueryState(processing)!.isInvalidated).toBe(true);
    cache.clear();
  }
);
