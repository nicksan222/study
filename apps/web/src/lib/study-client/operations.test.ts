import { projectIdSchema } from '@study/contracts/ids';
import { act, waitFor } from '@testing-library/react';
import { Effect, Schema } from 'effect';
import { beforeEach, expect, it, vi } from 'vite-plus/test';

import { listProjects, listMaterialsForProjects } from './operations';

const api = vi.hoisted(() => ({ page: vi.fn(), materials: vi.fn(), opened: 0, closed: 0 }));

vi.mock('./client', async () => {
  const { Effect } = await import('effect');

  return {
    studyClient: Effect.acquireRelease(
      Effect.sync(() => {
        api.opened++;

        return {
          'projects.projects': (input: unknown) => api.page(input),
          'materials.materials': (input: unknown) => api.materials(input)
        };
      }),
      () =>
        Effect.sync(() => {
          api.closed++;
        })
    )
  };
});

beforeEach(() => {
  api.opened = 0;
  api.closed = 0;
  api.materials.mockReset();
  api.page.mockReset().mockReturnValue(Effect.succeed({ items: [], next: null }));
});

it('closes RPC resources after a completed request', async () => {
  expect(await listProjects(new AbortController().signal)).toEqual([]);
  expect(api.opened).toBe(1);
  expect(api.closed).toBe(1);
});

it('closes the RPC scope when its owner cancels an in-flight operation', async () => {
  api.page.mockReturnValue(Effect.never);
  const controller = new AbortController();
  const pending = listProjects(controller.signal).catch((error: unknown) => error);

  await waitFor(() => expect(api.opened).toBe(1));
  await act(async () => {
    controller.abort();
  });
  expect(await pending).toMatchObject({ name: 'AbortError' });
  expect(api.closed).toBe(1);
});

it('preserves serialized domain failures and releases the RPC scope on failure', async () => {
  api.page.mockReturnValue(
    Effect.fail({
      kind: 'rate_limited',
      message: 'limited',
      retryAfterMs: 500
    })
  );
  await expect(listProjects()).rejects.toMatchObject({ kind: 'rate_limited', retryAfterMs: 500 });

  expect(api.closed).toBe(1);
});

it('follows material cursors for each project within one owned RPC scope', async () => {
  const project = Schema.decodeUnknownSync(projectIdSchema);

  api.materials.mockImplementation(({ cursor }) =>
    Effect.succeed({ items: [], nextCursor: cursor === undefined ? 7n : null })
  );
  expect(await listMaterialsForProjects([project(1n), project(2n)])).toEqual([]);
  expect(api.materials.mock.calls.map(([input]) => [input.projectId, input.cursor])).toEqual([
    [1n, undefined],
    [1n, 7n],
    [2n, undefined],
    [2n, 7n]
  ]);
  expect(api.opened).toBe(1);
  expect(api.closed).toBe(1);
});

it('bounds concurrent project requests to four', async () => {
  let active = 0;
  let peak = 0;

  const release = () =>
    Effect.sync(() => {
      active--;
    });

  api.materials.mockImplementation(() =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        active++;
        peak = Math.max(peak, active);
      }),
      () => Effect.sleep('1 millis').pipe(Effect.as({ items: [], nextCursor: null })),
      release
    )
  );
  const project = Schema.decodeUnknownSync(projectIdSchema);

  expect(await listMaterialsForProjects([1n, 2n, 3n, 4n, 5n, 6n].map((id) => project(id)))).toEqual(
    []
  );
  expect(peak).toBe(4);
  expect(active).toBe(0);
});
