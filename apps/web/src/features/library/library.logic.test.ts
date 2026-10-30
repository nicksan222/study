import { projectIdSchema, materialIdSchema } from '@study/contracts/ids';
import { Effect, Schema } from 'effect';
import { expect, it } from 'vite-plus/test';

import { runOperation } from '../../lib/effect/runtime';
import { loadLibraryItems } from './library.logic';

it('follows every page for each project and skips sources in practice', async () => {
  const project = Schema.decodeUnknownSync(projectIdSchema);
  const cursorId = Schema.decodeUnknownSync(materialIdSchema)(7n);
  const requests: [bigint, bigint | undefined][] = [];
  let sourceCalls = 0;
  const result = await runOperation(
    loadLibraryItems('practice', [project(1n), project(2n)], undefined, {
      listSources: () =>
        Effect.sync(() => {
          sourceCalls++;

          return [];
        }),
      listMaterials: (id, cursor) =>
        Effect.sync(() => {
          requests.push([id, cursor]);

          return { items: [], nextCursor: cursor === undefined ? cursorId : null };
        })
    }),
    new AbortController().signal
  );

  expect(result).toEqual({ status: 'ready', value: [] });
  expect(requests).toEqual([
    [1n, undefined],
    [1n, 7n],
    [2n, undefined],
    [2n, 7n]
  ]);
  expect(sourceCalls).toBe(0);
});
