import {
  StudyError,
  sourceIdSchema,
  contentSnapshotIdSchema,
  noteIdSchema,
  executionIdSchema
} from '@study/contracts';
import type { executionSchema } from '@study/contracts';
import type { StudyClient } from '@study/contracts/react/testing';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Effect } from 'effect';
import { useLayoutEffect } from 'react';

import { authoredPage } from '../document-editing/test-support';
import { importedSource, materialRpc, mountLibraryRoute } from '../material-library/test/support';
import { useSourceProcessingExecution, useSourceCopy } from './source-panel.queries';

const source = sourceIdSchema.make(7n);

const rpc = {
  copy: test.vi.fn<StudyClient['pages.copySource']>(),
  processing: test.vi.fn<StudyClient['sources.sourceProcessing']>(),
  executions: test.vi.fn<StudyClient['workflows.executions']>()
};

test.afterEach(() => {
  test.cleanup();
  test.vi.resetAllMocks();
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

test.stable(
  'keeps an uncertain exact copy request across caller remount and newer source extraction',
  async () => {
    const note = noteIdSchema.make(8n);
    const harness = test.rpcHandlersTransport({ 'pages.copySource': rpc.copy });
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
    const view = test.render(
      <harness.wrapper>
        <Probe />
      </harness.wrapper>
    );

    await test.act(() => state().copy(exact));
    const attempt = rpc.copy.mock.calls[0]?.[0];

    test.expect(attempt).toMatchObject({
      sourceId: source,
      noteId: note,
      revision: 1n,
      snapshotId: 11n
    });
    test.act(() => state().acknowledge());
    view.rerender(<harness.wrapper>{null}</harness.wrapper>);
    view.rerender(
      <harness.wrapper>
        <Probe />
      </harness.wrapper>
    );
    await test.act(() =>
      state().copy({
        name: 'Replacement',
        revision: 2n,
        snapshotId: contentSnapshotIdSchema.make(12n)
      })
    );
    test.expect(rpc.copy.mock.calls[1]?.[0]).toEqual(attempt);
    await test.waitFor(() => test.expect(state().page?.id).toBe(20n));
    await test.act(() => state().copy(exact));
    test.expect(rpc.copy).toHaveBeenCalledTimes(2);
    test.act(() => state().acknowledge());
    rpc.copy.mockReturnValueOnce(Effect.succeed(authoredPage(21n)));
    await test.act(() =>
      state().copy({
        name: 'Replacement',
        revision: 2n,
        snapshotId: contentSnapshotIdSchema.make(12n)
      })
    );
    test.expect(rpc.copy.mock.calls[2]?.[0]).toMatchObject({ revision: 2n, snapshotId: 12n });
    test.expect(rpc.copy.mock.calls[2]?.[0].createKey).not.toBe(attempt?.createKey);
  }
);

test.stable(
  'live processing follows the current request and never presents an unrelated workflow outcome',
  async () => {
    const harness = test.rpcHandlersTransport({
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
    const view = test.renderHook(() => useSourceProcessingExecution(source), {
      wrapper: harness.wrapper
    });

    await test.waitFor(() => test.expect(rpc.executions).toHaveBeenCalled());
    test.expect(view.result.current.data).toBeUndefined();
    rpc.executions.mockReturnValue(Effect.succeed({ items: [execution()], next: null }));
    await test.act(() => harness.notify());
    await test.waitFor(() =>
      test.expect(view.result.current.data?.failureKind).toBe('unsupported')
    );
    rpc.processing.mockReturnValue(processing(null));
    await test.act(() => harness.notify());
    await test.waitFor(() => test.expect(view.result.current.data).toBeUndefined());
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
      label: catalogs.english.SourceExtractionFailed
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

test.stable.for(failureScenarios)(
  'renders canonical failure and configuration waits for %s, then recovers to extracted content',
  async ([_scenarioName, scenario]) => {
    const copy = catalogs.english;
    const { overrides, label } = scenario;
    const client = {
      ...materialRpc(),
      'sources.sourceProcessing': rpc.processing,
      'workflows.executions': rpc.executions
    };

    rpc.processing.mockReturnValue(processing('request-1'));
    rpc.executions.mockReturnValue(Effect.succeed({ items: [execution(overrides)], next: null }));
    client['sources.currentExtraction'].mockReturnValue(Effect.succeed(null));
    const view = mountLibraryRoute('/sources/7', client);

    test.expect(await test.screen.findByText(label)).toBeInTheDocument();
    test.expect(test.screen.queryByText(copy.NotePending)).toBeNull();

    if ('configurationWaitReason' in overrides)
      test
        .expect(test.screen.getByRole('link', { name: copy.Settings }))
        .toHaveAttribute('href', '/settings');

    rpc.processing.mockReturnValue(processing(null));
    await test.act(async () => {
      await view.notify();
    });
    test.expect(await test.screen.findByText(copy.NotePending)).toBeInTheDocument();
    test.expect(test.screen.queryByText(label)).toBeNull();
    client['sources.currentExtraction'].mockReturnValue(
      client['sources.extraction']({
        sourceId: importedSource.id,
        revision: 1n,
        snapshotId: contentSnapshotIdSchema.make(101n)
      })
    );
    await test.act(async () => {
      await view.notify();
    });
    test.expect(await test.screen.findByText('Historical extraction')).toBeInTheDocument();
    test.expect(test.screen.queryByText(copy.NotePending)).toBeNull();
  }
);
