import {
  StudyError,
  sourceIdSchema,
  contentSnapshotIdSchema,
  executionIdSchema
} from '@study/contracts';
import type { executionSchema } from '@study/contracts';
import type { StudyClient } from '@study/contracts/react/testing';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Deferred, Effect } from 'effect';
import { useLayoutEffect } from 'react';

import { authoredPage } from '../document-editing/test-support';
import { importedSource, materialRpc, mountLibraryRoute } from '../material-library/test/support';
import { useSourceProcessingExecution, useSourceCopy } from './source-panel.queries';
import { SourcePdfPreview } from './source-pdf-preview';

const source = sourceIdSchema.make(7n);

test.unit.stable(
  'shows loading, a missing PDF original and a recoverable original read error',
  async ({ act, expect, render, rpcHandlersTransport, screen, userEvent, vi }) => {
    const copy = catalogs.english;
    const read = await Effect.runPromise(Deferred.make<never, StudyError>());
    const sourceExport = vi
      .fn<StudyClient['sources.sourceExport']>()
      .mockReturnValueOnce(Deferred.await(read))
      .mockReturnValue(Effect.fail(new StudyError('transient', 'Original read interrupted')));
    const harness = rpcHandlersTransport({ 'sources.sourceExport': sourceExport });

    render(
      <harness.wrapper>
        <SourcePdfPreview sourceId={source} />
      </harness.wrapper>
    );
    expect(await screen.findByRole('status')).toHaveTextContent(copy.PdfLoading);
    await act(() =>
      Effect.runPromise(Deferred.fail(read, new StudyError('not_found', 'Original missing')))
    );
    expect(await screen.findByRole('alert', { name: copy.PdfMissing })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: copy.Retry }));
    expect(await screen.findByRole('alert', { name: copy.PdfFileReadFailed })).toBeInTheDocument();
  }
);

function createRpc({ vi }: Pick<test.unit.Context, 'vi'>) {
  return {
    copy: vi.fn<StudyClient['pages.copySource']>(),
    processing: vi.fn<StudyClient['sources.sourceProcessing']>(),
    executions: vi.fn<StudyClient['workflows.executions']>()
  };
}

let rpc: ReturnType<typeof createRpc>;

test.unit.afterEach(({ cleanup, vi }) => {
  cleanup();
  vi.resetAllMocks();
});

test.unit.beforeEach(({ vi }) => {
  rpc = createRpc({ vi });
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
  return Effect.succeed({
    sourceId: source,
    revision: 1,
    requestId,
    documentId: null,
    publishedRequestId: null,
    requestedAtMs: requestId ? 1 : null
  });
}

test.unit.stable(
  'keeps an uncertain exact copy request across caller remount and newer source extraction',
  async ({ rpcHandlersTransport, render, act, expect, waitFor }) => {
    const harness = rpcHandlersTransport({ 'pages.copySource': rpc.copy });
    let current: ReturnType<typeof useSourceCopy> | undefined;

    function Probe() {
      const state = useSourceCopy(source);

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
      revision: 1n,
      snapshotId: 11n
    });
    expect(attempt?.noteId).toBeUndefined();
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

test.unit.stable(
  'live processing follows the current request and never presents an unrelated workflow outcome',
  async ({ rpcHandlersTransport, renderHook, waitFor, expect, act }) => {
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
    rpc.processing.mockReturnValue(processing('request-2'));
    await act(() => harness.notify());
    await waitFor(() => expect(view.result.current.processing?.requestId).toBe('request-2'));
    expect(view.result.current.data).toBeUndefined();
  }
);

const failureScenarios = [
  [
    'unsupported',
    {
      overrides: { failureKind: 'unsupported' },
      label: catalogs.english.SourceExtractionUnsupported
    }
  ],
  [
    'internal',
    { overrides: { failureKind: 'internal' }, label: catalogs.english.SourceExtractionFailed }
  ],
  [
    'cancelled',
    {
      overrides: { status: 'cancelled', failureKind: 'cancelled' },
      label: catalogs.english.MaterialExtractionCancelled
    }
  ],
  ...(['auth', 'config', 'model_unavailable'] as const).map(
    (reason) =>
      [
        `${reason}-wait`,
        {
          overrides: {
            status: 'suspended',
            outcome: null,
            failureKind: null,
            configurationWaitReason: reason
          },
          label:
            reason === 'auth'
              ? catalogs.english.NoteWaitAuth
              : reason === 'config'
                ? catalogs.english.NoteWaitConfig
                : catalogs.english.NoteWaitModel
        }
      ] as const
  )
] as const;

test.unit.stable.for(failureScenarios)(
  'renders canonical failure and configuration waits for %s, then recovers to extracted content',
  async ([_scenarioName, scenario], { expect, screen, act, vi, render, rpcHandlersTransport }) => {
    const copy = catalogs.english;
    const { overrides, label } = scenario;
    const client = {
      ...materialRpc({ vi }),
      'sources.importCapability': () =>
        Effect.succeed({
          kind: 'text' as const,
          recognized: true,
          status: 'supported' as const,
          path: 'text' as const,
          reason: 'local_decoder' as const,
          provider: { authentication: 'signed_out' as const, capability: 'unverified' as const }
        }),
      'sources.sourceProcessing': rpc.processing,
      'workflows.executions': rpc.executions
    };

    rpc.processing.mockReturnValue(processing('request-1'));
    rpc.executions.mockReturnValue(Effect.succeed({ items: [execution(overrides)], next: null }));
    client['sources.currentExtraction'].mockReturnValue(Effect.succeed(null));
    const view = mountLibraryRoute({ render, rpcHandlersTransport, vi }, '/sources/7', client);

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
    expect(await screen.findByText(copy.MaterialExtractionIdle)).toBeInTheDocument();
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
  }
);
