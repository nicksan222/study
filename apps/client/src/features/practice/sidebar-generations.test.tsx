import {
  StudyError,
  projectIdSchema,
  materialGenerationSnapshotSchema,
  executionIdSchema
} from '@study/contracts';
import type { executionSchema } from '@study/contracts';
import type { StudyClient } from '@study/contracts/react/testing';
import { catalogs } from '@study/localization';
import { test } from '@study/testing';
import { Effect, Schema } from 'effect';

import { PracticeSidebarGenerations } from './sidebar-generations';

const en = catalogs.english;

const project = Schema.decodeUnknownSync(projectIdSchema)(1n);

const generation = Schema.decodeUnknownSync(materialGenerationSnapshotSchema)({
  id: 'quiz-request',
  projectId: project,
  title: 'Cell division quiz',
  kind: 'quiz',
  inputs: [{ kind: 'page', versionId: 8n }],
  cancelled: false,
  errorKind: null,
  resultVersionId: null
});

function mount(
  {
    vi,
    rpcHandlersTransport,
    render
  }: Pick<test.Context, 'vi' | 'rpcHandlersTransport' | 'render'>,
  fail = false,
  failed = false
) {
  const current = failed ? { ...generation, errorKind: 'invalid_input' as const } : generation;
  let executions: readonly (typeof executionSchema.Type)[] = [];
  let active = true;
  const stop = vi.fn<StudyClient['materials.cancelMaterialGeneration']>().mockImplementation(() => {
    if (fail) return Effect.fail(new StudyError('transient', 'Offline'));

    active = false;

    return Effect.succeed({ ...generation, cancelled: true });
  });
  const list = vi
    .fn<StudyClient['materials.activeMaterialGenerations']>()
    .mockImplementation(() => Effect.succeed(active ? [current] : []));
  const retry = vi
    .fn<StudyClient['materials.retryMaterialGeneration']>()
    .mockImplementation(() => Effect.succeed(current));
  const runs = vi
    .fn<StudyClient['workflows.executions']>()
    .mockImplementation(() => Effect.succeed({ items: executions, next: null }));
  const rpc = {
    'materials.retryMaterialGeneration': retry,
    'workflows.executions': runs,
    'workflows.agentProgress': () => Effect.succeed([]),
    'materials.activeMaterialGenerations': list,
    'materials.cancelMaterialGeneration': stop
  };

  const fixture = rpcHandlersTransport(rpc);

  const mounted = render(
    <PracticeSidebarGenerations project={project} subjects={[]} query="" enabled />,
    {
      wrapper: fixture.wrapper
    }
  );

  return {
    mounted,
    stop,
    list,
    retry,
    runs,
    notify: fixture.notify,
    setExecutions: (items: typeof executions) => {
      executions = items;
    }
  };
}

test.stable(
  'recovers a running request and stops it from its sidebar card',
  async ({ userEvent, expect, screen, waitFor, vi, rpcHandlersTransport, render }) => {
    const user = userEvent.setup();
    const { stop, list } = mount({ vi, rpcHandlersTransport, render });

    expect(await screen.findByText(generation.title)).toBeVisible();
    expect(list).toHaveBeenCalledWith({ projectId: project });
    await user.click(screen.getByRole('button', { name: 'Stop generating Cell division quiz' }));
    await waitFor(() => expect(stop).toHaveBeenCalledWith({ requestId: generation.id }));
    await waitFor(() => expect(screen.queryByText(generation.title)).not.toBeInTheDocument());
  }
);

test.stable(
  'keeps a failed stop visible and offers the stop again in its context menu',
  async ({ userEvent, screen, expect, vi, rpcHandlersTransport, render }) => {
    const user = userEvent.setup();

    mount({ vi, rpcHandlersTransport, render }, true);
    await user.click(
      await screen.findByRole('button', { name: 'Stop generating Cell division quiz' })
    );
    expect(
      await screen.findByRole('status', { name: en.PracticeGenerationStopStatus })
    ).toBeVisible();
    expect(screen.getByText(generation.title)).toBeVisible();
    await user.pointer({ target: screen.getByText(generation.title), keys: '[MouseRight]' });
    expect(
      await screen.findByRole('menuitem', { name: en.PracticeGenerationStopAction })
    ).toBeEnabled();
  }
);

test.stable(
  'replaces a failed stop with the current retry status',
  async ({ userEvent, screen, expect, vi, rpcHandlersTransport, render }) => {
    const user = userEvent.setup();

    mount({ vi, rpcHandlersTransport, render }, true, true);

    await user.click(
      await screen.findByRole('button', { name: 'Stop generating Cell division quiz' })
    );
    await screen.findByRole('status', { name: en.PracticeGenerationStopStatus });
    await user.click(screen.getByRole('button', { name: en.Retry }));

    expect(
      await screen.findByRole('status', { name: en.PracticeGenerationRetrying })
    ).toBeVisible();
    expect(
      screen.queryByRole('status', { name: en.PracticeGenerationStopStatus })
    ).not.toBeInTheDocument();
  }
);

test.stable(
  'retains failed work with recovery actions and keeps history out of the sidebar',
  async ({ expect, screen, vi, rpcHandlersTransport, render }) => {
    mount({ vi, rpcHandlersTransport, render }, false, true);
    expect(await screen.findByText(generation.title)).toBeVisible();
    expect(
      await screen.findByRole('status', { name: en.PracticeGenerationFailedStatus })
    ).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: en.Retry })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Stop generating Cell division quiz' })
    ).toBeEnabled();
    expect(screen.queryByLabelText(en.AgentActivitySteps)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: en.PracticeGenerationRunning })
    ).not.toBeInTheDocument();
  }
);

test.stable(
  'reuses an uncertain retry identity and waits for that exact admitted attempt',
  async ({ userEvent, screen, expect, waitFor, vi, rpcHandlersTransport, render }) => {
    const user = userEvent.setup();
    const fixture = mount({ vi, rpcHandlersTransport, render }, false, true);

    fixture.retry.mockImplementationOnce(() =>
      Effect.fail(new StudyError('transient', 'Lost receipt'))
    );
    await user.click(await screen.findByRole('button', { name: en.Retry }));
    expect(
      await screen.findByRole('status', { name: en.PracticeGenerationRetryStatus })
    ).toBeVisible();
    const first = fixture.retry.mock.calls[0]![0];

    await waitFor(() =>
      expect(fixture.runs).toHaveBeenCalledWith({
        correlationId: generation.id,
        eventId: first.retryId,
        limit: 30
      })
    );
    await user.click(screen.getByRole('button', { name: en.Retry }));
    await waitFor(() => expect(fixture.retry).toHaveBeenCalledTimes(2));
    expect(fixture.retry.mock.calls[1]![0]).toEqual(first);
    expect(screen.queryByRole('button', { name: en.Retry })).not.toBeInTheDocument();
    fixture.setExecutions([
      {
        id: executionIdSchema.make('retry-run'),
        workflow: 'material-generation/v1',
        correlationId: generation.id,
        status: 'completed',
        outcome: 'failure',
        failureKind: 'invalid_input',
        configurationWaitReason: null,
        canCancel: false,
        createdAtMs: 1n,
        updatedAtMs: 2n
      }
    ]);
    await fixture.notify();
    await waitFor(() => expect(screen.getByRole('button', { name: en.Retry })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: en.Retry }));
    await waitFor(() => expect(fixture.retry).toHaveBeenCalledTimes(3));
    expect(fixture.retry.mock.calls[2]![0].retryId).not.toBe(first.retryId);
  }
);

test.stable(
  'recovers a lost retry receipt after remount without creating another attempt',
  async ({ userEvent, screen, expect, vi, rpcHandlersTransport, render }) => {
    const user = userEvent.setup();
    const fixture = mount({ vi, rpcHandlersTransport, render }, false, true);

    fixture.retry.mockImplementationOnce(() =>
      Effect.fail(new StudyError('transient', 'Lost receipt'))
    );
    await user.click(await screen.findByRole('button', { name: en.Retry }));
    await screen.findByRole('status', { name: en.PracticeGenerationRetryStatus });
    const first = fixture.retry.mock.calls[0]![0];

    fixture.mounted.rerender(<></>);
    fixture.setExecutions([
      {
        id: executionIdSchema.make('admitted-retry'),
        workflow: 'material-generation/v1',
        correlationId: generation.id,
        status: 'running',
        outcome: null,
        failureKind: null,
        configurationWaitReason: null,
        canCancel: true,
        createdAtMs: 1n,
        updatedAtMs: 2n
      }
    ]);
    fixture.mounted.rerender(
      <PracticeSidebarGenerations project={project} subjects={[]} query="" enabled />
    );
    await fixture.notify();
    await screen.findByRole('status', { name: en.PracticeGenerationRetrying });
    expect(screen.queryByRole('button', { name: en.Retry })).not.toBeInTheDocument();
    expect(fixture.runs).toHaveBeenCalledWith({
      correlationId: generation.id,
      eventId: first.retryId,
      limit: 30
    });
    expect(fixture.retry).toHaveBeenCalledTimes(1);
  }
);

test.stable(
  'preserves a newer uncertain retry when an older receipt arrives after remount',
  async ({ userEvent, screen, waitFor, expect, act, vi, rpcHandlersTransport, render }) => {
    const user = userEvent.setup();
    const fixture = mount({ vi, rpcHandlersTransport, render }, false, true);
    const receipt = Promise.withResolvers<typeof generation>();

    fixture.retry.mockImplementationOnce(() => Effect.promise(() => receipt.promise));
    await user.click(await screen.findByRole('button', { name: en.Retry }));
    await waitFor(() => expect(fixture.retry).toHaveBeenCalledTimes(1));
    const first = fixture.retry.mock.calls[0]![0];

    fixture.runs.mockImplementation(({ eventId }) =>
      Effect.succeed({
        items:
          eventId === first.retryId
            ? [
                {
                  id: executionIdSchema.make('older-failed-retry'),
                  workflow: 'material-generation/v1',
                  correlationId: generation.id,
                  status: 'completed',
                  outcome: 'failure',
                  failureKind: 'invalid_input',
                  configurationWaitReason: null,
                  canCancel: false,
                  createdAtMs: 1n,
                  updatedAtMs: 2n
                }
              ]
            : [],
        next: null
      })
    );
    fixture.mounted.rerender(<></>);
    fixture.mounted.rerender(
      <PracticeSidebarGenerations project={project} subjects={[]} query="" enabled />
    );
    await fixture.notify();
    fixture.retry.mockImplementationOnce(() =>
      Effect.fail(new StudyError('transient', 'Lost newer receipt'))
    );
    await user.click(await screen.findByRole('button', { name: en.Retry }));
    await screen.findByRole('status', { name: en.PracticeGenerationRetryStatus });
    const second = fixture.retry.mock.calls[1]![0];

    expect(second.retryId).not.toBe(first.retryId);
    await act(async () => {
      receipt.resolve(generation);
      await receipt.promise;
    });
    await user.click(await screen.findByRole('button', { name: en.Retry }));
    await waitFor(() => expect(fixture.retry).toHaveBeenCalledTimes(3));
    expect(fixture.retry.mock.calls[2]![0]).toEqual(second);
  }
);

test.stable(
  'opens work details on demand from the current status context menu',
  async ({ userEvent, screen, expect, within, waitFor, vi, rpcHandlersTransport, render }) => {
    const user = userEvent.setup();

    mount({ vi, rpcHandlersTransport, render });
    const status = await screen.findByRole('status', { name: en.PracticeGenerationRunning });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.pointer({ target: status, keys: '[MouseRight]' });
    await user.click(await screen.findByRole('menuitem', { name: en.AgentActivityDetails }));
    const dialog = await screen.findByRole('dialog', { name: en.AgentActivityDetails });

    expect(within(dialog).getByText(en.AgentActivityWaiting)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: en.Close }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status', { name: en.PracticeGenerationRunning })).toBeVisible();
  }
);
