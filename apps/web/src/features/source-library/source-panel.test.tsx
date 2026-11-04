import { StudyError } from '@study/contracts/errors';
import { sourceIdSchema, contentSnapshotIdSchema, sessionIdSchema } from '@study/contracts/ids';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, vi } from 'vite-plus/test';

import { authoredDocument } from '../document-editing/test-support';
import { useSourceCopy } from './source-panel.queries';

const rpc = vi.hoisted(() => ({ copy: vi.fn() }));
vi.mock('#web/lib/study-client/request.ts', () => ({
  request: (invoke: (client: Record<string, unknown>) => unknown) =>
    invoke({ 'documents.copySource': rpc.copy })
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

testStable(
  'recovers the exact source copy receipt after remount and a newer source revision',
  async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const source = sourceIdSchema.make(7n),
      session = sessionIdSchema.make(8n);
    const exact = {
      name: 'Original extraction',
      revision: 1n,
      snapshotId: contentSnapshotIdSchema.make(11n)
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    );
    rpc.copy
      .mockRejectedValueOnce(new StudyError('transient', 'Lost copy response'))
      .mockResolvedValueOnce(authoredDocument(20n));
    const first = renderHook(() => useSourceCopy(source, session), { wrapper });
    await act(async () => {
      await first.result.current.copy(exact);
    });
    const attempt = rpc.copy.mock.calls[0]![0];
    expect(attempt).toEqual({
      sourceId: source,
      sessionId: session,
      title: exact.name,
      revision: 1n,
      snapshotId: 11n,
      createKey: expect.any(String)
    });
    act(() => first.result.current.acknowledge());
    expect(cache.getQueryData(['source-copy', String(source), String(session)])).toMatchObject({
      input: attempt
    });
    first.unmount();
    const reopened = renderHook(() => useSourceCopy(source, session), { wrapper });
    await act(async () => {
      await reopened.result.current.copy({
        name: 'Replacement',
        revision: 2n,
        snapshotId: contentSnapshotIdSchema.make(12n)
      });
    });
    expect(rpc.copy.mock.calls[1]![0]).toEqual(attempt);
    await waitFor(() => expect(reopened.result.current.document?.id).toBe(20n));
    await act(async () => {
      await reopened.result.current.copy(exact);
    });
    expect(rpc.copy).toHaveBeenCalledTimes(2);
    act(() => reopened.result.current.acknowledge());
    rpc.copy.mockResolvedValueOnce(authoredDocument(21n));
    await act(async () => {
      await reopened.result.current.copy({
        name: 'Replacement',
        revision: 2n,
        snapshotId: contentSnapshotIdSchema.make(12n)
      });
    });
    expect(rpc.copy.mock.calls[2]![0]).toMatchObject({ revision: 2n, snapshotId: 12n });
    expect(rpc.copy.mock.calls[2]![0].createKey).not.toBe(attempt.createKey);
    await waitFor(() => expect(reopened.result.current.document?.id).toBe(21n));
    reopened.unmount();
    cache.clear();
  }
);
