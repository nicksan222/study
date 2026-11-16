import {
  StudyError,
  sourceIdSchema,
  contentSnapshotIdSchema,
  noteIdSchema,
  executionIdSchema
} from '@study/contracts';
import type { executionSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { Effect } from 'effect';
import { useLayoutEffect } from 'react';
import { afterEach, expect, vi } from 'vite-plus/test';

import type { StudyClient } from '#client/test/rpc.tsx';
import { rpcHandlersTransport } from '#client/test/rpc.tsx';

import { authoredPage } from '../document-editing/test-support';
import { importedSource, materialRpc, mountLibraryRoute } from '../material-library/test/support';
import { useSourceProcessingExecution, useSourceCopy } from './source-panel.queries';

const source = sourceIdSchema.make(7n);

const rpc = {
  copy: vi.fn<StudyClient['pages.copySource']>(),
  processing: vi.fn<StudyClient['sources.sourceProcessing']>(),
  executions: vi.fn<StudyClient['workflows.executions']>()
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

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

testStable(
  'keeps an uncertain exact copy request across caller remount and newer source extraction',
  async () => {
    const note = noteIdSchema.make(8n);
    const harness = rpcHandlersTransport({ 'pages.copySource': rpc.copy });
    let current: ReturnType<typeof useSourceCopy> | undefined;

    function Probe() {
      const state = useSourceCopy(source, note);

      useLayoutEffect(() => {
        current = state;
      });

      return null;
    }

    function state() {
      if (!current) throw new Error('Copy view not mounted');

      return current;
    }

    const exact = {
      name: 'Original extraction',
      revision: 1n,
      snapshotId: contentSnapshotIdSchema.make(11n)
    };

    rpc.copy
      .mockReturnValueOnce(Effect.fail(new StudyError('transient', 'Lost copy response')))
      .mockReturnValueOnce(Effect.succeed(authoredPage(20n)));
    const view = render(
      <harness.wrapper>
        <Probe />
      </harness.wrapper>
    );

    await act(() => state().copy(exact));
    const attempt = rpc.copy.mock.calls[0]?.[0];

    expect(attempt).toMatchObject({
      sourceId: source,
      noteId: note,
      revision: 1n,
      snapshotId: 11n
    });
    act(() => state().acknowledge());
    view.rerender(<harness.wrapper>{null}</harness.wrapper>);
    view.rerender(
      <harness.wrapper>
        <Probe />
      </harness.wrapper>
    );
    await act(() =>
      state().copy({
        name: 'Replacement',
        revision: 2n,
        snapshotId: contentSnapshotIdSchema.make(12n)
      })
    );
    expect(rpc.copy.mock.calls[1]?.[0]).toEqual(attempt);
    await waitFor(() => expect(state().page?.id).toBe(20n));
    await act(() => state().copy(exact));
    expect(rpc.copy).toHaveBeenCalledTimes(2);
    act(() => state().acknowledge());
    rpc.copy.mockReturnValueOnce(Effect.succeed(authoredPage(21n)));
    await act(() =>
      state().copy({
        name: 'Replacement',
        revision: 2n,
        snapshotId: contentSnapshotIdSchema.make(12n)
      })
    );
    expect(rpc.copy.mock.calls[2]?.[0]).toMatchObject({ revision: 2n, snapshotId: 12n });
    expect(rpc.copy.mock.calls[2]?.[0].createKey).not.toBe(attempt?.createKey);
  }
);

testStable(
  'live processing follows the current request and never presents an unrelated workflow outcome',
  async () => {
    const harness = rpcHandlersTransport({
      'sources.sourceProcessing': rpc.processing,
      'workflows.executions': rpc.executions
    });

    rpc.processing.mockReturnValue(processing('request-1'));
    rpc.executions.mockReturnValue(
      Effect.succeed({
        items: [execution({ workflow: 'conversation-attachment-wake/v1' })],
        next: null
      })
    );
    const view = renderHook(() => useSourceProcessingExecution(source), {
      wrapper: harness.wrapper
    });

    await waitFor(() => expect(rpc.executions).toHaveBeenCalled());
    expect(view.result.current.data).toBeUndefined();
    rpc.executions.mockReturnValue(Effect.succeed({ items: [execution()], next: null }));
    await act(() => harness.notify());
    await waitFor(() => expect(view.result.current.data?.failureKind).toBe('unsupported'));
    rpc.processing.mockReturnValue(processing(null));
    await act(() => harness.notify());
    await waitFor(() => expect(view.result.current.data).toBeUndefined());
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
          await view.notify();
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
          await view.notify();
        });
        expect(await screen.findByText('Historical extraction')).toBeInTheDocument();
        expect(screen.queryByText(copy.NotePending)).toBeNull();
      } finally {
        view.unmount();
      }
    }
  }
);
