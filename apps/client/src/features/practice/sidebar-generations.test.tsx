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

function mount(fail = false, failed = false) {
  const current = failed ? { ...generation, errorKind: 'invalid_input' as const } : generation;
  let executions: readonly (typeof executionSchema.Type)[] = [];
  let active = true;
  const stop = test.vi
    .fn<StudyClient['materials.cancelMaterialGeneration']>()
    .mockImplementation(() => {
      if (fail) return Effect.fail(new StudyError('transient', 'Offline'));

      active = false;

      return Effect.succeed({ ...generation, cancelled: true });
    });
  const list = test.vi
    .fn<StudyClient['materials.activeMaterialGenerations']>()
    .mockImplementation(() => Effect.succeed(active ? [current] : []));
  const retry = test.vi
    .fn<StudyClient['materials.retryMaterialGeneration']>()
    .mockImplementation(() => Effect.succeed(current));
  const runs = test.vi
    .fn<StudyClient['workflows.executions']>()
    .mockImplementation(() => Effect.succeed({ items: executions, next: null }));
  const rpc = {
    'materials.retryMaterialGeneration': retry,
    'workflows.executions': runs,
    'workflows.agentProgress': () => Effect.succeed([]),
    'materials.activeMaterialGenerations': list,
    'materials.cancelMaterialGeneration': stop
  };

  const fixture = test.rpcHandlersTransport(rpc);

  const mounted = test.render(
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

test.stable('recovers a running request and stops it from its sidebar card', async () => {
  const user = test.userEvent.setup();
  const { stop, list } = mount();

  test.expect(await test.screen.findByText(generation.title)).toBeVisible();
  test.expect(list).toHaveBeenCalledWith({ projectId: project });
  await user.click(test.screen.getByRole('button', { name: 'Stop generating Cell division quiz' }));
  await test.waitFor(() => test.expect(stop).toHaveBeenCalledWith({ requestId: generation.id }));
  await test.waitFor(() =>
    test.expect(test.screen.queryByText(generation.title)).not.toBeInTheDocument()
  );
});

test.stable(
  'keeps a failed stop visible and offers the stop again in its context menu',
  async () => {
    const user = test.userEvent.setup();

    mount(true);
    await user.click(
      await test.screen.findByRole('button', { name: 'Stop generating Cell division quiz' })
    );
    test
      .expect(await test.screen.findByRole('status', { name: en.PracticeGenerationStopStatus }))
      .toBeVisible();
    test.expect(test.screen.getByText(generation.title)).toBeVisible();
    await user.pointer({ target: test.screen.getByText(generation.title), keys: '[MouseRight]' });
    test
      .expect(await test.screen.findByRole('menuitem', { name: en.PracticeGenerationStopAction }))
      .toBeEnabled();
  }
);

test.stable('replaces a failed stop with the current retry status', async () => {
  const user = test.userEvent.setup();

  mount(true, true);

  await user.click(
    await test.screen.findByRole('button', { name: 'Stop generating Cell division quiz' })
  );
  await test.screen.findByRole('status', { name: en.PracticeGenerationStopStatus });
  await user.click(test.screen.getByRole('button', { name: en.Retry }));

  test
    .expect(await test.screen.findByRole('status', { name: en.PracticeGenerationRetrying }))
    .toBeVisible();
  test
    .expect(test.screen.queryByRole('status', { name: en.PracticeGenerationStopStatus }))
    .not.toBeInTheDocument();
});

test.stable(
  'retains failed work with recovery actions and keeps history out of the sidebar',
  async () => {
    mount(false, true);
    test.expect(await test.screen.findByText(generation.title)).toBeVisible();
    test
      .expect(await test.screen.findByRole('status', { name: en.PracticeGenerationFailedStatus }))
      .toBeVisible();
    test.expect(test.screen.queryByRole('alert')).not.toBeInTheDocument();

    test.expect(test.screen.getByRole('button', { name: en.Retry })).toBeEnabled();
    test
      .expect(test.screen.getByRole('button', { name: 'Stop generating Cell division quiz' }))
      .toBeEnabled();
    test.expect(test.screen.queryByLabelText(en.AgentActivitySteps)).not.toBeInTheDocument();
    test
      .expect(test.screen.queryByRole('status', { name: en.PracticeGenerationRunning }))
      .not.toBeInTheDocument();
  }
);

test.stable(
  'reuses an uncertain retry identity and waits for that exact admitted attempt',
  async () => {
    const user = test.userEvent.setup();
    const fixture = mount(false, true);

    fixture.retry.mockImplementationOnce(() =>
      Effect.fail(new StudyError('transient', 'Lost receipt'))
    );
    await user.click(await test.screen.findByRole('button', { name: en.Retry }));
    test
      .expect(await test.screen.findByRole('status', { name: en.PracticeGenerationRetryStatus }))
      .toBeVisible();
    const first = fixture.retry.mock.calls[0]![0];

    await test.waitFor(() =>
      test.expect(fixture.runs).toHaveBeenCalledWith({
        correlationId: generation.id,
        eventId: first.retryId,
        limit: 30
      })
    );
    await user.click(test.screen.getByRole('button', { name: en.Retry }));
    await test.waitFor(() => test.expect(fixture.retry).toHaveBeenCalledTimes(2));
    test.expect(fixture.retry.mock.calls[1]![0]).toEqual(first);
    test.expect(test.screen.queryByRole('button', { name: en.Retry })).not.toBeInTheDocument();
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
    await test.waitFor(() =>
      test.expect(test.screen.getByRole('button', { name: en.Retry })).toBeEnabled()
    );
    await user.click(test.screen.getByRole('button', { name: en.Retry }));
    await test.waitFor(() => test.expect(fixture.retry).toHaveBeenCalledTimes(3));
    test.expect(fixture.retry.mock.calls[2]![0].retryId).not.toBe(first.retryId);
  }
);

test.stable(
  'recovers a lost retry receipt after remount without creating another attempt',
  async () => {
    const user = test.userEvent.setup();
    const fixture = mount(false, true);

    fixture.retry.mockImplementationOnce(() =>
      Effect.fail(new StudyError('transient', 'Lost receipt'))
    );
    await user.click(await test.screen.findByRole('button', { name: en.Retry }));
    await test.screen.findByRole('status', { name: en.PracticeGenerationRetryStatus });
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
    await test.screen.findByRole('status', { name: en.PracticeGenerationRetrying });
    test.expect(test.screen.queryByRole('button', { name: en.Retry })).not.toBeInTheDocument();
    test.expect(fixture.runs).toHaveBeenCalledWith({
      correlationId: generation.id,
      eventId: first.retryId,
      limit: 30
    });
    test.expect(fixture.retry).toHaveBeenCalledTimes(1);
  }
);

test.stable(
  'preserves a newer uncertain retry when an older receipt arrives after remount',
  async () => {
    const user = test.userEvent.setup();
    const fixture = mount(false, true);
    const receipt = Promise.withResolvers<typeof generation>();

    fixture.retry.mockImplementationOnce(() => Effect.promise(() => receipt.promise));
    await user.click(await test.screen.findByRole('button', { name: en.Retry }));
    await test.waitFor(() => test.expect(fixture.retry).toHaveBeenCalledTimes(1));
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
    await user.click(await test.screen.findByRole('button', { name: en.Retry }));
    await test.screen.findByRole('status', { name: en.PracticeGenerationRetryStatus });
    const second = fixture.retry.mock.calls[1]![0];

    test.expect(second.retryId).not.toBe(first.retryId);
    await test.act(async () => {
      receipt.resolve(generation);
      await receipt.promise;
    });
    await user.click(await test.screen.findByRole('button', { name: en.Retry }));
    await test.waitFor(() => test.expect(fixture.retry).toHaveBeenCalledTimes(3));
    test.expect(fixture.retry.mock.calls[2]![0]).toEqual(second);
  }
);

test.stable('opens work details on demand from the current status context menu', async () => {
  const user = test.userEvent.setup();

  mount();
  const status = await test.screen.findByRole('status', { name: en.PracticeGenerationRunning });

  test.expect(test.screen.queryByRole('dialog')).not.toBeInTheDocument();
  await user.pointer({ target: status, keys: '[MouseRight]' });
  await user.click(await test.screen.findByRole('menuitem', { name: en.AgentActivityDetails }));
  const dialog = await test.screen.findByRole('dialog', { name: en.AgentActivityDetails });

  test.expect(test.within(dialog).getByText(en.AgentActivityWaiting)).toBeVisible();
  await user.click(test.within(dialog).getByRole('button', { name: en.Close }));
  await test.waitFor(() => test.expect(test.screen.queryByRole('dialog')).not.toBeInTheDocument());
  test
    .expect(test.screen.getByRole('status', { name: en.PracticeGenerationRunning }))
    .toBeVisible();
});
