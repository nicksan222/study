import { StudyError } from '@study/contracts/errors';
import { projectIdSchema } from '@study/contracts/ids';
import { materialGenerationSnapshotSchema } from '@study/contracts/materials/schemas';
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

function mount(fail = false) {
  let active = true;
  const stop = vi.fn<StudyClient['materials.cancelMaterialGeneration']>().mockImplementation(() => {
    if (fail) return Effect.fail(new StudyError('transient', 'Offline'));

    active = false;

    return Effect.succeed({ ...generation, cancelled: true });
  });
  const list = vi
    .fn<StudyClient['materials.activeMaterialGenerations']>()
    .mockImplementation(() => Effect.succeed(active ? [generation] : []));
  const rpc = {
    'materials.activeMaterialGenerations': list,
    'materials.cancelMaterialGeneration': stop
  };

  const fixture = rpcHandlersTransport(rpc);

  render(<PracticeSidebarGenerations project={project} subjects={[]} query="" enabled />, {
    wrapper: fixture.wrapper
  });

  return { stop, list, notify: fixture.notify };
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
