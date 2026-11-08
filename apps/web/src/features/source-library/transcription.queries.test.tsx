import { sourceIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, vi } from 'vite-plus/test';

import { useSourceTranscription, useTranscriptionState } from './transcription.queries';

const rpc = vi.hoisted(() => ({
  processing: vi.fn(async () => ({ revision: 2, requestId: undefined as string | undefined })),
  executions: vi.fn(async (_input: { correlationId: string }) => ({ items: [] }))
}));

vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (invoke: (rpc: Record<string, unknown>) => unknown) =>
    invoke({
      'sources.sourceProcessing': rpc.processing,
      'workflows.executions': rpc.executions,
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

testStable(
  'execution polling follows the captured request and stops when it is absent',
  async () => {
    const id = sourceIdSchema.make(2n);
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const processing = ['source-transcription', String(id)];
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    );

    rpc.executions.mockClear();
    const hook = renderHook(() => useTranscriptionState(id), { wrapper });

    await waitFor(() => expect(cache.getQueryState(processing)?.status).toBe('success'));
    expect(rpc.executions).not.toHaveBeenCalled();
    await act(async () => {
      cache.setQueryData(processing, { revision: 2, requestId: 'first-request' });
    });
    await waitFor(() =>
      expect(rpc.executions).toHaveBeenCalledWith({
        correlationId: 'first-request',
        limit: 1
      })
    );
    await act(async () => {
      cache.setQueryData(processing, { revision: 3, requestId: 'next-request' });
    });
    await waitFor(() =>
      expect(rpc.executions).toHaveBeenCalledWith({
        correlationId: 'next-request',
        limit: 1
      })
    );
    await act(async () => {
      cache.setQueryData(processing, { revision: 4 });
    });
    await waitFor(() => expect(hook.result.current.active).toBe(false));
    const calls = rpc.executions.mock.calls.length;

    await act(async () => {
      await cache.invalidateQueries({ queryKey: ['source-transcription-execution', undefined] });
    });
    expect(rpc.executions).toHaveBeenCalledTimes(calls);
    hook.unmount();
    cache.clear();
  }
);
