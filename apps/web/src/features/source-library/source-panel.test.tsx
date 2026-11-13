import { StudyError } from '@study/contracts/errors';
import { sourceIdSchema, contentSnapshotIdSchema, noteIdSchema } from '@study/contracts/ids';
import { executionIdSchema, type executionSchema } from '@study/contracts/workflows/schemas';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, screen, waitFor } from '@testing-library/react';
import { Effect } from 'effect';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, vi } from 'vite-plus/test';

import { runRequest } from '#web/lib/effect/runtime.ts';
import type { StudyClient } from '#web/lib/study-client/client.ts';
import { toStudyError } from '#web/lib/study-client/errors.ts';
import { request } from '#web/lib/study-client/request.ts';

import { authoredPage } from '../document-editing/test-support';
import { importedSource, materialRpc, mountLibraryRoute } from '../material-library/test/support';
import { sourceProcessingExecutionOptions, useSourceCopy } from './source-panel.queries';

const rpc = vi.hoisted(() => ({
  copy: vi.fn<StudyClient['pages.copySource']>(),
  processing: vi.fn<StudyClient['sources.sourceProcessing']>(),
  executions: vi.fn<StudyClient['workflows.executions']>()
}));

vi.mock('#web/lib/study-client/request.ts', () => ({ request: vi.fn() }));

beforeEach(() => {
  vi.mocked(request).mockImplementation((invoke, signal) =>
    runRequest(
      invoke({
        'pages.copySource': rpc.copy,
        'sources.sourceProcessing': rpc.processing,
        'workflows.executions': rpc.executions
      } as unknown as StudyClient).pipe(Effect.mapError(toStudyError)),
      signal
    )
  );
});

afterEach(() => {
  cleanup();
  processingCache.clear();
  vi.resetAllMocks();
});

testStable(
  'recovers the exact source copy receipt after remount and a newer source revision',
  async () => {
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const source = sourceIdSchema.make(7n),
      note = noteIdSchema.make(8n);
    const exact = {
      name: 'Original extraction',
      revision: 1n,
      snapshotId: contentSnapshotIdSchema.make(11n)
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    );

    rpc.copy
      .mockReturnValueOnce(Effect.fail(new StudyError('transient', 'Lost copy response')))
      .mockReturnValueOnce(Effect.succeed(authoredPage(20n)));
    const first = renderHook(() => useSourceCopy(source, note), { wrapper });

    await act(async () => {
      await first.result.current.copy(exact);
    });
    const attempt = rpc.copy.mock.calls[0]![0];

    expect(attempt).toEqual({
      sourceId: source,
      noteId: note,
      title: exact.name,
      revision: 1n,
      snapshotId: 11n,
      createKey: expect.any(String)
    });
    act(() => first.result.current.acknowledge());
    expect(cache.getQueryData(['source-copy', String(source), String(note)])).toMatchObject({
      input: attempt
    });
    first.unmount();
    const reopened = renderHook(() => useSourceCopy(source, note), { wrapper });

    await act(async () => {
      await reopened.result.current.copy({
        name: 'Replacement',
        revision: 2n,
        snapshotId: contentSnapshotIdSchema.make(12n)
      });
    });
    expect(rpc.copy.mock.calls[1]![0]).toEqual(attempt);
    await waitFor(() => expect(reopened.result.current.page?.id).toBe(20n));
    await act(async () => {
      await reopened.result.current.copy(exact);
    });
    expect(rpc.copy).toHaveBeenCalledTimes(2);
    act(() => reopened.result.current.acknowledge());
    rpc.copy.mockReturnValueOnce(Effect.succeed(authoredPage(21n)));
    await act(async () => {
      await reopened.result.current.copy({
        name: 'Replacement',
        revision: 2n,
        snapshotId: contentSnapshotIdSchema.make(12n)
      });
    });
    expect(rpc.copy.mock.calls[2]![0]).toMatchObject({ revision: 2n, snapshotId: 12n });
    expect(rpc.copy.mock.calls[2]![0].createKey).not.toBe(attempt.createKey);
    await waitFor(() => expect(reopened.result.current.page?.id).toBe(21n));
    reopened.unmount();
    cache.clear();
  }
);

const source = sourceIdSchema.make(7n);

function execution(
  overrides: Partial<typeof executionSchema.Type> = {}
): typeof executionSchema.Type {
  return {
    id: executionIdSchema.make('ingestion'),
    workflow: 'source-ingestion/v1',
    correlationId: 'request-1',
    status: 'completed',
    outcome: 'failure',
    failureKind: 'unsupported',
    configurationWaitReason: null,
    canCancel: false,
    createdAtMs: 10n,
    updatedAtMs: 11n,
    ...overrides
  };
}

function processing(requestId: string | null) {
  return Effect.succeed({ sourceId: source, revision: 1, requestId, documentId: null });
}

const processingOptions = sourceProcessingExecutionOptions(source);

const processingCache = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function fetchProcessing(signal = new AbortController().signal) {
  return processingCache.fetchQuery({
    ...processingOptions,
    queryFn: (context) => processingOptions.queryFn!({ ...context, signal })
  });
}

testStable(
  'pages past unrelated wakes and rereads the current request for ingestion and correction',
  async () => {
    const cursor = { id: executionIdSchema.make('wake'), createdAtMs: 20n };
    const wake = execution({
      id: cursor.id,
      workflow: 'conversation-attachment-wake/v1',
      outcome: 'success',
      failureKind: null
    });
    const signal = new AbortController().signal;

    for (const [requestId, workflow] of [
      ['request-1', 'source-ingestion/v1'],
      ['request-2', 'source-correction/v1']
    ] as const) {
      const match = execution({ correlationId: requestId, workflow });

      rpc.processing.mockReturnValueOnce(processing(requestId));
      rpc.executions
        .mockReturnValueOnce(
          Effect.succeed({
            items: [{ ...wake, correlationId: requestId }],
            next: cursor
          })
        )
        .mockReturnValueOnce(Effect.succeed({ items: [match], next: null }));
      expect(await fetchProcessing(signal)).toEqual(match);
      expect(rpc.executions.mock.calls.slice(-2).map(([input]) => input)).toEqual([
        { correlationId: requestId, limit: 100, before: undefined },
        { correlationId: requestId, limit: 100, before: cursor }
      ]);
    }
    expect(rpc.processing).toHaveBeenCalledTimes(2);
    expect(rpc.processing.mock.calls.map(([input]) => input)).toEqual([
      { id: source },
      { id: source }
    ]);
    expect(vi.mocked(request).mock.calls).toHaveLength(6);
    expect(vi.mocked(request).mock.calls.every(([, passed]) => passed === signal)).toBe(true);
  }
);

testStable('missing requests and exhausted unrelated pages remain pending', async () => {
  rpc.processing.mockReturnValueOnce(processing(null));
  expect(await fetchProcessing()).toBeNull();
  expect(rpc.executions).not.toHaveBeenCalled();
  rpc.processing.mockReturnValueOnce(processing('request-1'));
  rpc.executions.mockReturnValueOnce(
    Effect.succeed({
      items: [execution({ workflow: 'conversation-attachment-wake/v1' })],
      next: null
    })
  );
  expect(await fetchProcessing()).toBeNull();
  expect(rpc.executions).toHaveBeenCalledTimes(1);
});

testStable(
  'propagates processing and later-page errors and cancellation without a false outcome',
  async () => {
    rpc.processing.mockReturnValueOnce(
      Effect.fail(new StudyError('transient', 'Processing unavailable'))
    );
    await expect(fetchProcessing()).rejects.toThrow('Processing unavailable');
    expect(rpc.executions).not.toHaveBeenCalled();

    const cursor = { id: executionIdSchema.make('wake'), createdAtMs: 20n };
    rpc.processing.mockReturnValueOnce(processing('request-1'));
    rpc.executions
      .mockReturnValueOnce(Effect.succeed({ items: [], next: cursor }))
      .mockReturnValueOnce(Effect.fail(new StudyError('transient', 'Second page unavailable')));
    await expect(fetchProcessing()).rejects.toThrow('Second page unavailable');

    const controller = new AbortController();
    let entered!: () => void;
    const laterPage = new Promise<void>((resolve) => {
      entered = resolve;
    });

    rpc.processing.mockReturnValueOnce(processing('request-2'));
    rpc.executions
      .mockReturnValueOnce(Effect.succeed({ items: [], next: cursor }))
      .mockReturnValueOnce(Effect.sync(entered).pipe(Effect.andThen(Effect.never)));
    const pending = fetchProcessing(controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    await laterPage;
    controller.abort();
    await rejected;
    expect(
      vi
        .mocked(request)
        .mock.calls.slice(-3)
        .every(([, signal]) => signal === controller.signal)
    ).toBe(true);
  }
);

testStable(
  'renders canonical failure and configuration waits, then recovers to extracted content',
  async () => {
    const copy = catalogs.english;

    for (const [overrides, label] of [
      [{ failureKind: 'unsupported' }, copy.SourceExtractionUnsupported],
      [{ failureKind: 'internal' }, copy.SourceExtractionFailed],
      [{ status: 'cancelled', failureKind: 'cancelled' }, copy.SourceExtractionFailed],
      ...(['auth', 'config', 'model_unavailable'] as const).map(
        (reason) =>
          [
            {
              status: 'suspended',
              outcome: null,
              failureKind: null,
              configurationWaitReason: reason
            },
            reason === 'auth'
              ? copy.NoteWaitAuth
              : reason === 'config'
                ? copy.NoteWaitConfig
                : copy.NoteWaitModel
          ] as const
      )
    ] as const) {
      const client = {
        ...materialRpc(),
        'sources.sourceProcessing': rpc.processing,
        'workflows.executions': rpc.executions
      };
      rpc.processing.mockReturnValue(processing('request-1'));
      rpc.executions.mockReturnValue(Effect.succeed({ items: [execution(overrides)], next: null }));
      client['sources.currentExtraction'].mockReturnValue(Effect.succeed(null));
      const view = mountLibraryRoute('/sources/7', client);

      try {
        expect(await screen.findByText(label)).toBeInTheDocument();
        expect(screen.queryByText(copy.NotePending)).toBeNull();
        if ('configurationWaitReason' in overrides)
          expect(screen.getByRole('link', { name: copy.Settings })).toHaveAttribute(
            'href',
            '/settings'
          );

        rpc.processing.mockReturnValue(processing(null));
        await act(async () => {
          await view.queryClient.invalidateQueries({
            queryKey: ['sources', 'processing-execution']
          });
        });
        expect(await screen.findByText(copy.NotePending)).toBeInTheDocument();
        expect(screen.queryByText(label)).toBeNull();
        client['sources.currentExtraction'].mockReturnValue(
          client['sources.extraction']({
            sourceId: importedSource.id,
            revision: 1n,
            snapshotId: contentSnapshotIdSchema.make(101n)
          })
        );
        await act(async () => {
          await view.queryClient.invalidateQueries({ queryKey: ['sources', 'current-extraction'] });
        });
        expect(await screen.findByText('Historical extraction')).toBeInTheDocument();
        expect(screen.queryByText(copy.NotePending)).toBeNull();
      } finally {
        view.unmount();
        view.queryClient.clear();
      }
    }
  }
);
