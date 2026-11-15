import { StudyError } from '@study/contracts';
import { projectIdSchema } from '@study/contracts';
import { materialGenerationSnapshotSchema } from '@study/contracts';
import { executionIdSchema } from '@study/contracts';
import type { executionSchema } from '@study/contracts';
import { catalogs } from '@study/localization';
import { testStable } from '@study/testing/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect, Schema } from 'effect';
import { expect, vi } from 'vite-plus/test';

import { rpcHandlersTransport } from '#client/test/rpc.tsx';
import type { StudyClient } from '#client/test/rpc.tsx';

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

testStable('recovers a running request and stops it from its sidebar card', async () => {
  const user = userEvent.setup();
  const { stop, list } = mount();

  expect(await screen.findByText(generation.title)).toBeVisible();
  expect(list).toHaveBeenCalledWith({ projectId: project });
  await user.click(screen.getByRole('button', { name: 'Stop generating Cell division quiz' }));
  await waitFor(() => expect(stop).toHaveBeenCalledWith({ requestId: generation.id }));
  await waitFor(() => expect(screen.queryByText(generation.title)).not.toBeInTheDocument());
});

testStable(
  'keeps a failed stop visible and offers the stop again in its context menu',
  async () => {
    const user = userEvent.setup();

    mount(true);
    await user.click(
      await screen.findByRole('button', { name: 'Stop generating Cell division quiz' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(en.PracticeGenerationStopError);
    expect(screen.getByText(generation.title)).toBeVisible();
    await user.pointer({ target: screen.getByText(generation.title), keys: '[MouseRight]' });
    expect(
      await screen.findByRole('menuitem', { name: en.PracticeGenerationStopAction })
    ).toBeEnabled();
  }
);

testStable('retains failed work with recovery actions and collapsed shared activity', async () => {
  mount(false, true);
  expect(await screen.findByText(generation.title)).toBeVisible();
  expect(screen.getByRole('status', { name: 'Generation needs attention' })).toHaveAttribute(
    'data-state',
    'attention'
  );
  expect(screen.getByRole('button', { name: en.Retry })).toBeEnabled();
  expect(screen.getByText('Generation needs attention').closest('details')).not.toHaveAttribute(
    'open'
  );
  expect(
    screen.queryByRole('status', { name: en.PracticeGenerationRunning })
  ).not.toBeInTheDocument();
});

testStable(
  'reuses an uncertain retry identity and waits for that exact admitted attempt',
  async () => {
    const user = userEvent.setup();
    const fixture = mount(false, true);

    fixture.retry.mockImplementationOnce(() =>
      Effect.fail(new StudyError('transient', 'Lost receipt'))
    );
    await user.click(await screen.findByRole('button', { name: en.Retry }));
    expect(await screen.findByRole('alert', { name: 'Could not confirm the retry' })).toBeVisible();
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
    expect(screen.getByRole('button', { name: en.Retry })).toBeDisabled();
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

testStable(
  'recovers a lost retry receipt after remount without creating another attempt',
  async () => {
    const user = userEvent.setup();
    const fixture = mount(false, true);

    fixture.retry.mockImplementationOnce(() =>
      Effect.fail(new StudyError('transient', 'Lost receipt'))
    );
    await user.click(await screen.findByRole('button', { name: en.Retry }));
    await screen.findByRole('alert', { name: en.PracticeGenerationRetryError });
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
    await waitFor(() => expect(screen.getByRole('button', { name: en.Retry })).toBeDisabled());
    expect(fixture.runs).toHaveBeenCalledWith({
      correlationId: generation.id,
      eventId: first.retryId,
      limit: 30
    });
    expect(fixture.retry).toHaveBeenCalledTimes(1);
  }
);
